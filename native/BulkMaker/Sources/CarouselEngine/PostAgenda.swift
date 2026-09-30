import Foundation

/// The posting calendar: rules the user answers once (how many per day, at what times, which weekdays)
/// and the posts already placed. Lives in `.bulk-maker/agenda.json`, shared by the app, the AI and the CLI.
public struct PostAgenda: Codable, Sendable, Equatable {
    public struct Rules: Codable, Sendable, Equatable {
        /// Most carousels on the same day.
        public var maxPerDay: Int
        /// Posting times, "HH:mm", in order of preference. Only the first `maxPerDay` are used each day.
        public var times: [String]
        /// Allowed weekdays, 1 = Sunday … 7 = Saturday (Calendar.weekday).
        public var weekdays: [Int]
        /// First day that may receive posts, "yyyy-MM-dd"; nil = today.
        public var startDate: String?

        public init(maxPerDay: Int = 2, times: [String] = ["12:00", "19:00"], weekdays: [Int] = Array(1...7),
                    startDate: String? = nil) {
            self.maxPerDay = maxPerDay
            self.times = times
            self.weekdays = weekdays
            self.startDate = startDate
        }
    }

    public struct Post: Codable, Sendable, Equatable, Identifiable {
        public var id: String
        /// Absolute path of the variation folder (slides + legenda.txt).
        public var folder: String
        public var date: String
        public var time: String
        public var caption: String
        public var createdAt: Date

        public init(id: String = UUID().uuidString, folder: String, date: String, time: String, caption: String,
                    createdAt: Date = Date()) {
            self.id = id
            self.folder = folder
            self.date = date
            self.time = time
            self.caption = caption
            self.createdAt = createdAt
        }
    }

    public var version = 1
    public var rules: Rules
    public var posts: [Post]

    public init(rules: Rules = Rules(), posts: [Post] = []) {
        self.rules = rules
        self.posts = posts
    }

    // MARK: - File

    public static func load(from url: URL) throws -> PostAgenda {
        guard FileManager.default.fileExists(atPath: url.path) else { return PostAgenda() }
        return try decoder.decode(PostAgenda.self, from: Data(contentsOf: url))
    }

    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Self.encoder.encode(self).write(to: url, options: .atomic)
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    // MARK: - Scheduling

    /// The earliest free (date, time) that follows the rules and is not in the past.
    public func nextFreeSlot(now: Date = Date(), calendar: Calendar = .current) -> (date: String, time: String)? {
        let dailyTimes = Array(rules.times.prefix(max(rules.maxPerDay, 0))).sorted()
        guard !dailyTimes.isEmpty, !rules.weekdays.isEmpty else { return nil }
        let taken = Set(posts.map { $0.date + " " + $0.time })
        var day = calendar.startOfDay(for: now)
        if let start = rules.startDate.flatMap(Self.dayFormatter.date(from:)), start > day { day = start }
        let nowStamp = Self.stamp(now)
        // Two years is far beyond any real queue; it only guards against an impossible rule set.
        for _ in 0..<730 {
            if rules.weekdays.contains(calendar.component(.weekday, from: day)) {
                let date = Self.dayFormatter.string(from: day)
                for time in dailyTimes where !taken.contains(date + " " + time) && date + " " + time > nowStamp {
                    return (date, time)
                }
            }
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return nil
    }

    /// Places a variation folder in the next free slot, reading its `legenda.txt`. A folder that is
    /// already on the agenda keeps its slot.
    @discardableResult
    public mutating func schedule(folder: URL, now: Date = Date(), calendar: Calendar = .current) throws -> Post {
        let path = folder.standardizedFileURL.path
        if let existing = posts.first(where: { $0.folder == path }) { return existing }
        guard let slot = nextFreeSlot(now: now, calendar: calendar) else { throw AgendaError.noFreeSlot }
        let caption = (try? String(contentsOf: folder.appendingPathComponent("legenda.txt"), encoding: .utf8)) ?? ""
        let post = Post(folder: path, date: slot.date, time: slot.time,
                        caption: caption.trimmingCharacters(in: .whitespacesAndNewlines), createdAt: now)
        posts.append(post)
        posts.sort { ($0.date, $0.time) < ($1.date, $1.time) }
        return post
    }

    /// Moves a scheduled folder to an exact "yyyy-MM-dd" + "HH:mm". The slot must be valid, in the
    /// future and not taken by another post; the daily limit is the user's call here, not enforced.
    @discardableResult
    public mutating func move(folder: URL, date: String, time: String, now: Date = Date()) throws -> Post {
        let path = folder.standardizedFileURL.path
        guard let index = posts.firstIndex(where: { $0.folder == path }) else { throw AgendaError.notScheduled(path) }
        guard Self.dayFormatter.date(from: date) != nil, Self.isTime(time) else { throw AgendaError.invalidSlot(date, time) }
        guard date + " " + time > Self.stamp(now) else { throw AgendaError.pastSlot(date, time) }
        if let other = posts.first(where: { $0.date == date && $0.time == time && $0.folder != path }) {
            throw AgendaError.slotTaken(date, time, URL(fileURLWithPath: other.folder).lastPathComponent)
        }
        posts[index].date = date
        posts[index].time = time
        posts.sort { ($0.date, $0.time) < ($1.date, $1.time) }
        return posts.first { $0.folder == path }!
    }

    /// Takes a folder off the agenda; the files stay where they are.
    public mutating func unschedule(folder: URL) throws {
        let path = folder.standardizedFileURL.path
        guard posts.contains(where: { $0.folder == path }) else { throw AgendaError.notScheduled(path) }
        posts.removeAll { $0.folder == path }
    }

    /// Upcoming posts, one line each, for the AI to read cheaply.
    public func summary(now: Date = Date()) -> String {
        let upcoming = posts.filter { $0.date + " " + $0.time > Self.stamp(now) }
        guard !upcoming.isEmpty else { return "nenhum post agendado" }
        return upcoming.map { "\(Self.describe(date: $0.date, time: $0.time)) · \($0.folder)" }.joined(separator: "\n")
    }

    private static func isTime(_ text: String) -> Bool {
        let parts = text.split(separator: ":")
        guard parts.count == 2, parts.allSatisfy({ $0.count == 2 }),
              let hour = Int(parts[0]), let minute = Int(parts[1]) else { return false }
        return (0..<24).contains(hour) && (0..<60).contains(minute)
    }

    public enum AgendaError: LocalizedError {
        case noFreeSlot
        case notScheduled(String)
        case invalidSlot(String, String)
        case pastSlot(String, String)
        case slotTaken(String, String, String)

        public var errorDescription: String? {
            switch self {
            case .noFreeSlot:
                return "Não achei horário livre com essas regras (confira dias da semana, horários e máximo por dia)."
            case .notScheduled(let folder): return "\(folder) não está na agenda."
            case .invalidSlot(let date, let time): return "Data ou hora inválida: \(date) \(time) (use yyyy-MM-dd HH:mm)."
            case .pastSlot(let date, let time): return "\(date) \(time) já passou."
            case .slotTaken(let date, let time, let other): return "\(date) \(time) já tem \(other)."
            }
        }
    }

    public static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static func stamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.string(from: date)
    }

    /// "qua 30/09 12:00" for reports and the batch state.
    public static func describe(date: String, time: String) -> String {
        guard let day = dayFormatter.date(from: date) else { return "\(date) \(time)" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "pt_BR")
        formatter.dateFormat = "EEE dd/MM"
        return formatter.string(from: day).replacingOccurrences(of: ".", with: "") + " " + time
    }
}
