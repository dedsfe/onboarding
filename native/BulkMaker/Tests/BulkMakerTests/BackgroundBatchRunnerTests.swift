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

    func testSuccessfulCLIExitWithoutSlidesIsReportedAsFailure() async throws {
        let output = FileManager.default.temporaryDirectory
            .appendingPathComponent("BulkMakerRunner-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: output) }
        let before = try BatchOutputValidator.capture(in: output, variations: 1)
        let runner = BackgroundBatchRunner()
        try runner.launch(executable: URL(fileURLWithPath: "/usr/bin/true"), arguments: [],
                          outputCheck: (output, 1, before))

        for _ in 0..<40 {
            if case .failed = runner.status { break }
            try await Task.sleep(for: .milliseconds(50))
        }
        guard case .failed(let message) = runner.status else {
            return XCTFail("A saída vazia foi marcada como concluída")
        }
        XCTAssertTrue(message.contains("variacao-01"))
    }
}
