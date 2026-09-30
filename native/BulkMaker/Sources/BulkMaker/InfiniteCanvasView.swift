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

    private let grid = DotGridLayer()
    private let world = CALayer()
    private let overlay = CAShapeLayer()
    private let hoverOutline = CAShapeLayer()
    private let marquee = CAShapeLayer()
    private var layers: [UUID: ItemLayer] = [:]
    private var decoded: [UUID: Int] = [:]
    private(set) var selection: Set<UUID> = [] { didSet { updateOverlay() } }
    private var hovered: UUID? { didSet { if hovered != oldValue { updateOverlay() } } }
    private var offset = CGPoint.zero
    private(set) var scale: CGFloat = 1
    private var hasPlacedViewport = false
    private var isSpaceDown = false
    private var lastMouse: CGPoint?

    private enum Corner: CaseIterable { case topLeft, topRight, bottomLeft, bottomRight }
    private enum Drag {
        case none
        case pan(start: CGPoint, origin: CGPoint)
        case move(start: CGPoint, frames: [UUID: CGRect], before: [CanvasItem])
        case resize(id: UUID, corner: Corner, frame: CGRect, before: [CanvasItem])
        case marquee(start: CGPoint, base: Set<UUID>)
    }
    private var drag = Drag.none

    static let zoomRange: ClosedRange<CGFloat> = 0.05...8
    private static let handleSize: CGFloat = 10
    private static let accent = NSColor.controlAccentColor
    private static let dropTypes: [NSPasteboard.PasteboardType] = [.fileURL, .png, .tiff, .pdf] +
        CanvasBoard.preferredTypes.map { NSPasteboard.PasteboardType($0.identifier) }

    init(board: CanvasBoard) {
        self.board = board
        super.init(frame: .zero)
        wantsLayer = true
        grid.contentsScale = 2
        layer?.addSublayer(grid)
        world.anchorPoint = .zero
        layer?.addSublayer(world)
        hoverOutline.fillColor = nil
        hoverOutline.strokeColor = Self.accent.withAlphaComponent(0.55).cgColor
        hoverOutline.lineWidth = 1.5
        layer?.addSublayer(hoverOutline)
        overlay.fillColor = NSColor.white.cgColor
        overlay.strokeColor = Self.accent.cgColor
        overlay.lineWidth = 1.5
        layer?.addSublayer(overlay)
        marquee.fillColor = Self.accent.withAlphaComponent(0.1).cgColor
        marquee.strokeColor = Self.accent.cgColor
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
    /// The window moves by its background; without this every click here dragged the window instead.
    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.makeFirstResponder(self)
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
        for sublayer in [grid, world, overlay, hoverOutline, marquee] as [CALayer] { sublayer.frame = bounds }
        CATransaction.commit()
        if !hasPlacedViewport, bounds.width > 0 {
            hasPlacedViewport = true
            fitAll()
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
        updateOverlay()
        CATransaction.commit()
        onViewportChange?(scale, board.items.isEmpty)
    }

    private func zoom(to target: CGFloat, around point: CGPoint) {
        let clamped = min(max(target, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
        let anchor = toWorld(point)
        scale = clamped
        offset = CGPoint(x: point.x - anchor.x * scale, y: point.y - anchor.y * scale)
        applyTransform()
        refreshResolution()
    }

    func zoomIn() { zoom(to: scale * 1.25, around: viewCenter) }
    func zoomOut() { zoom(to: scale * 0.8, around: viewCenter) }
    func actualSize() { zoom(to: 1, around: viewCenter) }

    /// Everything on the board in view; an empty board centers its origin at 100%.
    func fitAll() {
        let frames = board.items.map(\.frame)
        guard let first = frames.first, bounds.width > 0 else {
            scale = 1
            offset = viewCenter
            applyTransform()
            return
        }
        let union = frames.dropFirst().reduce(first) { $0.union($1) }.insetBy(dx: -80, dy: -80)
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
            layer.place(item.frame)
            layer.zPosition = CGFloat(index)
        }
        CATransaction.commit()
        refreshResolution()
        updateOverlay()
        onViewportChange?(scale, board.items.isEmpty)
    }

    private func makeLayer(for item: CanvasItem) -> ItemLayer {
        let layer = ItemLayer()
        world.addSublayer(layer)
        layers[item.id] = layer
        return layer
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

    /// Selection outline, corner handles and hover ring, drawn in screen points so they never scale.
    private func updateOverlay() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let path = CGMutablePath()
        let selected = board.items.filter { selection.contains($0.id) }
        for item in selected { path.addRect(toView(item.frame)) }
        if selected.count == 1, let item = selected.first {
            for corner in Corner.allCases {
                path.addRoundedRect(in: handleRect(corner, of: item.frame), cornerWidth: 2, cornerHeight: 2)
            }
        }
        overlay.path = path
        if let hovered, !selection.contains(hovered), let item = board.items.first(where: { $0.id == hovered }) {
            hoverOutline.path = CGPath(rect: toView(item.frame), transform: nil)
        } else {
            hoverOutline.path = nil
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
        let center = point(of: corner, in: toView(frame)), size = Self.handleSize
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
        let point = convert(event.locationInWindow, from: nil)
        if isSpaceDown || event.buttonNumber == 2 {
            drag = .pan(start: point, origin: offset)
            NSCursor.closedHand.set()
            return
        }
        if let (item, corner) = handle(at: point) {
            drag = .resize(id: item.id, corner: corner, frame: item.frame, before: board.items)
            return
        }
        if let hit = item(at: point) {
            if event.clickCount == 2 {
                NSWorkspace.shared.open(board.url(of: hit))
                return
            }
            if event.modifierFlags.contains(.shift) || event.modifierFlags.contains(.command) {
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
        case .move(let start, let frames, _):
            // Past the edge of the canvas the images leave as files; here they go back where they were.
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
            marquee.path = CGPath(roundedRect: rect, cornerWidth: 3, cornerHeight: 3, transform: nil)
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
        if event.modifierFlags.contains(.command) || event.modifierFlags.contains(.control) {
            zoom(to: scale * exp(event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 0.01 : 0.1)), around: point)
        } else {
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
        func add(_ title: String, _ action: Selector) {
            menu.addItem(withTitle: title, action: action, keyEquivalent: "").target = self
        }
        if let hit = item(at: point) {
            if !selection.contains(hit.id) { selection = [hit.id] }
            add("Copiar", #selector(copy(_:)))
            add("Recortar", #selector(cut(_:)))
            add("Duplicar", #selector(duplicate(_:)))
            menu.addItem(.separator())
            add("Trazer pra frente", #selector(bringToFront(_:)))
            add("Mandar pra trás", #selector(sendToBack(_:)))
            menu.addItem(.separator())
            add("Abrir", #selector(openSelection(_:)))
            add("Mostrar no Finder", #selector(revealSelection(_:)))
            menu.addItem(.separator())
            add("Apagar", #selector(delete(_:)))
        } else {
            add("Colar", #selector(paste(_:)))
            add("Importar imagens…", #selector(importImages(_:)))
            menu.addItem(.separator())
            add("Selecionar tudo", #selector(selectAll(_:)))
            add("Ver tudo", #selector(fitAllAction(_:)))
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

    @objc func copy(_ sender: Any?) { board.copy(selectedItems) }

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
             #selector(bringToFront(_:)), #selector(sendToBack(_:)), #selector(openSelection(_:)), #selector(revealSelection(_:)):
            return !selection.isEmpty
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

/// One image: a soft shadow under a rounded, clipped picture.
private final class ItemLayer: CALayer {
    private let picture = CALayer()
    private(set) var image: CGImage?

    override init() {
        super.init()
        shadowColor = CGColor(gray: 0, alpha: 1)
        shadowOpacity = 0.28
        shadowRadius = 14
        shadowOffset = CGSize(width: 0, height: 6)
        picture.masksToBounds = true
        picture.cornerRadius = 6
        picture.contentsGravity = .resize
        picture.backgroundColor = CGColor(gray: 1, alpha: 0.12)
        addSublayer(picture)
    }

    override init(layer: Any) { super.init(layer: layer) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func place(_ frame: CGRect) {
        self.frame = frame
        picture.frame = bounds
        shadowPath = CGPath(roundedRect: bounds, cornerWidth: 6, cornerHeight: 6, transform: nil)
    }

    func show(_ image: CGImage) {
        self.image = image
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        picture.contents = image
        picture.backgroundColor = nil
        CATransaction.commit()
    }
}

/// Dots every 24 canvas units, thinned out when zoomed far out so the grid never turns into noise.
private final class DotGridLayer: CALayer {
    var offset = CGPoint.zero
    var scale: CGFloat = 1

    override func draw(in context: CGContext) {
        var spacing = 24 * scale
        while spacing < 14 { spacing *= 2 }
        let radius: CGFloat = 1.1
        func start(_ value: CGFloat) -> CGFloat {
            let remainder = value.truncatingRemainder(dividingBy: spacing)
            return remainder < 0 ? remainder + spacing : remainder
        }
        context.setFillColor(CGColor(gray: 1, alpha: 0.28))
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
