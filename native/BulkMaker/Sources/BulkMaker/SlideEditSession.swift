import AppKit
import CarouselEngine
import Observation

/// The post open in the calendar preview, editable: its `.plano.json` stays in memory, every change is
/// saved and the open slide is redrawn in-process (CarouselEngine, no CLI) a moment after the last change.
/// Changes the AI makes from the terminal are picked up too.
@MainActor @Observable
final class SlideEditSession {
    enum Scope { case slide, post }

    let folder: URL
    private(set) var plan: CarouselPlan?
    /// Newest render of each slide, shown by the preview instead of the file on disk.
    private(set) var images: [Int: NSImage] = [:]
    /// Bumps when the slides on disk changed from outside (the AI), so the preview reloads them.
    private(set) var revision = 0
    private(set) var isRendering = false
    private(set) var error: String?
    var scope: Scope = .slide

    private var planStamp: Date?
    /// Slides whose render is older than the plan.
    private var dirty: Set<Int> = []
    private var pending: Task<Void, Never>?
    private var photoLists: [String: [URL]] = [:]

    private var planFile: URL { folder.appendingPathComponent(".plano.json") }

    init(folder: URL) {
        self.folder = folder
        reload()
    }

    private func reload() {
        plan = try? JSONDecoder().decode(CarouselPlan.self, from: Data(contentsOf: planFile))
        planStamp = Self.stamp(of: planFile)
    }

    /// Polled while the preview is open: a newer `.plano.json` we did not write means the AI redid the post.
    func checkExternalChanges() {
        guard dirty.isEmpty, !isRendering, Self.stamp(of: planFile) != planStamp else { return }
        reload()
        images.removeAll()
        revision += 1
    }

    // MARK: - Reading

    func slide(_ index: Int) -> SlidePlan? {
        plan.flatMap { $0.slides.indices.contains(index) ? $0.slides[index] : nil }
    }

    /// The style the controls show: the slide's own (Auto = same as the post) or the post's.
    func preferences(for index: Int) -> DesignPreferences {
        guard let plan else { return DesignPreferences() }
        switch scope {
        case .post: return DesignPreferences(style: plan.style)
        case .slide:
            var own = slide(index)?.style ?? SlideStyle()
            own.position = own.position ?? slide(index)?.position
            return DesignPreferences(style: own)
        }
    }

    /// Photos next to the slide's current one, where the batch's photo folder is.
    func photos(for index: Int) -> [URL] {
        guard let photo = slide(index)?.photo else { return [] }
        let directory = URL(fileURLWithPath: (photo as NSString).expandingTildeInPath).deletingLastPathComponent()
        if let listed = photoLists[directory.path] { return listed }
        let images = Set(["jpg", "jpeg", "png", "heic", "webp"])
        let listed = ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil,
                                                                     options: [.skipsHiddenFiles])) ?? [])
            .filter { images.contains($0.pathExtension.lowercased()) }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
        photoLists[directory.path] = listed
        return listed
    }

    // MARK: - Editing

    func setStyle(_ preferences: DesignPreferences, for index: Int) {
        edit(index) { plan in
            switch scope {
            case .post:
                plan.setPostStyle(preferences.slideStyle)
                return Set(plan.slides.indices)
            case .slide:
                plan.setSlideStyle(preferences.slideStyle, at: index)
                return [index]
            }
        }
    }

    func setText(_ text: String, at index: Int) {
        edit(index) { plan in
            plan.slides[index].text = text
            // An empty slide cannot be drawn; keep the old image until there are words again.
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? [] : [index]
        }
    }

    func setPhoto(_ photo: URL, at index: Int) {
        edit(index) { plan in
            plan.slides[index].photo = photo.path
            return [index]
        }
    }

    /// Words of the slide's text, in order, for the highlight chips.
    func words(at index: Int) -> [String] {
        var seen = Set<String>()
        return (slide(index)?.text ?? "").split(whereSeparator: \.isWhitespace)
            .map { String($0).trimmingCharacters(in: .punctuationCharacters) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
    }

    func isHighlighted(_ word: String, at index: Int) -> Bool {
        (slide(index)?.highlight ?? []).contains { Self.covers($0, word) }
    }

    func toggleHighlight(_ word: String, at index: Int) {
        edit(index) { plan in
            if plan.slides[index].highlight.contains(where: { Self.covers($0, word) }) {
                plan.slides[index].highlight.removeAll { Self.covers($0, word) }
            } else {
                plan.slides[index].highlight.append(word)
            }
            return [index]
        }
    }

    /// A highlight covers a word when it is that word or a phrase with it.
    private static func covers(_ highlight: String, _ word: String) -> Bool {
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
        if highlight.compare(word, options: options) == .orderedSame { return true }
        return highlight.contains(" ") && highlight.split(separator: " ")
            .contains { String($0).trimmingCharacters(in: .punctuationCharacters).compare(word, options: options) == .orderedSame }
    }

    private func edit(_ index: Int, _ change: (inout CarouselPlan) -> Set<Int>) {
        guard var plan, plan.slides.indices.contains(index) else { return }
        let redraw = change(&plan)
        self.plan = plan
        dirty.formUnion(redraw)
        schedule(first: index)
    }

    // MARK: - Saving and drawing

    /// ~100ms after the last change: save the plan, draw the open slide, then any other slide it touched.
    /// A newer change cancels the wait and runs after the render in flight, so files never go back in time.
    private func schedule(first index: Int) {
        let previous = pending
        previous?.cancel()
        pending = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(100))
            guard !Task.isCancelled else { return }
            await previous?.value
            guard !Task.isCancelled else { return }
            await self?.flush(first: index)
        }
    }

    private func flush(first: Int) async {
        guard let plan else { return }
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try encoder.encode(plan).write(to: planFile, options: .atomic)
            planStamp = Self.stamp(of: planFile)
        } catch {
            self.error = "Não consegui salvar o plano: \(error.localizedDescription)"
            return
        }
        isRendering = true
        defer { isRendering = false }
        let order = ([first] + dirty.sorted()).filter { plan.slides.indices.contains($0) }
        for index in order where dirty.contains(index) {
            let slide = plan.slides[index], style = plan.style, format = plan.format
            let file = folder.appendingPathComponent(String(format: "slide-%02d.jpg", index + 1))
            let result = await Task.detached(priority: .userInitiated) { () -> Result<CGImage, Error> in
                Result {
                    let (image, _) = try SlideRenderer.render(slide, style: style, format: format, index: index + 1)
                    try Self.write(image, to: file)
                    return image
                }
            }.value
            // A newer change is waiting: it redraws what is still dirty with the newer plan.
            guard !Task.isCancelled else { return }
            dirty.remove(index)
            switch result {
            case .success(let image):
                images[index] = NSImage(cgImage: image, size: .zero)
                error = nil
            case .failure(let failure):
                error = failure.localizedDescription
            }
        }
    }

    /// Written beside and renamed over, so the calendar never reads a half-written slide.
    nonisolated private static func write(_ image: CGImage, to file: URL) throws {
        let temporary = file.deletingLastPathComponent().appendingPathComponent(".\(file.lastPathComponent).tmp")
        try SlideRenderer.writeJPEG(image, to: temporary)
        guard rename(temporary.path, file.path) == 0 else { throw RenderError.writeFailed(file.path) }
    }

    private static func stamp(of file: URL) -> Date? {
        (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }
}
