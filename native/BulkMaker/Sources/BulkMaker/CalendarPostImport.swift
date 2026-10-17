import AppKit
import CarouselEngine

/// Imported posts own a copy of their slides: deleting an image from the canvas or Finder never breaks the agenda.
enum CalendarPostImport {
    enum ImportError: LocalizedError {
        case empty, unreadable(String), projectChanged
        var errorDescription: String? {
            switch self {
            case .empty: return "Escolha pelo menos uma imagem."
            case .unreadable(let name): return "Não foi possível ler a imagem \(name)."
            case .projectChanged: return "O projeto mudou. Abra novamente o calendário no projeto desejado."
            }
        }
    }

    static func images(in urls: [URL]) -> [URL] {
        var seen = Set<String>()
        return urls.flatMap { url -> [URL] in
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true {
                return InputAssembler.files(in: url, kind: .photos)
            }
            return [url]
        }.filter { url in
            InputAssembler.isImage(url)
                && (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
                && seen.insert(url.standardizedFileURL.path).inserted
        }.map(\.standardizedFileURL)
    }

    /// Preserve the order already reviewed when more photos are selected.
    static func updating(_ current: [URL], with chosen: [URL]) -> [URL] {
        let selected = Set(chosen.map { $0.standardizedFileURL.path })
        let kept = current.filter { selected.contains($0.standardizedFileURL.path) }
        let existing = Set(kept.map { $0.standardizedFileURL.path })
        return kept + chosen.filter { !existing.contains($0.standardizedFileURL.path) }
    }

    /// Runs off the main actor. Only a fully prepared folder can be committed to the agenda.
    static func prepare(_ files: [URL], caption: String, in project: URL) throws -> URL {
        guard !files.isEmpty else { throw ImportError.empty }
        let fm = FileManager.default
        let parent = project.appendingPathComponent("Calendário", isDirectory: true)
        let folder = parent.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true)
        do {
            for (index, file) in files.enumerated() {
                guard InputAssembler.isImage(file), CanvasBoard.displayImage(of: file, maxPixel: 32) != nil else {
                    throw ImportError.unreadable(file.lastPathComponent)
                }
                let ext = file.pathExtension.lowercased()
                let copy = InputAssembler.batchImageTypes.contains(ext)
                let target = folder.appendingPathComponent(String(format: "slide-%03d.%@", index + 1, copy ? ext : "png"))
                if copy { try fm.copyItem(at: file, to: target) }
                else if let data = CanvasBoard.pngData(of: file) { try data.write(to: target, options: .atomic) }
                else { throw ImportError.unreadable(file.lastPathComponent) }
            }
            try caption.trimmingCharacters(in: .whitespacesAndNewlines)
                .write(to: folder.appendingPathComponent("legenda.txt"), atomically: true, encoding: .utf8)
            return folder
        } catch {
            try? fm.removeItem(at: folder)
            throw error
        }
    }

    /// Re-read immediately before saving, so a post added by the CLI while images were copied survives.
    @discardableResult
    static func commit(folder: URL, date: Date, caption: String, to agendaFile: URL, now: Date = Date()) throws -> PostAgenda.Post {
        var agenda = try PostAgenda.load(from: agendaFile)
        let day = PostAgenda.dayFormatter.string(from: date)
        let time = timeFormatter.string(from: date)
        agenda.posts.append(.init(folder: folder.standardizedFileURL.path, date: day, time: time,
                                  caption: caption.trimmingCharacters(in: .whitespacesAndNewlines), createdAt: now))
        let post = try agenda.move(folder: folder, date: day, time: time, now: now)
        try agenda.save(to: agendaFile)
        return post
    }

    static func suggestedDate(agenda: PostAgenda, now: Date = Date()) -> Date {
        if let slot = agenda.nextFreeSlot(now: now), let day = PostAgenda.dayFormatter.date(from: slot.date) {
            let parts = slot.time.split(separator: ":").compactMap { Int($0) }
            if parts.count == 2, let date = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day) { return date }
        }
        return Calendar.current.date(byAdding: .hour, value: 1, to: now) ?? now
    }

    private static var timeFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }
}

extension Notification.Name {
    static let showPostingCalendar = Notification.Name("showPostingCalendar")
}

@MainActor @Observable
final class CalendarPostCenter {
    static let shared = CalendarPostCenter(store: .shared)
    enum Source { case mac, canvas, selection }
    struct Request: Identifiable {
        let id = UUID()
        let project: ProjectFolder
        let agendaFile: URL
        let source: Source
        let files: [URL]
    }
    let store: ProjectStore
    var request: Request?
    var lastScheduledDate: Date?
    var lastScheduledProject: UUID?

    init(store: ProjectStore) { self.store = store }

    func present(_ source: Source, files: [URL] = []) {
        request = Request(project: store.current, agendaFile: store.liveAgenda, source: source,
                          files: CalendarPostImport.images(in: files))
    }

    func finish(_ post: PostAgenda.Post) {
        lastScheduledDate = PostAgenda.dayFormatter.date(from: post.date)
        lastScheduledProject = store.current.id
        request = nil
        NotificationCenter.default.post(name: .showPostingCalendar, object: lastScheduledDate)
    }
}
