import AppKit
import QuartzCore

/// The infinite canvas: images as layers on a pan/zoom plane.
/// Trackpad scroll pans, pinch or ⌘-scroll zooms, space-drag pans; drag on empty space selects.
/// ⌘C/⌘X/⌘V/⌘D/⌫/⌘A/⌘Z work on the selection; files and images drop in, and an image dragged past
/// the edge of the canvas leaves as a file (Finder, Slack, browsers).
final class InfiniteCanvasView: NSView, NSDraggingSource, NSMenuItemValidation {
    let board: CanvasBoard
    /// Tells SwiftUI the zoom and whether the board is empty.
    var onViewportChange: ((CGFloat, Bool) -> Void)?

    private let world = CALayer()
    private let marquee = CAShapeLayer()
    private var layers: [UUID: CALayer] = [:]
    private var decoded: [UUID: Int] = [:]
    private(set) var selection: Set<UUID> = [] { didSet { updateSelectionLook() } }
    private var offset = CGPoint.zero
    private(set) var scale: CGFloat = 1
    private var hasPlacedViewport = false
    private var isSpaceDown = false

    private enum Drag {
        case none
        case pan(start: CGPoint, origin: CGPoint)
        case move(start: CGPoint, frames: [UUID: CGRect], before: [CanvasItem])
        case resize(id: UUID, start: CGPoint, frame: CGRect, before: [CanvasItem])
        case marquee(start: CGPoint, base: Set<UUID>)
    }
    private var drag = Drag.none

    static let zoomRange: ClosedRange<CGFloat> = 0.05...8
    private static let handleSize: CGFloat = 12
    private static let dropTypes: [NSPasteboard.PasteboardType] = [.fileURL, .png, .tiff, .pdf] +
        CanvasBoard.preferredTypes.map { NSPasteboard.PasteboardType($0.identifier) }

    init(board: CanvasBoard) {
        self.board = board
        super.init(frame: .zero)
        wantsLayer = true
        world.anchorPoint = .zero
        layer?.addSublayer(world)
        marquee.fillColor = NSColor.controlAccentColor.withAlphaComponent(0.12).cgColor
        marquee.strokeColor = NSColor.controlAccentColor.cgColor
        marquee.lineWidth = 1
        marquee.isHidden = true
        layer?.addSublayer(marquee)
        registerForDraggedTypes(Self.dropTypes)
        board.onChange = { [weak self] in self?.syncLayers() }
        syncLayers()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
    }

    override func layout() {
        super.layout()
        world.frame = CGRect(origin: .zero, size: bounds.size)
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

    private var viewCenterInWorld: CGPoint { toWorld(CGPoint(x: bounds.midX, y: bounds.midY)) }

    private func applyTransform() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        world.setAffineTransform(CGAffineTransform(translationX: offset.x, y: offset.y).scaledBy(x: scale, y: scale))
        updateSelectionLook()
        CATransaction.commit()
        onViewportChange?(scale, board.items.isEmpty)
    }

    private func zoom(by factor: CGFloat, around point: CGPoint) {
        let target = min(max(scale * factor, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        let anchor = toWorld(point)
        scale = target
        offset = CGPoint(x: point.x - anchor.x * scale, y: point.y - anchor.y * scale)
        applyTransform()
        refreshResolution()
    }

    func zoomIn() { zoom(by: 1.25, around: CGPoint(x: bounds.midX, y: bounds.midY)) }
    func zoomOut() { zoom(by: 0.8, around: CGPoint(x: bounds.midX, y: bounds.midY)) }
    func actualSize() { zoom(by: 1 / scale, around: CGPoint(x: bounds.midX, y: bounds.midY)) }

    /// Everything on the board in view; an empty board centers its origin at 100%.
    func fitAll(animated: Bool = true) {
        let frames = board.items.map(\.frame)
        guard let first = frames.first, bounds.width > 0 else {
            scale = 1
            offset = CGPoint(x: bounds.midX, y: bounds.midY)
            applyTransform()
            return
        }
        let union = frames.dropFirst().reduce(first) { $0.union($1) }.insetBy(dx: -60, dy: -60)
        scale = min(max(min(bounds.width / union.width, bounds.height / union.height, 1), Self.zoomRange.lowerBound),
                    Self.zoomRange.upperBound)
        offset = CGPoint(x: bounds.midX - union.midX * scale, y: bounds.midY - union.midY * scale)
        applyTransform()
        refreshResolution()
    }

    // MARK: - Layers

    private func syncLayers() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let ids = Set(board.items.map(\.id))
        for (id, layer) in layers where !ids.contains(id) {
            layer.removeFromSuperlayer()
            layers[id] = nil
            decoded[id] = nil
        }
        selection.formIntersection(ids)
        for (index, item) in board.items.enumerated() {
            let layer = layers[item.id] ?? makeLayer(for: item)
            layer.frame = item.frame
            layer.zPosition = CGFloat(index)
        }
        CATransaction.commit()
        refreshResolution()
        updateSelectionLook()
        onViewportChange?(scale, board.items.isEmpty)
    }

    private func makeLayer(for item: CanvasItem) -> CALayer {
        let layer = CALayer()
        layer.contentsGravity = .resize
        layer.backgroundColor = NSColor.white.withAlphaComponent(0.08).cgColor
        layer.masksToBounds = false
        let handle = CALayer()
        handle.name = "handle"
        handle.backgroundColor = NSColor.white.cgColor
        handle.borderColor = NSColor.controlAccentColor.cgColor
        handle.isHidden = true
        layer.addSublayer(handle)
        world.addSublayer(layer)
        layers[item.id] = layer
        return layer
    }

    /// Decodes each image at about the size it covers on screen (Retina), and again only when it grows past that.
    private func refreshResolution() {
        let backing = window?.backingScaleFactor ?? 2
        for item in board.items {
            let needed = Int(min(max(item.width, item.height) * Double(scale) * Double(backing), 4096).rounded(.up))
            let wanted = max(256, Int(pow(2, ceil(log2(Double(max(needed, 1)))))))
            if let have = decoded[item.id], have >= min(wanted, 4096) { continue }
            decoded[item.id] = wanted
            let url = board.url(of: item), id = item.id
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let image = CanvasBoard.displayImage(of: url, maxPixel: wanted)
                DispatchQueue.main.async {
                    guard let self, let image, let layer = self.layers[id] else { return }
                    CATransaction.begin()
                    CATransaction.setDisableActions(true)
                    layer.contents = image
                    layer.backgroundColor = nil
                    CATransaction.commit()
                }
            }
        }
    }

    private func updateSelectionLook() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let accent = NSColor.controlAccentColor.cgColor
        for (id, layer) in layers {
            let isSelected = selection.contains(id)
            layer.borderColor = accent
            layer.borderWidth = isSelected ? 2 / scale : 0
            if let handle = layer.sublayers?.first(where: { $0.name == "handle" }) {
                let size = Self.handleSize / scale
                handle.isHidden = !(isSelected && selection.count == 1)
                handle.frame = CGRect(x: layer.bounds.width - size / 2, y: layer.bounds.height - size / 2, width: size, height: size)
                handle.borderWidth = 1.5 / scale
                handle.cornerRadius = 2 / scale
            }
        }
        CATransaction.commit()
    }

    private func item(at point: CGPoint) -> CanvasItem? {
        let world = toWorld(point)
        return board.items.last { $0.frame.contains(world) }
    }

    private func resizeHandle(at point: CGPoint) -> CanvasItem? {
        guard selection.count == 1, let item = board.items.first(where: { selection.contains($0.id) }) else { return nil }
        let corner = toView(item.frame)
        let hit = Self.handleSize
        return CGRect(x: corner.maxX - hit, y: corner.maxY - hit, width: hit * 2, height: hit * 2).contains(point) ? item : nil
    }

    // MARK: - Mouse

    override func resetCursorRects() {
        if isSpaceDown { addCursorRect(bounds, cursor: .openHand) }
    }

    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        let point = convert(event.locationInWindow, from: nil)
        if isSpaceDown {
            drag = .pan(start: point, origin: offset)
            NSCursor.closedHand.set()
            return
        }
        if let item = resizeHandle(at: point) {
            drag = .resize(id: item.id, start: point, frame: item.frame, before: board.items)
            return
        }
        if let hit = item(at: point) {
            if event.clickCount == 2 {
                NSWorkspace.shared.open(board.url(of: hit))
                return
            }
            if event.modifierFlags.contains(.shift) {
                if selection.contains(hit.id) { selection.remove(hit.id) } else { selection.insert(hit.id) }
            } else if !selection.contains(hit.id) {
                selection = [hit.id]
            }
            let frames = Dictionary(uniqueKeysWithValues: board.items.filter { selection.contains($0.id) }.map { ($0.id, $0.frame) })
            drag = .move(start: point, frames: frames, before: board.items)
        } else {
            let base = event.modifierFlags.contains(.shift) ? selection : []
            selection = base
            drag = .marquee(start: point, base: base)
        }
    }

    override func mouseDragged(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        switch drag {
        case .none:
            break
        case .pan(let start, let origin):
            offset = CGPoint(x: origin.x + point.x - start.x, y: origin.y + point.y - start.y)
            applyTransform()
        case .move(let start, let frames, _):
            // Past the edge of the canvas the images leave as files; they stay where they were here.
            if !bounds.contains(point) {
                for (id, frame) in frames { board.setFrame(frame, of: id) }
                syncLayers()
                drag = .none
                beginExport(of: Array(frames.keys), event: event)
                return
            }
            let dx = (point.x - start.x) / scale, dy = (point.y - start.y) / scale
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            for (id, frame) in frames {
                let moved = frame.offsetBy(dx: dx, dy: dy)
                board.setFrame(moved, of: id)
                layers[id]?.frame = moved
            }
            CATransaction.commit()
        case .resize(let id, let start, let frame, _):
            // Corner drag keeps the image's proportions.
            let width = max(frame.width + (point.x - start.x) / scale, 16)
            let resized = CGRect(x: frame.minX, y: frame.minY, width: width, height: width * frame.height / frame.width)
            board.setFrame(resized, of: id)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layers[id]?.frame = resized
            CATransaction.commit()
            updateSelectionLook()
        case .marquee(let start, let base):
            let rect = CGRect(x: min(start.x, point.x), y: min(start.y, point.y),
                              width: abs(point.x - start.x), height: abs(point.y - start.y))
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            marquee.isHidden = false
            marquee.path = CGPath(rect: rect, transform: nil)
            CATransaction.commit()
            let worldRect = CGRect(origin: toWorld(rect.origin), size: CGSize(width: rect.width / scale, height: rect.height / scale))
            selection = base.union(board.items.filter { $0.frame.intersects(worldRect) }.map(\.id))
        }
    }

    override func mouseUp(with event: NSEvent) {
        switch drag {
        case .move(_, let frames, let before):
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
        marquee.isHidden = true
        drag = .none
    }

    override func scrollWheel(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if event.modifierFlags.contains(.command) {
            zoom(by: exp(event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.01 : 0.1)), around: point)
        } else {
            let factor: CGFloat = event.hasPreciseScrollingDeltas ? 1 : 10
            offset.x += event.scrollingDeltaX * factor
            offset.y += event.scrollingDeltaY * factor
            applyTransform()
        }
    }

    override func magnify(with event: NSEvent) {
        zoom(by: 1 + event.magnification, around: convert(event.locationInWindow, from: nil))
    }

    // MARK: - Keyboard and menu commands

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 49: // space: hand tool while held
            if !isSpaceDown { isSpaceDown = true; window?.invalidateCursorRects(for: self); NSCursor.openHand.set() }
        case 51, 117: deleteSelection() // ⌫, ⌦
        case 53: selection = [] // esc
        case 2 where event.modifierFlags.contains(.command): duplicate(nil) // ⌘D
        default: super.keyDown(with: event)
        }
    }

    override func keyUp(with event: NSEvent) {
        if event.keyCode == 49 {
            isSpaceDown = false
            window?.invalidateCursorRects(for: self)
            NSCursor.arrow.set()
        } else {
            super.keyUp(with: event)
        }
    }

    private var selectedItems: [CanvasItem] { board.items.filter { selection.contains($0.id) } }

    @objc func copy(_ sender: Any?) { board.copy(selectedItems) }

    @objc func cut(_ sender: Any?) {
        board.copy(selectedItems)
        deleteSelection(name: "Recortar")
    }

    @objc func paste(_ sender: Any?) {
        let before = board.items
        let added = board.importImages(from: .general, around: viewCenterInWorld)
        guard !added.isEmpty else { NSSound.beep(); return }
        selection = Set(added.map(\.id))
        registerUndo(before: before, name: "Colar")
    }

    @objc func duplicate(_ sender: Any?) {
        let before = board.items
        let pasteboard = NSPasteboard(name: .init("canvas-duplicate"))
        board.copy(selectedItems, to: pasteboard)
        let source = selectedItems.map(\.frame)
        guard let first = source.first else { return }
        let union = source.dropFirst().reduce(first) { $0.union($1) }
        let added = board.importImages(from: pasteboard, around: CGPoint(x: union.midX + 40, y: union.midY + 40))
        selection = Set(added.map(\.id))
        registerUndo(before: before, name: "Duplicar")
    }

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
        case #selector(copy(_:)), #selector(cut(_:)), #selector(delete(_:)), #selector(duplicate(_:)):
            return !selection.isEmpty
        case #selector(paste(_:)):
            return true
        case #selector(selectAll(_:)):
            return !board.items.isEmpty
        default:
            return true
        }
    }

    // MARK: - Drag in

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        (sender.draggingSource as? InfiniteCanvasView) === self ? [] : .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation { draggingEntered(sender) }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
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
            let preview = (layers[item.id]?.contents).map { NSImage(cgImage: $0 as! CGImage, size: frame.size) }
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
