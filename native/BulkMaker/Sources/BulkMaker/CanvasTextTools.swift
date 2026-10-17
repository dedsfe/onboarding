import AppKit
import Vision

/// Typing into a canvas text box. Esc, ⌘↩ or clicking elsewhere finishes; ↩ is a new line.
final class CanvasTextEditor: NSTextView, NSTextViewDelegate {
    var onDone: (() -> Void)?

    override func cancelOperation(_ sender: Any?) { onDone?() }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 36, event.modifierFlags.contains(.command) { onDone?(); return }
        super.keyDown(with: event)
    }

    func textDidEndEditing(_ notification: Notification) { onDone?() }
}

/// Reads the words written in images (Vision, on device), line by line, top to bottom.
/// The model takes a while to load the first time, so the canvas warms it up when it opens;
/// several images are read at once, and each file is read only once.
enum ImageTextReader {
    private actor Memory {
        var texts: [String: String] = [:]
        func get(_ key: String) -> String? { texts[key] }
        func set(_ key: String, _ value: String) { texts[key] = value }
    }
    private static let memory = Memory()

    /// Loads the recognizer in the background, so the first real read is fast. The first time after a restart or a
    /// macOS update, the system compiles the model for this Mac (~30 s); after that a read takes a fraction of a second.
    /// The image has words on purpose: a blank one never reaches the recognition stage, so that stage stayed cold.
    static func warmUp() {
        guard ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil && NSClassFromString("XCTestCase") == nil else { return }
        Task.detached(priority: .utility) {
            guard let context = CGContext(data: nil, width: 320, height: 64, bitsPerComponent: 8, bytesPerRow: 0,
                                          space: CGColorSpaceCreateDeviceRGB(),
                                          bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return }
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 320, height: 64))
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
            ("Texto 123" as NSString).draw(at: CGPoint(x: 16, y: 14), withAttributes: [
                .font: NSFont.systemFont(ofSize: 32, weight: .bold), .foregroundColor: NSColor.black])
            NSGraphicsContext.restoreGraphicsState()
            guard let sample = context.makeImage() else { return }
            _ = recognize(sample)
        }
    }

    static func read(_ url: URL) async -> String? {
        // Keyed by modification date too: a regenerated image at the same path is read again.
        let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        let key = url.path + "@" + String(modified?.timeIntervalSinceReferenceDate ?? 0)
        if let known = await memory.get(key) { return known }
        let text = await Task.detached(priority: .userInitiated) { () -> String in
            guard let image = CanvasBoard.displayImage(of: url, maxPixel: 2400) else { return "" }
            return recognize(image)
        }.value
        // Only words are remembered; an empty read (file still being written, a miss) is tried again next time.
        guard !text.isEmpty else { return nil }
        await memory.set(key, text)
        return text
    }

    /// All at once; the answer keeps the order of `urls` (nil where an image has no words).
    static func readAll(_ urls: [URL]) async -> [String?] {
        await withTaskGroup(of: (Int, String?).self) { group in
            for (index, url) in urls.enumerated() { group.addTask { (index, await read(url)) } }
            var texts = [String?](repeating: nil, count: urls.count)
            for await (index, text) in group { texts[index] = text }
            return texts
        }
    }

    private static func recognize(_ image: CGImage) -> String {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // Spanish alongside these makes Vision return nothing at all.
        request.recognitionLanguages = ["pt-BR", "en-US"]
        request.usesLanguageCorrection = true
        // Vision skips text shorter than 1/32 of the image by default, which drops captions and small print.
        request.minimumTextHeight = 0
        do {
            try VNImageRequestHandler(cgImage: image).perform([request])
        } catch {
            // The Neural Engine sometimes refuses the model (an "e5rt" error); the CPU reads the same words, a bit slower.
            // Before this, the error was swallowed and showed up as "no text found".
            NSLog("ImageTextReader: \(error.localizedDescription); trying again on the CPU")
            onCPU(request)
            do { try VNImageRequestHandler(cgImage: image).perform([request]) } catch {
                NSLog("ImageTextReader: CPU failed too: \(error.localizedDescription)")
                return ""
            }
        }
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
    }

    private static func onCPU(_ request: VNRequest) {
        guard let stages = try? request.supportedComputeStageDevices else { return }
        for (stage, devices) in stages {
            if let cpu = devices.first(where: { if case .cpu = $0 { return true } else { return false } }) {
                request.setComputeDevice(cpu, for: stage)
            }
        }
    }
}
