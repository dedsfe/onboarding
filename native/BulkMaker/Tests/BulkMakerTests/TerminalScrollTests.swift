import AppKit
import SwiftTerm
import XCTest
@testable import BulkMaker

@MainActor
final class TerminalScrollTests: XCTestCase {
    private final class RecordingTerminal: ScrollableTerminalView {
        var sent = ""
        override func send(source: TerminalView, data: ArraySlice<UInt8>) {
            sent += String(decoding: data, as: UTF8.self)
        }
    }

    private final class Wheel: NSEvent {
        var amount: CGFloat = 3
        override var type: NSEvent.EventType { .scrollWheel }
        override var deltaY: CGFloat { amount }
        override var scrollingDeltaY: CGFloat { amount }
        override var hasPreciseScrollingDeltas: Bool { false }
        override var locationInWindow: NSPoint { CGPoint(x: 100, y: 100) }
        override var modifierFlags: NSEvent.ModifierFlags { [] }
        override var phase: NSEvent.Phase { [] }
    }

    func testWheelReachesCLIWhenItOwnsAlternateScreen() {
        let view = RecordingTerminal(frame: CGRect(x: 0, y: 0, width: 640, height: 480))
        view.feed(text: "\u{1b}[?1049h\u{1b}[?1000h\u{1b}[?1006h")
        XCTAssertTrue(view.getTerminal().isCurrentBufferAlternate)
        let event = Wheel()
        view.handleScrollWheel(event)
        XCTAssertTrue(view.sent.contains("\u{1b}[<64;"), "O CLI precisa receber a rolagem para cima")
        view.sent = ""
        event.amount = -3
        view.handleScrollWheel(event)
        XCTAssertTrue(view.sent.contains("\u{1b}[<65;"), "O CLI precisa receber a rolagem para baixo")
    }

    func testNormalShellScrollsHistoryWithoutSendingKeys() {
        let view = RecordingTerminal(frame: CGRect(x: 0, y: 0, width: 640, height: 480))
        view.feed(text: (1...200).map { "Linha \($0)\r\n" }.joined())
        let bottom = view.scrollPosition
        let event = Wheel()
        view.handleScrollWheel(event)
        XCTAssertLessThan(view.scrollPosition, bottom)
        event.amount = -3
        view.handleScrollWheel(event)
        XCTAssertEqual(view.scrollPosition, bottom)
        XCTAssertTrue(view.sent.isEmpty, "Rolar o shell não deve navegar no histórico de comandos")
    }

    func testAlternateScreenWithoutMouseUsesPageNavigation() {
        let view = RecordingTerminal(frame: CGRect(x: 0, y: 0, width: 640, height: 480))
        view.feed(text: "\u{1b}[?1049h")
        let event = Wheel()
        view.handleScrollWheel(event)
        XCTAssertEqual(view.sent, "\u{1b}[5~")
        view.sent = ""
        event.amount = -3
        view.handleScrollWheel(event)
        XCTAssertEqual(view.sent, "\u{1b}[6~")
    }
}
