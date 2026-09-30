import CarouselEngine
import XCTest
@testable import BulkMaker

final class PostAgendaTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }()

    private func date(_ text: String) -> Date {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm"
        return formatter.date(from: text)!
    }

    func testFillsTodayThenMovesOnRespectingTheDailyLimit() throws {
        var agenda = PostAgenda(rules: .init(maxPerDay: 2, times: ["19:00", "12:00", "08:00"]))
        let now = date("2026-09-30 10:00")  // quarta; só os 2 primeiros da lista contam (19:00 e 12:00)
        let folders = (1...3).map { URL(fileURLWithPath: "/tmp/saida/variacao-0\($0)") }
        let placed = try folders.map { try agenda.schedule(folder: $0, now: now, calendar: calendar) }
        XCTAssertEqual(placed.map { "\($0.date) \($0.time)" },
                       ["2026-09-30 12:00", "2026-09-30 19:00", "2026-10-01 12:00"])
    }

    func testSkipsPastTimesAndBlockedWeekdays() {
        // Só segunda (2) e quarta (4); agora é quarta 13:00, então o 12:00 de hoje já passou.
        let agenda = PostAgenda(rules: .init(maxPerDay: 2, times: ["12:00", "19:00"], weekdays: [2, 4]))
        let slot = agenda.nextFreeSlot(now: date("2026-09-30 13:00"), calendar: calendar)
        XCTAssertEqual(slot?.date, "2026-09-30")
        XCTAssertEqual(slot?.time, "19:00")
        let later = agenda.nextFreeSlot(now: date("2026-09-30 20:00"), calendar: calendar)
        XCTAssertEqual(later?.date, "2026-10-05")
    }

    func testSameFolderKeepsItsSlotAndCaptionComesFromLegenda() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("agenda-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        try "legenda do post\n#fe\n".write(to: folder.appendingPathComponent("legenda.txt"), atomically: true, encoding: .utf8)
        var agenda = PostAgenda(rules: .init(startDate: "2026-10-10"))
        let first = try agenda.schedule(folder: folder, now: date("2026-09-30 09:00"), calendar: calendar)
        let again = try agenda.schedule(folder: folder, now: date("2026-09-30 09:00"), calendar: calendar)
        XCTAssertEqual(first, again)
        XCTAssertEqual(agenda.posts.count, 1)
        XCTAssertEqual(first.date, "2026-10-10")
        XCTAssertEqual(first.caption, "legenda do post\n#fe")

        let file = folder.appendingPathComponent("agenda.json")
        try agenda.save(to: file)
        XCTAssertEqual(try PostAgenda.load(from: file), agenda)
    }

    func testImpossibleRulesSayWhy() {
        var agenda = PostAgenda(rules: .init(maxPerDay: 0))
        XCTAssertThrowsError(try agenda.schedule(folder: URL(fileURLWithPath: "/tmp/x")))
    }

    func testStateShowsAgendaRulesToTheAI() {
        let state = AgentSession.state(photos: nil, desired: nil, csv: nil, output: nil, variations: 1,
                                       design: DesignPreferences(), custom: false,
                                       agenda: .init(maxPerDay: 3, times: ["09:00", "12:00", "19:00"], weekdays: [2, 3, 4, 5, 6]))
        XCTAssertTrue(state.contains("Agenda: até 3 por dia, às 09:00 e 12:00 e 19:00, seg, ter, qua, qui, sex"))
        XCTAssertTrue(AgentSession.instructions.contains("--agendar"))
    }

    func testMoveAndUnscheduleGuardTheCalendar() throws {
        let now = date("2026-09-30 09:00")
        var agenda = PostAgenda()
        let a = URL(fileURLWithPath: "/tmp/saida/variacao-01"), b = URL(fileURLWithPath: "/tmp/saida/variacao-02")
        try agenda.schedule(folder: a, now: now, calendar: calendar)
        try agenda.schedule(folder: b, now: now, calendar: calendar)
        XCTAssertEqual(try agenda.move(folder: a, date: "2026-10-03", time: "21:00", now: now).date, "2026-10-03")
        XCTAssertThrowsError(try agenda.move(folder: b, date: "2026-10-03", time: "21:00", now: now))  // ocupado
        XCTAssertThrowsError(try agenda.move(folder: b, date: "2026-09-29", time: "21:00", now: now))  // passado
        XCTAssertThrowsError(try agenda.move(folder: b, date: "2026-10-03", time: "25:00", now: now))  // inválido
        try agenda.unschedule(folder: b)
        XCTAssertEqual(agenda.posts.map(\.folder), [a.path])
        XCTAssertTrue(agenda.summary(now: now).contains("sáb 03/10 21:00"))
    }

    func testCalendarRuleChangeReachesTheAIState() throws {
        let workspace = FileManager.default.temporaryDirectory.appendingPathComponent("agenda-state-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: workspace) }
        try AgentSession.install(in: workspace, state: AgentSession.state(
            photos: nil, desired: nil, csv: nil, output: nil, variations: 1, design: DesignPreferences(), custom: false))
        AgentSession.updateAgendaRules(.init(maxPerDay: 3, times: ["09:00", "12:00", "19:00"]), workspace: workspace)
        let state = try String(contentsOf: workspace.appendingPathComponent("estado.md"), encoding: .utf8)
        XCTAssertTrue(state.contains("- Agenda: até 3 por dia, às 09:00 e 12:00 e 19:00"))
        XCTAssertTrue(AgentSession.instructions.contains(".plano.json"))
        XCTAssertTrue(AgentSession.instructions.contains("--mover"))
    }

    func testOpenPostLineFollowsTheCalendarViewer() throws {
        let workspace = FileManager.default.temporaryDirectory.appendingPathComponent("open-post-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: workspace) }
        try AgentSession.install(in: workspace, state: AgentSession.state(
            photos: nil, desired: nil, csv: nil, output: nil, variations: 1, design: DesignPreferences(), custom: false))
        let stateFile = workspace.appendingPathComponent("estado.md")
        AgentSession.updateOpenPost("post de qui 01/10 12:00 em `/tmp/v1`, slide 2 de 5", workspace: workspace)
        AgentSession.updateOpenPost("post de qui 01/10 12:00 em `/tmp/v1`, slide 3 de 5", workspace: workspace)
        let open = try String(contentsOf: stateFile, encoding: .utf8).components(separatedBy: "\n")
        XCTAssertEqual(open.filter { $0.hasPrefix("- Aberto na tela:") }, ["- Aberto na tela: post de qui 01/10 12:00 em `/tmp/v1`, slide 3 de 5"])
        XCTAssertEqual(open.firstIndex { $0.hasPrefix("- Aberto na tela:") }, open.firstIndex { $0.hasPrefix("- Agenda:") }.map { $0 + 1 })
        AgentSession.updateOpenPost(nil, workspace: workspace)
        XCTAssertFalse(try String(contentsOf: stateFile, encoding: .utf8).contains("Aberto na tela"))
        XCTAssertTrue(AgentSession.instructions.contains("\"essa imagem\""))
    }
}
