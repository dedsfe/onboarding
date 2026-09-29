import XCTest
@testable import BulkMaker

@MainActor
final class BackgroundBatchRunnerTests: XCTestCase {
    func testRunsAProcessAndReportsCompletionWithoutATerminalView() async throws {
        let runner = BackgroundBatchRunner()
        try runner.launch(executable: URL(fileURLWithPath: "/bin/echo"), arguments: ["lote concluído"])

        for _ in 0..<40 {
            if runner.status == .completed && runner.recentOutput.contains("lote concluído") { break }
            try await Task.sleep(for: .milliseconds(50))
        }

        XCTAssertEqual(runner.status, .completed)
        XCTAssertTrue(runner.recentOutput.contains("lote concluído"))
    }
}
