import CarouselEngine
import Foundation
import IOKit.pwr_mgt

/// Publishes each scheduled post on Instagram at its calendar time, with no one at the Mac.
/// Only posts due after it was switched on go out, so turning it on never floods the feed with
/// old ones. While on, the Mac is kept from idle sleep.
@MainActor
final class InstagramAutoPoster: ObservableObject {
    static let shared = InstagramAutoPoster()

    struct State: Codable {
        var isOn = false
        var onSince: Date?
        var posted: [String: Date] = [:]
        var failed: [String: String] = [:]

        init() {}

        /// The AI may write just `{"isOn": true}`.
        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            isOn = try container.decodeIfPresent(Bool.self, forKey: .isOn) ?? false
            onSince = try container.decodeIfPresent(Date.self, forKey: .onSince)
            posted = try container.decodeIfPresent([String: Date].self, forKey: .posted) ?? [:]
            failed = try container.decodeIfPresent([String: String].self, forKey: .failed) ?? [:]
        }
    }

    @Published private(set) var state = State()
    @Published private(set) var postingID: String?
    @Published private(set) var lastMessage: String?
    @Published private(set) var lastMessageIsError = false

    private var timer: Timer?
    private var stateStamp: Date?
    private var sleepAssertion: IOPMAssertionID = 0
    /// A post missed while the app was closed still goes out this late; older ones are skipped.
    private let grace: TimeInterval = 60 * 60

    private static var workspace: URL { TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker") }
    private static var stateFile: URL { workspace.appendingPathComponent("instagram-auto.json") }
    private static var agendaFile: URL { workspace.appendingPathComponent("agenda.json") }

    private static let slotFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter
    }()

    func start() {
        guard timer == nil else { return }
        loadStateIfChanged()
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        tick()
    }

    func setOn(_ isOn: Bool) {
        state.isOn = isOn
        state.onSince = isOn ? Date() : nil
        save()
        updateSleepAssertion()
        tick()
    }

    /// The AI in the terminal switches posting on and off by writing `isOn` to the state file.
    private func loadStateIfChanged() {
        let stamp = (try? Self.stateFile.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        guard stamp != stateStamp else { return }
        stateStamp = stamp
        if let data = try? Data(contentsOf: Self.stateFile), let saved = try? JSONDecoder().decode(State.self, from: data) {
            state = saved
            // Switched on by hand in the file: count from now, like the toggle does.
            if state.isOn != (state.onSince != nil) {
                state.onSince = state.isOn ? Date() : nil
                save()
            }
        }
        updateSleepAssertion()
    }

    private func tick() {
        loadStateIfChanged()
        guard state.isOn, postingID == nil, !InstagramBrowser.shared.isBusy,
              InstagramBrowser.shared.health.issue == nil, let since = state.onSince,
              let agenda = try? PostAgenda.load(from: Self.agendaFile) else { return }
        let now = Date()
        let earliest = max(since, now.addingTimeInterval(-grace))
        let due = agenda.posts.compactMap { post -> (PostAgenda.Post, Date)? in
            guard state.posted[post.id] == nil, state.failed[post.id] == nil,
                  let at = Self.slotFormatter.date(from: post.date + " " + post.time),
                  at <= now, at >= earliest else { return nil }
            return (post, at)
        }
        guard let (post, _) = due.min(by: { $0.1 < $1.1 }) else { return }
        publish(post)
    }

    private func publish(_ post: PostAgenda.Post) {
        let slides = CalendarPreview.slides(in: URL(fileURLWithPath: post.folder))
        let when = PostAgenda.describe(date: post.date, time: post.time)
        postingID = post.id
        Task {
            do {
                guard !slides.isEmpty else { throw InstagramBrowser.PostError(message: "Os slides não estão mais na pasta.") }
                try await InstagramBrowser.shared.publish(slides: slides, caption: post.caption)
                state.posted[post.id] = Date()
                report("Postado: \(when)", error: false)
            } catch {
                // A security challenge pauses the queue; it does not consume the scheduled posts.
                if InstagramBrowser.shared.health.issue == nil {
                    state.failed[post.id] = error.localizedDescription
                }
                report("Falhou \(when): \(error.localizedDescription)", error: true)
            }
            save()
            postingID = nil
            // Another one may have come due while this went out.
            tick()
        }
    }

    private func report(_ message: String, error: Bool) {
        lastMessage = message
        lastMessageIsError = error
    }

    private func save() {
        try? FileManager.default.createDirectory(at: Self.workspace, withIntermediateDirectories: true)
        try? JSONEncoder().encode(state).write(to: Self.stateFile, options: .atomic)
        stateStamp = (try? Self.stateFile.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }

    private func updateSleepAssertion() {
        if state.isOn, sleepAssertion == 0 {
            IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep as CFString,
                                        IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                        "Postagem automática no Instagram" as CFString, &sleepAssertion)
        } else if !state.isOn, sleepAssertion != 0 {
            IOPMAssertionRelease(sleepAssertion)
            sleepAssertion = 0
        }
    }
}
