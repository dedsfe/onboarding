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
        let dailyTimes = Array(rules.times.sorted().prefix(max(rules.maxPerDay, 0)))
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

    public enum AgendaError: LocalizedError {
        case noFreeSlot
        public var errorDescription: String? {
            "Não achei horário livre com essas regras (confira dias da semana, horários e máximo por dia)."
        }
    }

    static let dayFormatter: DateFormatter = {
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
