import AppKit
import SwiftTerm
import XCTest
@testable import BulkMaker

@MainActor
final class CanvasScrollMonitorTests: XCTestCase {
    private final class ScrollEvent: NSEvent {
        var targetWindow: NSWindow?
        var point: CGPoint = .zero
        override var window: NSWindow? { targetWindow }
        override var locationInWindow: NSPoint { point }
        override var scrollingDeltaX: CGFloat { 20 }
        override var scrollingDeltaY: CGFloat { -80 }
    }

    private func scroll(in window: NSWindow, at point: CGPoint) throws -> NSEvent {
        let event = ScrollEvent()
        event.targetWindow = window
        event.point = point
        return event
    }

    func testScrollViewAboveCanvasReceivesScrollInsteadOfPanningHiddenCanvas() throws {
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 600, height: 400),
                              styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.contentView = nil }
        let root = NSView(frame: CGRect(x: 0, y: 0, width: 600, height: 400))
        window.contentView = root
        let monitor = CanvasScrollMonitor.MonitoringView(frame: root.bounds)
        root.addSubview(monitor)
        let list = NSScrollView(frame: root.bounds)
        list.documentView = NSView(frame: CGRect(x: 0, y: 0, width: 600, height: 2000))
        root.addSubview(list)
        var pans = 0
        monitor.onScroll = { _ in pans += 1 }
        let event = try scroll(in: window, at: CGPoint(x: 300, y: 200))
        XCTAssertNotNil(monitor.handleScroll(event), "A lista de projetos precisa receber o gesto")
        XCTAssertEqual(pans, 0, "O canvas coberto não pode capturar a rolagem")
    }

    func testCanvasPansOnlyInsideItsBoundsAndWhenEnabled() throws {
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 600, height: 400),
                              styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.contentView = nil }
        let root = NSView(frame: CGRect(x: 0, y: 0, width: 600, height: 400))
        window.contentView = root
        let monitor = CanvasScrollMonitor.MonitoringView(frame: CGRect(x: 0, y: 0, width: 300, height: 400))
        root.addSubview(monitor)
        var deltas: [CGSize] = []
        monitor.onScroll = { deltas.append($0) }
        let inside = try scroll(in: window, at: CGPoint(x: 150, y: 200))
        XCTAssertNil(monitor.handleScroll(inside))
        XCTAssertEqual(deltas.count, 1)
        XCTAssertEqual(deltas.first, CGSize(width: inside.scrollingDeltaX, height: inside.scrollingDeltaY))
        let outside = try scroll(in: window, at: CGPoint(x: 450, y: 200))
        XCTAssertNotNil(monitor.handleScroll(outside))
        monitor.isEnabled = false
        XCTAssertNotNil(monitor.handleScroll(inside))
        XCTAssertEqual(deltas.count, 1)
    }

    func testTerminalAboveCanvasKeepsItsWheelEvents() throws {
        let window = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 600, height: 400),
                              styleMask: [.titled], backing: .buffered, defer: false)
        defer { window.contentView = nil }
        let root = NSView(frame: CGRect(x: 0, y: 0, width: 600, height: 400))
        window.contentView = root
        let monitor = CanvasScrollMonitor.MonitoringView(frame: root.bounds)
        root.addSubview(monitor)
        let terminal = LocalProcessTerminalView(frame: root.bounds)
        root.addSubview(terminal)
        var pans = 0
        monitor.onScroll = { _ in pans += 1 }
        XCTAssertNotNil(monitor.handleScroll(try scroll(in: window, at: CGPoint(x: 300, y: 200))))
        XCTAssertEqual(pans, 0)
    }
}
