import AppKit
import CarouselEngine
import Foundation
import SwiftUI

@MainActor
final class AppControl {
    static let shared = AppControl()
    private let instance = UUID()
    private var published: AppControlWire.Endpoint?
    let directory: URL

    init(workspace: URL = TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker")) {
        directory = workspace.appendingPathComponent("control", isDirectory: true)
    }

    func poll(project: @autoclosure () -> UUID, perform: (AppCommand) throws -> AppControlWire.Reply) throws {
        let inbox = directory.appendingPathComponent("inbox", isDirectory: true)
        let replies = directory.appendingPathComponent("replies", isDirectory: true)
        for folder in [inbox, replies] { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
        try publish(project: project())
        let files = try FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        for file in files.prefix(20) {
            let reply: AppControlWire.Reply
            do {
                let request = try JSONDecoder().decode(AppControlWire.Request.self, from: Data(contentsOf: file))
                guard request.id.uuidString == file.deletingPathExtension().lastPathComponent else {
                    throw AppControlError("Identificador da ação inválido.")
                }
                guard request.expires > Date() else { try FileManager.default.removeItem(at: file); continue }
                guard request.endpoint.instance == instance, request.endpoint.project == project() else {
                    throw AppControlError("O app ou projeto mudou. Consulte status e envie o pedido para o projeto atual.")
                }
                let actionReply = try perform(request.command)
                try publish(project: project())
                reply = actionReply
            } catch { reply = .init(ok: false, message: error.localizedDescription) }
            // Remove before delivering so another poll does not execute this request again.
            try FileManager.default.removeItem(at: file)
            try JSONEncoder().encode(reply).write(to: replies.appendingPathComponent(file.lastPathComponent), options: .atomic)
        }
        // Unread replies from killed CLIs are not retained forever.
        for file in try FileManager.default.contentsOfDirectory(at: replies, includingPropertiesForKeys: [.contentModificationDateKey]) {
            if let date = try file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
               Date().timeIntervalSince(date) > 60 { try? FileManager.default.removeItem(at: file) }
        }
    }

    private func publish(project: UUID) throws {
        guard published?.project != project || published?.instance != instance else { return }
        let endpoint = AppControlWire.Endpoint(instance: instance, project: project)
        try JSONEncoder().encode(endpoint).write(to: directory.appendingPathComponent("endpoint.json"), options: .atomic)
        published = endpoint
    }

    static func result<T: Encodable>(_ value: T, message: String = "OK") throws -> AppControlWire.Reply {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return .init(ok: true, message: message, result: String(decoding: try encoder.encode(value), as: UTF8.self))
    }
}

/// Only the app's main window handles requests, even when several project windows are open.
struct AppControlWindowReader: NSViewRepresentable {
    let receive: (NSWindow?) -> Void
    func makeNSView(context: Context) -> WindowView { WindowView(receive: receive) }
    func updateNSView(_ view: WindowView, context: Context) {}

    final class WindowView: NSView {
        let receive: (NSWindow?) -> Void
        init(receive: @escaping (NSWindow?) -> Void) { self.receive = receive; super.init(frame: .zero) }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            let window = window
            DispatchQueue.main.async { [receive] in if let window { receive(window) } }
        }
    }
}

struct AppControlError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct ProjectFolderStatus: Encodable {
    let id: UUID
    let name: String
    let folder: String
    let canvas: String
    init(_ project: ProjectFolder) {
        id = project.id; name = project.name; folder = project.folder.path; canvas = project.canvasDirectory.path
    }
}

@MainActor
enum AppStyleCommand {
    static func apply(_ command: AppCommand) throws {
        guard command.mode == nil || command.mode == "agent" || command.mode == "custom" else {
            throw AppControlError("mode deve ser agent ou custom.")
        }
        guard command.mode != nil || command.style != nil else { throw AppControlError("Informe mode ou style.") }
        let defaults = UserDefaults.standard
        if let style = command.style {
            if let weight = style.weight, !(100...900).contains(weight) { throw AppControlError("Peso da fonte deve ser de 100 a 900.") }
            if let size = style.size, !size.isFinite || size < 1 || size > 500 { throw AppControlError("Tamanho da fonte deve ser de 1 a 500.") }
            if let width = style.strokeWidth, !width.isFinite || width < 0 || width > 50 { throw AppControlError("Contorno deve ser de 0 a 50.") }
            for color in [style.color, style.strokeColor, style.highlightColor].compactMap({ $0 }) {
                guard color.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil else {
                    throw AppControlError("Use cores em #RRGGBB.")
                }
            }
            if let font = style.font, NSFont(name: font, size: 16) == nil && !NSFontManager.shared.availableFontFamilies.contains(font) {
                throw AppControlError("Fonte não instalada: \(font).")
            }
            // Patch only the fields supplied, preserving choices made in the inspector.
            let fields: [(String, String?)] = [
                (DesignPreferences.titleFontKey, style.font), (DesignPreferences.titleWeightKey, style.weight.map(String.init)),
                (DesignPreferences.titleSizeKey, style.size.map { String(Int($0)) }), (DesignPreferences.textColorKey, style.color),
                (DesignPreferences.strokeWidthKey, style.strokeWidth.map { String(Int($0)) }),
                (DesignPreferences.strokeColorKey, style.strokeColor), (DesignPreferences.highlightKey, style.highlightColor),
                (DesignPreferences.positionKey, style.position?.rawValue), (DesignPreferences.alignKey, style.align?.rawValue),
                (DesignPreferences.caseKey, style.textCase?.rawValue)
            ]
            for (key, value) in fields { if let value { defaults.set(value, forKey: key) } }
        }
        defaults.set(command.mode ?? "custom", forKey: DesignPreferences.modeKey)
    }
}

@MainActor
enum CanvasCommands {
    static func perform(_ command: AppCommand, directory: URL) throws -> AppControlWire.Reply {
        let open = InfiniteCanvasView.controlViews.allObjects.filter { $0.board.directory == directory }
        for view in open { try view.prepareForAppCommand() }
        let view = open.first { $0.window === NSApp.mainWindow } ?? open.first
            ?? InfiniteCanvasView.controlView.flatMap { $0.board.directory == directory ? $0 : nil }
        if let view { try view.prepareForAppCommand() }
        let board = view?.board ?? CanvasBoard(directory: directory)
        board.reloadIfChangedOnDisk()
        if command.action == .canvasList { return try AppControl.result(board.items) }
        let before = board.items
        let ids = Set(command.ids ?? [])
        if [.canvasUpdate, .canvasRemove, .canvasArrange].contains(command.action) {
            guard !ids.isEmpty, ids.isSubset(of: Set(board.items.map(\.id))) else {
                throw AppControlError("Informe ids existentes retornados por canvasList.")
            }
        }
        let numbers = [command.x, command.y, command.width, command.height].compactMap { $0 }
        guard numbers.allSatisfy({ $0.isFinite && abs($0) <= 1_000_000 }),
              command.width.map({ $0 > 0 }) ?? true, command.height.map({ $0 > 0 }) ?? true else {
            throw AppControlError("Coordenadas inválidas ou tamanho menor que zero.")
        }
        switch command.action {
        case .canvasAddText:
            guard let text = command.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw AppControlError("Informe text para adicionar ao canvas.")
            }
            let right = board.items.map { $0.frame.maxX }.max().map { $0 + 80 } ?? 0
            _ = board.addText(text, at: CGPoint(x: command.x ?? right, y: command.y ?? 0))
        case .canvasUpdate:
            if command.text != nil, board.items.contains(where: { ids.contains($0.id) && !$0.isText }) {
                throw AppControlError("Só caixas de texto aceitam text. Para texto de slides, edite o plano do post.")
            }
            let updated = try board.items.map { item -> CanvasItem in
                guard ids.contains(item.id) else { return item }
                var next = item
                next.x = command.x ?? item.x; next.y = command.y ?? item.y
                next.width = command.width ?? item.width; next.height = command.height ?? item.height
                if item.isText {
                    var style = item.style ?? TextStyle()
                    if let text = command.text { next.text = text }
                    else if command.width != nil, item.width > 0 {
                        let factor = next.width / item.width
                        style.size *= factor
                        style.padding = style.padding.map { $0 * factor }
                        style.radius = style.radius.map { $0 * factor }
                    }
                    next.style = style
                    guard next.width > (style.padding ?? 0) * 2 + 2 else {
                        throw AppControlError("A largura não deixa espaço para o texto e suas margens.")
                    }
                    let size = CanvasText.measure(next.text ?? "", style: style, maxWidth: next.width)
                    if command.height == nil { next.height = size.height }
                    else if next.height < size.height {
                        throw AppControlError("A altura cortaria o texto. Omita height para ajustar automaticamente.")
                    }
                }
                return next
            }
            board.replaceItems(updated)
        case .canvasRemove: board.remove(ids)
        case .canvasArrange:
            let selected = board.items.filter { ids.contains($0.id) }
            var x = command.x ?? selected.map(\.x).min() ?? 0
            let y = command.y ?? selected.map(\.y).min() ?? 0
            for item in selected {
                board.setFrame(CGRect(x: x, y: y, width: item.width, height: item.height), of: item.id)
                x += item.width + 24
            }
            board.changed()
        default: throw AppControlError("Ação de canvas não reconhecida.")
        }
        view?.finishAppCommand(before: before)
        // CanvasBoard also serves the UI, whose save reports through its existing callback.
        let saved = try JSONDecoder().decode([CanvasItem].self, from: Data(contentsOf: directory.appendingPathComponent("board.json")))
        guard saved == board.items else { throw AppControlError("Não foi possível confirmar a gravação do canvas.") }
        return try AppControl.result(board.items, message: "Canvas atualizado.")
    }
}
