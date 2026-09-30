import AppKit
import QuartzCore
import UniformTypeIdentifiers

/// The infinite canvas: images as layers on a pan/zoom plane over a dot grid.
/// Trackpad scroll pans, pinch or ⌘-scroll zooms, space-drag pans; drag on empty space selects.
/// ⌘C/⌘X/⌘V/⌘D/⌫/⌘A/⌘Z and the arrows work on the selection; files and images drop in, and an image
/// dragged past the edge of the canvas leaves as a file (Finder, Slack, browsers).
final class InfiniteCanvasView: NSView, NSDraggingSource, NSMenuItemValidation {
    let board: CanvasBoard
    /// Tells SwiftUI the zoom and whether the board is empty.
    var onViewportChange: ((CGFloat, Bool) -> Void)?
    /// Tells SwiftUI how many images are selected, for the selection toolbar.
    var onSelectionChange: ((Int) -> Void)?

    private let grid = DotGridLayer()
    private let world = CALayer()
    private let groupOutline = CAShapeLayer()
    private let handles = CAShapeLayer()
    private let sizeBadge = BadgeLayer()
    private let guides = CAShapeLayer()
    private let marquee = CAShapeLayer()
    private let dropGlow = DropGlowLayer()
    private var layers: [UUID: ItemLayer] = [:]
    private var decoded: [UUID: Int] = [:]
    private(set) var selection: Set<UUID> = [] {
        didSet {
            guard selection != oldValue else { return }
            refreshStates()
            updateOverlay()
            onSelectionChange?(selection.count)
        }
    }
    private var hovered: UUID? { didSet { if hovered != oldValue { refreshStates() } } }
    private var pressed: UUID? { didSet { if pressed != oldValue { refreshStates() } } }
    private var lifted: Set<UUID> = [] { didSet { if lifted != oldValue { refreshStates(); updateOverlay() } } }
    private var offset = CGPoint.zero
    private(set) var scale: CGFloat = 1
    private var hasPlacedViewport = false
    private var isSpaceDown = false
    private var lastMouse: CGPoint?
    private var isResizing = false
    private var viewportAnimation: Timer?

    private enum Corner: CaseIterable { case topLeft, topRight, bottomLeft, bottomRight }
    private enum Drag {
        case none
        case pan(start: CGPoint, origin: CGPoint)
        case move(start: CGPoint, frames: [UUID: CGRect], before: [CanvasItem], started: Bool)
        case resize(id: UUID, corner: Corner, frame: CGRect, before: [CanvasItem])
        case marquee(start: CGPoint, base: Set<UUID>)
    }
    private var drag = Drag.none

    static let zoomRange: ClosedRange<CGFloat> = 0.05...8
    private static let handleSize: CGFloat = 11
    /// How close (in screen points) an edge must get to another image's edge to snap to it.
    private static let snapDistance: CGFloat = 7
    private static let accent = NSColor.controlAccentColor
    private static let guideColor = NSColor.systemPink
    private static let dropTypes: [NSPasteboard.PasteboardType] = [.fileURL, .png, .tiff, .pdf] +
        CanvasBoard.preferredTypes.map { NSPasteboard.PasteboardType($0.identifier) }

    init(board: CanvasBoard) {
        self.board = board
        super.init(frame: .zero)
        wantsLayer = true
        grid.contentsScale = 2
        world.anchorPoint = .zero
        groupOutline.fillColor = nil
        groupOutline.strokeColor = Self.accent.cgColor
        groupOutline.lineWidth = 1
        groupOutline.lineDashPattern = [5, 4]
        handles.fillColor = NSColor.white.cgColor
        handles.strokeColor = Self.accent.cgColor
        handles.lineWidth = 1.5
        handles.shadowColor = CGColor(gray: 0, alpha: 1)
        handles.shadowOpacity = 0.3
        handles.shadowRadius = 3
        handles.shadowOffset = CGSize(width: 0, height: 1)
        guides.fillColor = nil
        guides.strokeColor = Self.guideColor.cgColor
        guides.lineWidth = 1
        marquee.fillColor = Self.accent.withAlphaComponent(0.1).cgColor
        marquee.strokeColor = Self.accent.cgColor
        marquee.lineWidth = 1
        marquee.isHidden = true
        dropGlow.opacity = 0
        for sublayer in [grid, world, groupOutline, guides, handles, sizeBadge, marquee, dropGlow] as [CALayer] {
            layer?.addSublayer(sublayer)
        }
        registerForDraggedTypes(Self.dropTypes)
        board.onChange = { [weak self] in self?.syncLayers(animated: true) }
        syncLayers(animated: false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    /// The window moves by its background; without this every click here dragged the window instead.
    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        let backing = window?.backingScaleFactor ?? 2
        for sublayer in [grid, sizeBadge, dropGlow] as [CALayer] { sublayer.contentsScale = backing }
        dropGlow.updateScale(backing)
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
                                       owner: self))
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for sublayer in [grid, groupOutline, guides, handles, marquee] as [CALayer] { sublayer.frame = bounds }
        // Never `frame` here: the world layer carries the pan/zoom transform, and setting a transformed
        // layer's frame moves it so the images slid away from their handles after any relayout.
        world.bounds = CGRect(origin: .zero, size: bounds.size)
        world.position = .zero
        dropGlow.frame = bounds.insetBy(dx: 14, dy: 14)
        CATransaction.commit()
        if !hasPlacedViewport, bounds.width > 0 {
            hasPlacedViewport = true
            fitAll(animated: false)
        }
        applyTransform()
    }

    // MARK: - Coordinates

    private func toWorld(_ point: CGPoint) -> CGPoint {
        CGPoint(x: (point.x - offset.x) / scale, y: (point.y - offset.y) / scale)
    }

    private func toView(_ rect: CGRect) -> CGRect {
        CGRect(x: rect.minX * scale + offset.x, y: rect.minY * scale + offset.y,
               width: rect.width * scale, height: rect.height * scale)
    }

    private var viewCenter: CGPoint { CGPoint(x: bounds.midX, y: bounds.midY) }

    /// Where pasted images land: under the pointer when it is over the canvas, else the middle of the view.
    private var pastePoint: CGPoint {
        if let lastMouse, bounds.contains(lastMouse) { return toWorld(lastMouse) }
        return toWorld(viewCenter)
    }

    private func applyTransform() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        world.setAffineTransform(CGAffineTransform(translationX: offset.x, y: offset.y).scaledBy(x: scale, y: scale))
        grid.offset = offset
        grid.scale = scale
        grid.setNeedsDisplay()
        for layer in layers.values { layer.updateZoom(scale) }
        updateOverlay()
        CATransaction.commit()
        onViewportChange?(scale, board.items.isEmpty)
    }

    private func zoom(to target: CGFloat, around point: CGPoint) {
        viewportAnimation?.invalidate()
        let clamped = min(max(target, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        let anchor = toWorld(point)
        scale = clamped
        offset = CGPoint(x: point.x - anchor.x * scale, y: point.y - anchor.y * scale)
        applyTransform()
        refreshResolution()
    }

    /// Glides the camera to a new zoom and position, easing out, so buttons and double-clicks never jump.
    private func animateViewport(to targetScale: CGFloat, offset targetOffset: CGPoint, duration: TimeInterval = 0.32) {
        viewportAnimation?.invalidate()
        let startScale = scale, startOffset = offset, started = Date()
        // Interpolating the anchor keeps the motion straight on screen while the zoom changes.
        viewportAnimation = Timer.scheduledTimer(withTimeInterval: 1 / 120, repeats: true) { [weak self] timer in
            guard let self else { timer.invalidate(); return }
            let t = min(Date().timeIntervalSince(started) / duration, 1)
            let eased = CGFloat(1 - pow(1 - t, 3))
            self.scale = startScale * pow(targetScale / startScale, eased)
            self.offset = CGPoint(x: startOffset.x + (targetOffset.x - startOffset.x) * eased,
                                  y: startOffset.y + (targetOffset.y - startOffset.y) * eased)
            self.applyTransform()
            if t >= 1 {
                timer.invalidate()
                self.viewportAnimation = nil
                self.refreshResolution()
            }
        }
    }

    private func animatedZoom(to target: CGFloat) {
        let clamped = min(max(target, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        let anchor = toWorld(viewCenter)
        animateViewport(to: clamped, offset: CGPoint(x: viewCenter.x - anchor.x * clamped, y: viewCenter.y - anchor.y * clamped))
    }

    func zoomIn() { animatedZoom(to: scale * 1.4) }
    func zoomOut() { animatedZoom(to: scale / 1.4) }
    func actualSize() { animatedZoom(to: 1) }

    /// Everything on the board in view; an empty board centers its origin at 100%.
    func fitAll(animated: Bool = true) {
        let frames = board.items.map(\.frame)
        guard let first = frames.first, bounds.width > 0 else {
            if animated {
                animateViewport(to: 1, offset: viewCenter)
            } else {
                scale = 1
                offset = viewCenter
                applyTransform()
            }
            return
        }
        focus(on: frames.dropFirst().reduce(first) { $0.union($1) }, maxScale: 1, animated: animated)
    }

    private func focus(on rect: CGRect, maxScale: CGFloat, animated: Bool) {
        let padded = rect.insetBy(dx: -max(rect.width * 0.12, 60), dy: -max(rect.height * 0.12, 60))
        let target = min(max(min(bounds.width / padded.width, bounds.height / padded.height, maxScale),
                             Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        let targetOffset = CGPoint(x: bounds.midX - padded.midX * target, y: bounds.midY - padded.midY * target)
        if animated {
            animateViewport(to: target, offset: targetOffset)
        } else {
            scale = target
            offset = targetOffset
            applyTransform()
            refreshResolution()
        }
    }

    // MARK: - Layers

    private func syncLayers(animated: Bool) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let ids = Set(board.items.map(\.id))
        for (id, layer) in layers where !ids.contains(id) {
            layers[id] = nil
            decoded[id] = nil
            if animated { layer.vanish() } else { layer.removeFromSuperlayer() }
        }
        selection.formIntersection(ids)
        var arrivals = 0
        for (index, item) in board.items.enumerated() {
            let layer: ItemLayer
            if let existing = layers[item.id] {
                layer = existing
            } else {
                layer = makeLayer(for: item)
                if animated {
                    layer.appear(delay: Double(arrivals) * 0.05)
                    arrivals += 1
                }
            }
            layer.place(item.frame)
            layer.zPosition = CGFloat(index)
        }
        CATransaction.commit()
        refreshResolution()
        refreshStates()
        updateOverlay()
        onViewportChange?(scale, board.items.isEmpty)
    }

    private func makeLayer(for item: CanvasItem) -> ItemLayer {
        let layer = ItemLayer()
        layer.updateZoom(scale)
        world.addSublayer(layer)
        layers[item.id] = layer
        return layer
    }

    /// Hover, press, selection and lift, animated per image only when its state really changes.
    private func refreshStates() {
        for (id, layer) in layers {
            layer.setState(.init(hovered: hovered == id, pressed: pressed == id,
                                 selected: selection.contains(id), lifted: lifted.contains(id)))
        }
    }

    /// Decodes each image at about the size it covers on screen (Retina), and again only when it grows past that.
    private func refreshResolution() {
        let backing = window?.backingScaleFactor ?? 2
        for item in board.items {
            let needed = min(max(item.width, item.height) * Double(scale) * Double(backing), 4096)
            let wanted = max(256, Int(pow(2, ceil(log2(max(needed, 1))))))
            if let have = decoded[item.id], have >= min(wanted, 4096) { continue }
            decoded[item.id] = wanted
            let url = board.url(of: item), id = item.id
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let image = CanvasBoard.displayImage(of: url, maxPixel: wanted)
                DispatchQueue.main.async {
                    guard let self, let image, let layer = self.layers[id] else { return }
                    layer.show(image)
                }
            }
        }
    }

    /// Handles, size badge and the dashed box around a group, in screen points so they never scale.
    private func updateOverlay() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let selected = board.items.filter { selection.contains($0.id) }
        let moving = !lifted.isEmpty

        let handlePath = CGMutablePath()
        if selected.count == 1, let item = selected.first, !moving {
            for corner in Corner.allCases { handlePath.addEllipse(in: handleRect(corner, of: item.frame)) }
        }
        handles.path = handlePath

        if selected.count > 1, let first = selected.first {
            let union = toView(selected.dropFirst().reduce(first.frame) { $0.union($1.frame) }).insetBy(dx: -6, dy: -6)
            groupOutline.path = CGPath(roundedRect: union, cornerWidth: 8, cornerHeight: 8, transform: nil)
        } else {
            groupOutline.path = nil
        }

        if let first = selected.first {
            let union = selected.dropFirst().reduce(first.frame) { $0.union($1.frame) }
            let label = selected.count == 1 ? "\(Int(union.width.rounded())) × \(Int(union.height.rounded()))"
                : "\(selected.count) imagens"
            let box = toView(union)
            sizeBadge.show(label, centeredAt: CGPoint(x: box.midX, y: box.maxY + 22), emphasized: isResizing)
            sizeBadge.isHidden = moving && !isResizing
        } else {
            sizeBadge.isHidden = true
        }
        CATransaction.commit()
    }

    private func point(of corner: Corner, in rect: CGRect) -> CGPoint {
        switch corner {
        case .topLeft: return CGPoint(x: rect.minX, y: rect.minY)
        case .topRight: return CGPoint(x: rect.maxX, y: rect.minY)
        case .bottomLeft: return CGPoint(x: rect.minX, y: rect.maxY)
        case .bottomRight: return CGPoint(x: rect.maxX, y: rect.maxY)
        }
    }

    private func opposite(_ corner: Corner) -> Corner {
        switch corner {
        case .topLeft: return .bottomRight
        case .topRight: return .bottomLeft
        case .bottomLeft: return .topRight
        case .bottomRight: return .topLeft
        }
    }

    private func handleRect(_ corner: Corner, of frame: CGRect) -> CGRect {
        // Handles sit on the selection ring, which runs a few points outside the image.
        let ring = toView(frame).insetBy(dx: -ItemLayer.ringGap, dy: -ItemLayer.ringGap)
        let center = point(of: corner, in: ring), size = Self.handleSize
        return CGRect(x: center.x - size / 2, y: center.y - size / 2, width: size, height: size)
    }

    private func item(at point: CGPoint) -> CanvasItem? {
        let world = toWorld(point)
        return board.items.last { $0.frame.contains(world) }
    }

    private func handle(at point: CGPoint) -> (CanvasItem, Corner)? {
        guard selection.count == 1, let item = board.items.first(where: { selection.contains($0.id) }) else { return nil }
        let corner = Corner.allCases.first { handleRect($0, of: item.frame).insetBy(dx: -6, dy: -6).contains(point) }
        return corner.map { (item, $0) }
    }

    private func resizeCursor(_ corner: Corner) -> NSCursor {
        switch corner {
        case .topLeft: return .frameResize(position: .topLeft, directions: .all)
        case .topRight: return .frameResize(position: .topRight, directions: .all)
        case .bottomLeft: return .frameResize(position: .bottomLeft, directions: .all)
        case .bottomRight: return .frameResize(position: .bottomRight, directions: .all)
        }
    }

    // MARK: - Snapping

    /// Moves `frame` by up to the snap distance so one of its edges or centers lines up with another image,
    /// and returns the guide lines to draw (in canvas units).
    private func snap(_ frame: CGRect, ignoring ids: Set<UUID>) -> (dx: CGFloat, dy: CGFloat, lines: [(CGPoint, CGPoint)]) {
        let others = board.items.filter { !ids.contains($0.id) }.map(\.frame)
        guard !others.isEmpty else { return (0, 0, []) }
        let reach = Self.snapDistance / scale
        func best(_ mine: [CGFloat], _ theirs: [CGFloat]) -> CGFloat? {
            var result: CGFloat?
            for a in mine { for b in theirs where abs(b - a) <= reach && abs(b - a) < abs(result ?? .infinity) { result = b - a } }
            return result
        }
        let xs = others.flatMap { [$0.minX, $0.midX, $0.maxX] }
        let ys = others.flatMap { [$0.minY, $0.midY, $0.maxY] }
        let dx = best([frame.minX, frame.midX, frame.maxX], xs) ?? 0
        let dy = best([frame.minY, frame.midY, frame.maxY], ys) ?? 0
        let snapped = frame.offsetBy(dx: dx, dy: dy)
        var lines: [(CGPoint, CGPoint)] = []
        let tolerance = 0.5 / scale
        for x in [snapped.minX, snapped.midX, snapped.maxX] {
            let matches = others.filter { [$0.minX, $0.midX, $0.maxX].contains { abs($0 - x) < tolerance } }
            guard !matches.isEmpty else { continue }
            let top = matches.map(\.minY).min()!, bottom = matches.map(\.maxY).max()!
            lines.append((CGPoint(x: x, y: min(top, snapped.minY)), CGPoint(x: x, y: max(bottom, snapped.maxY))))
        }
        for y in [snapped.minY, snapped.midY, snapped.maxY] {
            let matches = others.filter { [$0.minY, $0.midY, $0.maxY].contains { abs($0 - y) < tolerance } }
            guard !matches.isEmpty else { continue }
            let left = matches.map(\.minX).min()!, right = matches.map(\.maxX).max()!
            lines.append((CGPoint(x: min(left, snapped.minX), y: y), CGPoint(x: max(right, snapped.maxX), y: y)))
        }
        return (dx, dy, lines)
    }

    private func drawGuides(_ lines: [(CGPoint, CGPoint)]) {
        let path = CGMutablePath()
        for (start, end) in lines {
            path.move(to: CGPoint(x: start.x * scale + offset.x, y: start.y * scale + offset.y))
            path.addLine(to: CGPoint(x: end.x * scale + offset.x, y: end.y * scale + offset.y))
        }
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        guides.path = lines.isEmpty ? nil : path
        CATransaction.commit()
    }

    // MARK: - Mouse

    override func mouseMoved(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        lastMouse = point
        if isSpaceDown { return }
        if let (_, corner) = handle(at: point) {
            resizeCursor(corner).set()
            hovered = nil
        } else {
            NSCursor.arrow.set()
            hovered = item(at: point)?.id
        }
    }

    override func mouseExited(with event: NSEvent) {
        hovered = nil
        lastMouse = nil
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        viewportAnimation?.invalidate()
        let point = convert(event.locationInWindow, from: nil)
        if isSpaceDown || event.buttonNumber == 2 {
            drag = .pan(start: point, origin: offset)
            NSCursor.closedHand.set()
            return
        }
        if let (item, corner) = handle(at: point) {
            isResizing = true
            drag = .resize(id: item.id, corner: corner, frame: item.frame, before: board.items)
            updateOverlay()
            return
        }
        if let hit = item(at: point) {
            if event.clickCount == 2 {
                focus(on: hit.frame, maxScale: 4, animated: true)
                return
            }
            if event.modifierFlags.contains(.shift) || event.modifierFlags.contains(.command) {
                if selection.contains(hit.id) { selection.remove(hit.id) } else { selection.insert(hit.id) }
            } else if !selection.contains(hit.id) {
                selection = [hit.id]
            }
            pressed = hit.id
            let frames = Dictionary(uniqueKeysWithValues: board.items.filter { selection.contains($0.id) }.map { ($0.id, $0.frame) })
            drag = .move(start: point, frames: frames, before: board.items, started: false)
        } else {
            let base = event.modifierFlags.contains(.shift) ? selection : []
            selection = base
            drag = .marquee(start: point, base: base)
        }
    }

    override func otherMouseDown(with event: NSEvent) { mouseDown(with: event) }
    override func otherMouseDragged(with event: NSEvent) { mouseDragged(with: event) }
    override func otherMouseUp(with event: NSEvent) { mouseUp(with: event) }

    override func mouseDragged(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        switch drag {
        case .none:
            break
        case .pan(let start, let origin):
            offset = CGPoint(x: origin.x + point.x - start.x, y: origin.y + point.y - start.y)
            applyTransform()
        case .move(let start, let frames, let before, var started):
            // Past the edge of the canvas the images leave as files; here they glide back where they were.
            if !bounds.contains(point) {
                for (id, frame) in frames { board.setFrame(frame, of: id) }
                drag = .none
                pressed = nil
                lifted = []
                drawGuides([])
                syncLayersAnimatedBack()
                beginExport(of: Array(frames.keys), event: event)
                return
            }
            if !started {
                guard hypot(point.x - start.x, point.y - start.y) > 3 else { return }
                started = true
                drag = .move(start: start, frames: frames, before: before, started: true)
                pressed = nil
                lifted = Set(frames.keys)
            }
            var dx = (point.x - start.x) / scale, dy = (point.y - start.y) / scale
            if let first = frames.values.first, !NSEvent.modifierFlags.contains(.command) {
                let union = frames.values.dropFirst().reduce(first) { $0.union($1) }.offsetBy(dx: dx, dy: dy)
                let snapped = snap(union, ignoring: Set(frames.keys))
                dx += snapped.dx
                dy += snapped.dy
                drawGuides(snapped.lines)
            }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            for (id, frame) in frames {
                let moved = frame.offsetBy(dx: dx, dy: dy)
                board.setFrame(moved, of: id)
                layers[id]?.place(moved)
            }
            CATransaction.commit()
            updateOverlay()
        case .resize(let id, let corner, let frame, _):
            // The opposite corner stays put and the image keeps its proportions.
            let anchor = self.point(of: opposite(corner), in: frame)
            let pointer = toWorld(point)
            let width = max(abs(pointer.x - anchor.x), 16)
            let height = width * frame.height / frame.width
            let x = pointer.x < anchor.x ? anchor.x - width : anchor.x
            let y = (corner == .topLeft || corner == .topRight) ? anchor.y - height : anchor.y
            let resized = CGRect(x: x, y: y, width: width, height: height)
            board.setFrame(resized, of: id)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layers[id]?.place(resized)
            CATransaction.commit()
            updateOverlay()
        case .marquee(let start, let base):
            let rect = CGRect(x: min(start.x, point.x), y: min(start.y, point.y),
                              width: abs(point.x - start.x), height: abs(point.y - start.y))
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            marquee.isHidden = false
            marquee.path = CGPath(roundedRect: rect, cornerWidth: 4, cornerHeight: 4, transform: nil)
            CATransaction.commit()
            let worldRect = CGRect(origin: toWorld(rect.origin), size: CGSize(width: rect.width / scale, height: rect.height / scale))
            selection = base.union(board.items.filter { $0.frame.intersects(worldRect) }.map(\.id))
        }
    }

    /// After a drag-out the images slide back to where they started instead of jumping.
    private func syncLayersAnimatedBack() {
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.28)
        CATransaction.setAnimationTimingFunction(CAMediaTimingFunction(name: .easeOut))
        for item in board.items { layers[item.id]?.place(item.frame) }
        CATransaction.commit()
        updateOverlay()
    }

    override func mouseUp(with event: NSEvent) {
        switch drag {
        case .move(_, let frames, let before, _):
            if board.items.contains(where: { item in frames[item.id].map { $0 != item.frame } ?? false }) {
                commit(before: before, name: "Mover")
            }
        case .resize(_, _, _, let before):
            commit(before: before, name: "Redimensionar")
            refreshResolution()
        case .pan:
            (isSpaceDown ? NSCursor.openHand : NSCursor.arrow).set()
        default:
            break
        }
        pressed = nil
        lifted = []
        isResizing = false
        marquee.isHidden = true
        drawGuides([])
        drag = .none
        updateOverlay()
    }

    override func scrollWheel(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if event.modifierFlags.contains(.command) || event.modifierFlags.contains(.control) {
            zoom(to: scale * exp(event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.01 : 0.1)), around: point)
        } else {
            viewportAnimation?.invalidate()
            let factor: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 10
            offset.x += event.scrollingDeltaX * factor
            offset.y += event.scrollingDeltaY * factor
            applyTransform()
        }
    }

    override func magnify(with event: NSEvent) {
        zoom(to: scale * (1 + event.magnification), around: convert(event.locationInWindow, from: nil))
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let point = convert(event.locationInWindow, from: nil)
        lastMouse = point
        let menu = NSMenu()
        func add(_ title: String, _ action: Selector, _ symbol: String) {
            let entry = menu.addItem(withTitle: title, action: action, keyEquivalent: "")
            entry.target = self
            entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        }
        if let hit = item(at: point) {
            if !selection.contains(hit.id) { selection = [hit.id] }
            add("Copiar", #selector(copy(_:)), "doc.on.doc")
            add("Recortar", #selector(cut(_:)), "scissors")
            add("Duplicar", #selector(duplicate(_:)), "plus.square.on.square")
            menu.addItem(.separator())
            add("Trazer pra frente", #selector(bringToFront(_:)), "square.3.layers.3d.top.filled")
            add("Mandar pra trás", #selector(sendToBack(_:)), "square.3.layers.3d.bottom.filled")
            add("Aproximar", #selector(focusSelection(_:)), "plus.magnifyingglass")
            menu.addItem(.separator())
            add("Abrir no Preview", #selector(openSelection(_:)), "eye")
            add("Mostrar no Finder", #selector(revealSelection(_:)), "folder")
            menu.addItem(.separator())
            add("Apagar", #selector(delete(_:)), "trash")
        } else {
            add("Colar", #selector(paste(_:)), "doc.on.clipboard")
            add("Importar imagens…", #selector(importImages(_:)), "photo.badge.plus")
            menu.addItem(.separator())
            add("Selecionar tudo", #selector(selectAll(_:)), "checkmark.circle")
            add("Ver tudo", #selector(fitAllAction(_:)), "scope")
        }
        return menu
    }

    // MARK: - Keyboard and menu commands

    override func keyDown(with event: NSEvent) {
        let step: CGFloat = event.modifierFlags.contains(.shift) ? 10 : 1
        switch event.keyCode {
        case 49: // space: hand tool while held
            if !isSpaceDown { isSpaceDown = true; NSCursor.openHand.set() }
        case 51, 117: deleteSelection() // ⌫, ⌦
        case 53: selection = [] // esc
        case 123: nudge(dx: -step, dy: 0)
        case 124: nudge(dx: step, dy: 0)
        case 125: nudge(dx: 0, dy: step)
        case 126: nudge(dx: 0, dy: -step)
        case 2 where event.modifierFlags.contains(.command): duplicate(nil) // ⌘D
        default: super.keyDown(with: event)
        }
    }

    override func keyUp(with event: NSEvent) {
        if event.keyCode == 49 {
            isSpaceDown = false
            NSCursor.arrow.set()
        } else {
            super.keyUp(with: event)
        }
    }

    private func nudge(dx: CGFloat, dy: CGFloat) {
        guard !selection.isEmpty else { return }
        let before = board.items
        for item in board.items where selection.contains(item.id) {
            board.setFrame(item.frame.offsetBy(dx: dx, dy: dy), of: item.id)
        }
        commit(before: before, name: "Mover")
    }

    private var selectedItems: [CanvasItem] { board.items.filter { selection.contains($0.id) } }

    @objc func copy(_ sender: Any?) {
        board.copy(selectedItems)
        for id in selection { layers[id]?.pulse() }
    }

    @objc func cut(_ sender: Any?) {
        board.copy(selectedItems)
        deleteSelection(name: "Recortar")
    }

    @objc func paste(_ sender: Any?) {
        let before = board.items
        let added = board.importImages(from: .general, around: pastePoint)
        guard !added.isEmpty else { NSSound.beep(); return }
        selection = Set(added.map(\.id))
        registerUndo(before: before, name: "Colar")
    }

    @objc func duplicate(_ sender: Any?) {
        let source = selectedItems
        guard let first = source.first else { return }
        let before = board.items
        let pasteboard = NSPasteboard(name: .init("canvas-duplicate"))
        board.copy(source, to: pasteboard)
        let union = source.dropFirst().reduce(first.frame) { $0.union($1.frame) }
        let added = board.importImages(from: pasteboard, around: CGPoint(x: union.midX + 40, y: union.midY + 40))
        selection = Set(added.map(\.id))
        registerUndo(before: before, name: "Duplicar")
    }

    @objc func importImages(_ sender: Any?) {
        guard let window else { return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.image, .pdf]
        panel.prompt = "Importar"
        let center = pastePoint
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self, response == .OK else { return }
            let before = self.board.items
            let added = self.board.importFiles(panel.urls, around: center)
            guard !added.isEmpty else { return }
            self.selection = Set(added.map(\.id))
            self.registerUndo(before: before, name: "Importar")
        }
    }

    @objc func bringToFront(_ sender: Any?) {
        let before = board.items
        board.bringToFront(selection)
        registerUndo(before: before, name: "Trazer pra frente")
    }

    @objc func sendToBack(_ sender: Any?) {
        let before = board.items
        board.sendToBack(selection)
        registerUndo(before: before, name: "Mandar pra trás")
    }

    @objc func focusSelection(_ sender: Any?) {
        guard let first = selectedItems.first else { return }
        focus(on: selectedItems.dropFirst().reduce(first.frame) { $0.union($1.frame) }, maxScale: 4, animated: true)
    }

    @objc func openSelection(_ sender: Any?) { selectedItems.forEach { NSWorkspace.shared.open(board.url(of: $0)) } }

    @objc func revealSelection(_ sender: Any?) {
        NSWorkspace.shared.activateFileViewerSelecting(selectedItems.map { board.url(of: $0) })
    }

    @objc func fitAllAction(_ sender: Any?) { fitAll() }

    @objc override func selectAll(_ sender: Any?) { selection = Set(board.items.map(\.id)) }

    @objc func delete(_ sender: Any?) { deleteSelection() }

    private func deleteSelection(name: String = "Apagar") {
        guard !selection.isEmpty else { return }
        let before = board.items
        board.remove(selection)
        selection = []
        registerUndo(before: before, name: name)
    }

    private func commit(before: [CanvasItem], name: String) {
        board.changed()
        registerUndo(before: before, name: name)
    }

    private func registerUndo(before: [CanvasItem], name: String) {
        let after = board.items
        undoManager?.registerUndo(withTarget: self) { view in
            view.board.replaceItems(before)
            view.registerRedo(after: after, before: before, name: name)
        }
        undoManager?.setActionName(name)
    }

    private func registerRedo(after: [CanvasItem], before: [CanvasItem], name: String) {
        undoManager?.registerUndo(withTarget: self) { view in
            view.board.replaceItems(after)
            view.registerUndo(before: before, name: name)
        }
        undoManager?.setActionName(name)
    }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(copy(_:)), #selector(cut(_:)), #selector(delete(_:)), #selector(duplicate(_:)),
             #selector(bringToFront(_:)), #selector(sendToBack(_:)), #selector(openSelection(_:)),
             #selector(revealSelection(_:)), #selector(focusSelection(_:)):
            return !selection.isEmpty
        case #selector(selectAll(_:)):
            return !board.items.isEmpty
        default:
            return true
        }
    }

    // MARK: - Drag in

    private func setDropGlow(_ visible: Bool) {
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.18)
        dropGlow.opacity = visible ? 1 : 0
        CATransaction.commit()
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard (sender.draggingSource as? InfiniteCanvasView) !== self else { return [] }
        setDropGlow(true)
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        (sender.draggingSource as? InfiniteCanvasView) === self ? [] : .copy
    }

    override func draggingExited(_ sender: NSDraggingInfo?) { setDropGlow(false) }

    override func draggingEnded(_ sender: NSDraggingInfo) { setDropGlow(false) }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        setDropGlow(false)
        guard (sender.draggingSource as? InfiniteCanvasView) !== self else { return false }
        let before = board.items
        let point = toWorld(convert(sender.draggingLocation, from: nil))
        let added = board.importImages(from: sender.draggingPasteboard, around: point)
        guard !added.isEmpty else { return false }
        selection = Set(added.map(\.id))
        window?.makeFirstResponder(self)
        registerUndo(before: before, name: "Soltar")
        return true
    }

    // MARK: - Drag out

    private func beginExport(of ids: [UUID], event: NSEvent) {
        let items = board.items.filter { ids.contains($0.id) }
        let writers = board.pasteboardItems(for: items)
        let dragging = zip(items, writers).map { item, writer -> NSDraggingItem in
            let entry = NSDraggingItem(pasteboardWriter: writer)
            let frame = toView(item.frame)
            let preview = layers[item.id]?.image.map { NSImage(cgImage: $0, size: frame.size) }
            entry.setDraggingFrame(frame, contents: preview)
            return entry
        }
        guard !dragging.isEmpty else { return }
        beginDraggingSession(with: dragging, event: event, source: self)
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        .copy
    }
}

// MARK: - Layers

/// One image: a card that lifts, presses and pops with springs, a rounded picture and the selection ring.
private final class ItemLayer: CALayer {
    struct State: Equatable {
        var hovered = false
        var pressed = false
        var selected = false
        var lifted = false
    }

    /// Screen points between the image and its selection ring.
    static let ringGap: CGFloat = 4
    private static let radius: CGFloat = 10

    private let card = CALayer()
    private let picture = CALayer()
    private let sheen = CALayer()
    private let ring = CALayer()
    private(set) var image: CGImage?
    private var state = State()
    private var zoom: CGFloat = 1

    override init() {
        super.init()
        card.shadowColor = CGColor(gray: 0, alpha: 1)
        card.shadowOpacity = 0.3
        card.shadowRadius = 12
        card.shadowOffset = CGSize(width: 0, height: 6)
        picture.masksToBounds = true
        picture.cornerRadius = Self.radius
        picture.cornerCurve = .continuous
        picture.contentsGravity = .resizeAspectFill
        picture.backgroundColor = CGColor(gray: 1, alpha: 0.1)
        // A hairline of light on the edge, like glass: images read as objects, not holes in the page.
        sheen.borderColor = CGColor(gray: 1, alpha: 0.16)
        sheen.cornerRadius = Self.radius
        sheen.cornerCurve = .continuous
        ring.borderColor = NSColor.controlAccentColor.cgColor
        ring.cornerCurve = .continuous
        ring.opacity = 0
        card.addSublayer(picture)
        card.addSublayer(sheen)
        card.addSublayer(ring)
        addSublayer(card)
    }

    override init(layer: Any) { super.init(layer: layer) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// Bounds and position only: the card may be scaled by an animation, and `frame` is undefined then.
    func place(_ frame: CGRect) {
        self.frame = frame
        card.bounds = CGRect(origin: .zero, size: frame.size)
        card.position = CGPoint(x: frame.width / 2, y: frame.height / 2)
        picture.frame = card.bounds
        sheen.frame = card.bounds
        layoutRing()
        card.shadowPath = CGPath(roundedRect: card.bounds, cornerWidth: Self.radius, cornerHeight: Self.radius, transform: nil)
    }

    /// Ring and hairline stay the same width on screen at any zoom.
    func updateZoom(_ scale: CGFloat) {
        zoom = scale
        sheen.borderWidth = 1 / scale
        ring.borderWidth = 2 / scale
        layoutRing()
    }

    private func layoutRing() {
        let gap = Self.ringGap / zoom
        ring.frame = card.bounds.insetBy(dx: -gap, dy: -gap)
        ring.cornerRadius = Self.radius + gap
    }

    func show(_ image: CGImage) {
        self.image = image
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.2)
        picture.contents = image
        picture.backgroundColor = nil
        CATransaction.commit()
    }

    func setState(_ new: State) {
        guard new != state else { return }
        let old = state
        state = new
        let targetScale: CGFloat = new.lifted ? 1.035 : new.pressed ? 0.965 : 1
        let shadow: (radius: CGFloat, opacity: Float, y: CGFloat) = new.lifted ? (30, 0.45, 20)
            : new.hovered || new.selected ? (18, 0.36, 10) : (12, 0.3, 6)
        // A fast press, a bouncy release: the "click" feel.
        let bouncy = old.pressed && !new.pressed || old.lifted && !new.lifted
        Self.spring(card, "transform.scale", to: targetScale, damping: bouncy ? 11 : 22, stiffness: bouncy ? 320 : 600)
        Self.spring(card, "shadowRadius", to: shadow.radius, damping: 20, stiffness: 260)
        Self.spring(card, "shadowOpacity", to: shadow.opacity, damping: 20, stiffness: 260)
        Self.spring(card, "shadowOffset", to: NSValue(size: CGSize(width: 0, height: shadow.y)), damping: 20, stiffness: 260)
        if new.selected != old.selected {
            CATransaction.begin()
            CATransaction.setAnimationDuration(new.selected ? 0.16 : 0.12)
            ring.opacity = new.selected ? 1 : 0
            CATransaction.commit()
            if new.selected && !new.pressed { pop() }
        }
    }

    /// Selected without a press (marquee, paste, ⌘A): a small pop says "got it".
    private func pop() {
        let bounce = CAKeyframeAnimation(keyPath: "transform.scale")
        bounce.values = [1, 1.04, 0.99, 1]
        bounce.keyTimes = [0, 0.35, 0.7, 1]
        bounce.duration = 0.32
        bounce.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeInEaseOut), count: 3)
        card.add(bounce, forKey: "pop")
    }

    /// Copied: a quick flash of light across the image.
    func pulse() {
        let flash = CAKeyframeAnimation(keyPath: "backgroundColor")
        flash.values = [CGColor(gray: 1, alpha: 0), CGColor(gray: 1, alpha: 0.35), CGColor(gray: 1, alpha: 0)]
        flash.duration = 0.35
        sheen.add(flash, forKey: "pulse")
        pop()
    }

    /// New on the board: fades in and springs up from slightly smaller.
    func appear(delay: TimeInterval) {
        let start = CACurrentMediaTime() + delay
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0
        fade.toValue = 1
        fade.duration = 0.22
        fade.beginTime = start
        fade.fillMode = .backwards
        add(fade, forKey: "appear-fade")
        let grow = CASpringAnimation(keyPath: "transform.scale")
        grow.fromValue = 0.88
        grow.toValue = 1
        grow.damping = 13
        grow.stiffness = 260
        grow.duration = grow.settlingDuration
        grow.beginTime = start
        grow.fillMode = .backwards
        card.add(grow, forKey: "appear-grow")
    }

    /// Deleted: shrinks and fades, then leaves the tree.
    func vanish() {
        CATransaction.begin()
        CATransaction.setAnimationDuration(0.16)
        CATransaction.setCompletionBlock { [weak self] in self?.removeFromSuperlayer() }
        opacity = 0
        card.setValue(0.9, forKeyPath: "transform.scale")
        CATransaction.commit()
    }

    private static func spring(_ layer: CALayer, _ keyPath: String, to value: Any,
                               damping: CGFloat, stiffness: CGFloat) {
        let animation = CASpringAnimation(keyPath: keyPath)
        animation.fromValue = layer.presentation()?.value(forKeyPath: keyPath) ?? layer.value(forKeyPath: keyPath)
        animation.toValue = value
        animation.damping = damping
        animation.stiffness = stiffness
        animation.duration = animation.settlingDuration
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.setValue(value, forKeyPath: keyPath)
        CATransaction.commit()
        layer.add(animation, forKey: keyPath)
    }
}

/// The small pill under a selection: size in points, or how many images are selected.
private final class BadgeLayer: CALayer {
    private let text = CATextLayer()

    override init() {
        super.init()
        backgroundColor = NSColor.controlAccentColor.cgColor
        cornerCurve = .continuous
        text.font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        text.fontSize = 11
        text.foregroundColor = NSColor.white.cgColor
        text.alignmentMode = .center
        addSublayer(text)
        isHidden = true
    }

    override init(layer: Any) { super.init(layer: layer) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var contentsScale: CGFloat {
        didSet { text.contentsScale = contentsScale }
    }

    func show(_ label: String, centeredAt center: CGPoint, emphasized: Bool) {
        let font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
        let width = ceil((label as NSString).size(withAttributes: [.font: font]).width) + 16
        isHidden = false
        text.font = font
        text.string = label
        frame = CGRect(x: center.x - width / 2, y: center.y - 10, width: width, height: 20)
        cornerRadius = 10
        text.frame = CGRect(x: 0, y: 3, width: width, height: 15)
        opacity = emphasized ? 1 : 0.92
    }
}

/// Shown while files hover over the canvas: an accent frame and one line saying what happens on release.
private final class DropGlowLayer: CALayer {
    private let label = CATextLayer()

    override init() {
        super.init()
        borderColor = NSColor.controlAccentColor.cgColor
        borderWidth = 2.5
        cornerRadius = 24
        cornerCurve = .continuous
        backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.08).cgColor
        label.string = "Solte pra adicionar ao canvas"
        label.font = NSFont.systemFont(ofSize: 20, weight: .semibold)
        label.fontSize = 20
        label.foregroundColor = NSColor.white.cgColor
        label.alignmentMode = .center
        label.shadowOpacity = 0.4
        label.shadowRadius = 6
        label.shadowOffset = .zero
        addSublayer(label)
    }

    override init(layer: Any) { super.init(layer: layer) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func updateScale(_ scale: CGFloat) { label.contentsScale = scale }

    override func layoutSublayers() {
        super.layoutSublayers()
        label.frame = CGRect(x: 0, y: bounds.midY - 14, width: bounds.width, height: 28)
    }
}

/// Dots every 24 canvas units, thinned out when zoomed far out so the grid never turns into noise.
private final class DotGridLayer: CALayer {
    var offset = CGPoint.zero
    var scale: CGFloat = 1

    override func draw(in context: CGContext) {
        var spacing = 24 * scale
        while spacing < 16 { spacing *= 2 }
        let radius: CGFloat = 1.15
        func start(_ value: CGFloat) -> CGFloat {
            let remainder = value.truncatingRemainder(dividingBy: spacing)
            return remainder < 0 ? remainder + spacing : remainder
        }
        context.setFillColor(CGColor(gray: 1, alpha: 0.22))
        var x = start(offset.x)
        while x < bounds.width {
            var y = start(offset.y)
            while y < bounds.height {
                context.addEllipse(in: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
                y += spacing
            }
            x += spacing
        }
        context.fillPath()
    }
}
