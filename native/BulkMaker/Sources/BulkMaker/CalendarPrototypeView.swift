import AppKit
import SwiftUI

/// Visual calendar prototype. Scheduling and sharing will use this surface in later steps.
struct CalendarPrototypeView: View {
    let outputFolder: URL?
    let background: NSImage?

    @State private var month = Calendar.current.startOfDay(for: Date())
    @State private var preview: CalendarPreview = .sample
    @State private var hoveredDay: Int?
    @State private var isCarouselOpen = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let calendar: Calendar = {
        var value = Calendar(identifier: .gregorian)
        value.firstWeekday = 1
        return value
    }()

    var body: some View {
        GeometryReader { geometry in
            let panelWidth = min(geometry.size.width - 72, 1020)
            let panelHeight = min(geometry.size.height - 48, 704)

            ZStack {
                backdrop

                calendarPanel(width: panelWidth, height: panelHeight)
                    .frame(width: panelWidth, height: panelHeight)
                    .glassEffect(.regular, in: .rect(cornerRadius: 38))

                if isCarouselOpen {
                    CalendarCarouselViewer(slides: preview.slides) {
                        withAnimation(.easeOut(duration: 0.2)) { isCarouselOpen = false }
                    }
                    .transition(.opacity)
                    .zIndex(20)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .onAppear { preview = CalendarPreview.load(from: outputFolder) }
        .onChange(of: outputFolder) { _, folder in preview = CalendarPreview.load(from: folder) }
    }

    private var backdrop: some View {
        Group {
            if let image = background {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .overlay(Color.black.opacity(0.23))
            } else {
                Color(nsColor: .windowBackgroundColor)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func calendarPanel(width: CGFloat, height: CGFloat) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(month.formatted(.dateTime.month(.wide).locale(Locale(identifier: "pt_BR"))).capitalized)
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                    Text(month.formatted(.dateTime.year()))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("Prévia visual")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .padding(.trailing, 12)
                monthControls
            }
            .frame(height: 94)

            HStack(spacing: 0) {
                ForEach(["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"], id: \.self) { label in
                    Text(label)
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 10)
                }
            }
            .frame(height: 30)

            GeometryReader { grid in
                let slots = daySlots
                let rowHeight = grid.size.height / CGFloat(max(1, slots.count / 7))
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                    ForEach(slots.indices, id: \.self) { index in
                        dayCell(slots[index], height: rowHeight)
                    }
                }
            }
        }
        .padding(.horizontal, 30)
        .padding(.bottom, 24)
        .frame(width: width, height: height)
    }

    private var monthControls: some View {
        HStack(spacing: 4) {
            Button("Hoje") { withAnimation(.snappy(duration: 0.25)) { month = Date() } }
                .font(.system(size: 13, weight: .medium))
                .padding(.horizontal, 8)
            Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left").frame(width: 28, height: 30) }
                .help("Mês anterior")
            Button { shiftMonth(1) } label: { Image(systemName: "chevron.right").frame(width: 28, height: 30) }
                .help("Próximo mês")
        }
        .buttonStyle(.glass)
    }

    private func dayCell(_ day: Int?, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let day {
                Text("\(day)")
                    .font(.system(size: 14, weight: isToday(day) ? .bold : .medium))
                    .monospacedDigit()
                    .foregroundStyle(isToday(day) ? .primary : .secondary)
                    .frame(width: 27, height: 23, alignment: .center)
                    .background {
                        if isToday(day) { Circle().fill(Color.primary.opacity(0.12)) }
                    }

                if day == previewDay, preview.coverURL != nil {
                    slideFan(for: day)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 10)
        .padding(.top, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: height)
        .overlay(alignment: .top) { Color.primary.opacity(0.10).frame(height: 0.5) }
        .zIndex(hoveredDay == day ? 10 : 0)
    }

    private func slideFan(for day: Int) -> some View {
        let expanded = hoveredDay == day
        // A small hand of cards over the day itself: cover in the middle, next slide left, the one after right.
        let slides = Array(preview.slides.prefix(3))
        let side: [CGFloat] = [0, -1, 1]
        return Button {
            withAnimation(.easeOut(duration: 0.2)) { isCarouselOpen = true }
        } label: {
            ZStack {
                ForEach(slides.indices, id: \.self) { index in
                    if let image = NSImage(contentsOf: slides[index]) {
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: expanded ? 60 : 48, height: expanded ? 80 : 62)
                            .clipShape(RoundedRectangle(cornerRadius: expanded ? 10 : 9))
                            .shadow(color: .black.opacity(expanded ? 0.18 : 0), radius: 6, x: 0, y: 3)
                            .rotationEffect(.degrees(expanded ? Double(side[index]) * 12 : 0), anchor: .bottom)
                            .offset(x: expanded ? side[index] * 26 : 0, y: expanded ? -8 : 0)
                            .opacity(expanded || index == 0 ? 1 : 0)
                            .zIndex(index == 0 ? 1 : 0)
                    }
                }
            }
            .frame(width: 48, height: 62)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { inside in
            withAnimation(reduceMotion ? .linear(duration: 0.01) : .spring(response: 0.32, dampingFraction: 0.78)) {
                hoveredDay = inside ? day : nil
            }
        }
        .help("Clique para ver o carrossel")
    }

    private var previewDay: Int {
        let range = calendar.range(of: .day, in: .month, for: month) ?? 1..<31
        return min(12, range.count)
    }

    private var daySlots: [Int?] {
        let start = calendar.date(from: calendar.dateComponents([.year, .month], from: month)) ?? month
        let count = calendar.range(of: .day, in: .month, for: start)?.count ?? 30
        let leading = (calendar.component(.weekday, from: start) - calendar.firstWeekday + 7) % 7
        let days: [Int?] = Array(repeating: nil, count: leading) + (1...count).map(Optional.some)
        return days + Array(repeating: nil, count: (7 - days.count % 7) % 7)
    }

    private func isToday(_ day: Int) -> Bool {
        let today = Date()
        return calendar.isDate(month, equalTo: today, toGranularity: .month) &&
            calendar.component(.year, from: month) == calendar.component(.year, from: today) &&
            day == calendar.component(.day, from: today)
    }

    private func shiftMonth(_ delta: Int) {
        guard let next = calendar.date(byAdding: .month, value: delta, to: month) else { return }
        hoveredDay = nil
        withAnimation(.snappy(duration: 0.25)) { month = next }
    }
}

private struct CalendarCarouselViewer: View {
    let slides: [URL]
    let close: () -> Void

    @State private var selectedIndex = 0
    @State private var dragOffset: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            let phoneHeight = min(geometry.size.height - 72, 820)
            let phoneWidth = phoneHeight * 9 / 19.5

            ZStack {
                Rectangle()
                    .fill(.black.opacity(0.5))
                    .background(.ultraThinMaterial)
                    .onTapGesture(perform: close)

                ZStack {
                    HStack(spacing: 0) {
                        ForEach(slides, id: \.self) { url in
                            slide(at: url, width: phoneWidth, height: phoneHeight)
                        }
                    }
                    .frame(width: phoneWidth, height: phoneHeight, alignment: .leading)
                    .offset(x: -CGFloat(selectedIndex) * phoneWidth + dragOffset)

                    TikTokChrome(slideCount: slides.count, selectedSlide: selectedIndex)
                        .frame(width: phoneWidth, height: phoneHeight)
                }
                .frame(width: phoneWidth, height: phoneHeight)
                .background(.black)
                .clipShape(RoundedRectangle(cornerRadius: 46, style: .continuous))
                .gesture(
                    DragGesture(minimumDistance: 18)
                        .onChanged { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else { return }
                            dragOffset = value.translation.width
                        }
                        .onEnded { value in
                            let threshold = phoneWidth * 0.16
                            withAnimation(reduceMotion ? .linear(duration: 0.01) : .spring(response: 0.34, dampingFraction: 0.86)) {
                                if value.translation.width < -threshold {
                                    selectedIndex = min(selectedIndex + 1, slides.count - 1)
                                } else if value.translation.width > threshold {
                                    selectedIndex = max(selectedIndex - 1, 0)
                                }
                                dragOffset = 0
                            }
                        }
                )
                .environment(\.colorScheme, .dark)

                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 36, height: 36)
                }
                .buttonStyle(.glass)
                .help("Fechar prévia")
                .offset(x: phoneWidth / 2 + 32, y: -phoneHeight / 2 + 20)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .onExitCommand(perform: close)
    }

    private func slide(at url: URL, width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            if let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: width, height: height)
                    .blur(radius: 24)
                    .overlay(.black.opacity(0.35))

                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: width, height: height)
            }
        }
        .frame(width: width, height: height)
        .clipped()
    }
}

private struct CalendarPreview {
    let slides: [URL]
    var coverURL: URL? { slides.first }

    static var sample: Self {
        Self(slides: Bundle.module.url(forResource: "modelo-ugc", withExtension: "jpg").map { [$0] } ?? [])
    }

    static func load(from folder: URL?) -> Self {
        guard let folder,
              let entries = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.isDirectoryKey]) else {
            return .sample
        }
        let candidates = entries.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
        let imageExtensions = Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"])
        for directory in candidates + [folder] {
            guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { continue }
            let slides = files.filter { imageExtensions.contains($0.pathExtension.lowercased()) && $0.lastPathComponent.hasPrefix("slide-") }
                .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
            if !slides.isEmpty { return Self(slides: slides) }
        }
        return .sample
    }
}
