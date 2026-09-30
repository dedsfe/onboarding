import AppKit
import CarouselEngine
import SwiftUI

/// Posting calendar. Shows what the AI scheduled in `.bulk-maker/agenda.json`; with nothing scheduled
/// yet it keeps the visual preview built from the output folder.
struct CalendarPrototypeView: View {
    let outputFolder: URL?

    @State private var month = Calendar.current.startOfDay(for: Date())
    @State private var preview: CalendarPreview = .sample
    @State private var hoveredDay: Int?
    @State private var isCarouselOpen = false
    @State private var openSlides: [URL] = []
    @State private var agenda = PostAgenda()
    @State private var agendaStamp: Date?
    @State private var showRules = false
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

            // No backdrop of its own: the app wallpaper from Settings shows through, like every other page.
            ZStack {
                calendarPanel(width: panelWidth, height: panelHeight)
                    .frame(width: panelWidth, height: panelHeight)
                    .glassEffect(.regular, in: .rect(cornerRadius: 38))

                if isCarouselOpen {
                    CalendarCarouselViewer(slides: openSlides) {
                        withAnimation(.easeOut(duration: 0.2)) { isCarouselOpen = false }
                    }
                    .transition(.opacity)
                    .zIndex(20)
                }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .onAppear {
            preview = CalendarPreview.load(from: outputFolder)
            reloadAgenda()
        }
        .onChange(of: outputFolder) { _, folder in preview = CalendarPreview.load(from: folder) }
        // The AI schedules from the terminal while this page is open.
        .onReceive(Timer.publish(every: 2, on: .main, in: .common).autoconnect()) { _ in reloadAgenda() }
    }

    private static var agendaFile: URL {
        TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/agenda.json")
    }

    private func reloadAgenda() {
        let stamp = (try? Self.agendaFile.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        guard stamp != agendaStamp else { return }
        agendaStamp = stamp
        if let loaded = try? PostAgenda.load(from: Self.agendaFile) { agenda = loaded }
    }

    /// Load, change and save right away, so an edit here never clobbers a post the AI just added.
    private func updateRules(_ change: (inout PostAgenda.Rules) -> Void) {
        var fresh = (try? PostAgenda.load(from: Self.agendaFile)) ?? agenda
        change(&fresh.rules)
        try? fresh.save(to: Self.agendaFile)
        agenda = fresh
        agendaStamp = (try? Self.agendaFile.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
    }

    private func posts(on day: Int) -> [PostAgenda.Post] {
        guard let date = calendar.date(bySetting: .day, value: day, of: monthStart) else { return [] }
        let key = PostAgenda.dayFormatter.string(from: date)
        return agenda.posts.filter { $0.date == key }
    }

    private var monthStart: Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: month)) ?? month
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
                if agenda.posts.isEmpty {
                    Text("Prévia visual")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.trailing, 12)
                }
                Button { showRules = true } label: {
                    Label("\(agenda.rules.maxPerDay) por dia", systemImage: "slider.horizontal.3")
                        .font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 6)
                        .frame(height: 30)
                }
                .buttonStyle(.glass)
                .help("Quantos carrosséis por dia, em que horários e dias")
                .popover(isPresented: $showRules, arrowEdge: .bottom) {
                    AgendaRulesEditor(rules: agenda.rules, update: updateRules)
                }
                .padding(.trailing, 8)
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

                let scheduled = posts(on: day)
                if let post = scheduled.first {
                    slideFan(for: day, slides: CalendarPreview.slides(in: URL(fileURLWithPath: post.folder)),
                             help: scheduled.map { "\($0.time) · \(URL(fileURLWithPath: $0.folder).lastPathComponent)" }
                                .joined(separator: "\n"),
                             extra: scheduled.count - 1)
                } else if agenda.posts.isEmpty, day == previewDay, preview.coverURL != nil {
                    slideFan(for: day, slides: preview.slides, help: "Clique para ver o carrossel", extra: 0)
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

    private func slideFan(for day: Int, slides allSlides: [URL], help: String, extra: Int) -> some View {
        let expanded = hoveredDay == day
        // A small hand of cards over the day itself: cover in the middle, next slide left, the one after right.
        let slides = Array(allSlides.prefix(3))
        let side: [CGFloat] = [0, -1, 1]
        return Button {
            openSlides = allSlides
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
            .overlay(alignment: .topTrailing) {
                // More than one post that day: the fan shows the first, the badge says how many more.
                if extra > 0 && !expanded {
                    Text("+\(extra)")
                        .font(.system(size: 11, weight: .bold))
                        .monospacedDigit()
                        .padding(.horizontal, 5)
                        .frame(height: 18)
                        .background(Capsule().fill(.regularMaterial))
                        .offset(x: 10, y: -6)
                }
            }
        }
        .buttonStyle(.plain)
        .onHover { inside in
            withAnimation(reduceMotion ? .linear(duration: 0.01) : .spring(response: 0.32, dampingFraction: 0.78)) {
                hoveredDay = inside ? day : nil
            }
        }
        .help(help)
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
            let phoneHeight = max(180, min(geometry.size.height - 132, 700,
                                           (geometry.size.width - 160) * 19.5 / 9))
            let phoneWidth = phoneHeight * 9 / 19.5

            ZStack {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .overlay(.black.opacity(0.22))
                    .onTapGesture(perform: close)

                VStack(spacing: 0) {
                    Color.clear.frame(height: 100)
                    HStack(spacing: 24) {
                        navigationButton("chevron.left", direction: -1, label: "Slide anterior")
                        phone(width: phoneWidth, height: phoneHeight)
                        navigationButton("chevron.right", direction: 1, label: "Próximo slide")
                    }
                    .overlay(alignment: .topTrailing) {
                        Button(action: close) {
                            Image(systemName: "xmark")
                                .font(.system(size: 12, weight: .semibold))
                                .frame(width: 18, height: 18)
                        }
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .controlSize(.small)
                        .help("Fechar prévia")
                        .accessibilityLabel("Fechar prévia")
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Color.clear.frame(height: 32)
                }
                .environment(\.colorScheme, .dark)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .onExitCommand(perform: close)
    }

    private func phone(width: CGFloat, height: CGFloat) -> some View {
                ZStack {
                    HStack(spacing: 0) {
                        ForEach(slides, id: \.self) { url in
                            slide(at: url, width: width, height: height)
                        }
                    }
                    .frame(width: width, height: height, alignment: .leading)
                    .offset(x: -CGFloat(selectedIndex) * width + dragOffset)

                    TikTokChrome(slideCount: slides.count, selectedSlide: selectedIndex)
                        .frame(width: width, height: height)
                }
                .frame(width: width, height: height)
                .background(.black)
                .clipShape(RoundedRectangle(cornerRadius: width * 0.15, style: .continuous))
                .gesture(
                    DragGesture(minimumDistance: 18)
                        .onChanged { value in
                            guard abs(value.translation.width) > abs(value.translation.height) else { return }
                            dragOffset = value.translation.width
                        }
                        .onEnded { value in
                            let threshold = width * 0.16
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
    }

    private func navigationButton(_ symbol: String, direction: Int, label: String) -> some View {
        let next = selectedIndex + direction
        let available = slides.indices.contains(next)
        return Button {
            withAnimation(reduceMotion ? .linear(duration: 0.01) : .spring(response: 0.34, dampingFraction: 0.86)) {
                selectedIndex = next
                dragOffset = 0
            }
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 18, height: 18)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .controlSize(.small)
        .disabled(!available)
        .opacity(available ? 1 : 0.35)
        .help(label)
        .accessibilityLabel(label)
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

    /// `slide-NN` images of one variation folder, in order.
    static func slides(in folder: URL) -> [URL] {
        let imageExtensions = Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic"])
        return ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
            .filter { imageExtensions.contains($0.pathExtension.lowercased()) && $0.lastPathComponent.hasPrefix("slide-") }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
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

/// The calendar's questions: how many carousels a day, at what times, on which days.
private struct AgendaRulesEditor: View {
    @State var rules: PostAgenda.Rules
    let update: ((inout PostAgenda.Rules) -> Void) -> Void

    private static let dayLabels = [(1, "D"), (2, "S"), (3, "T"), (4, "Q"), (5, "Q"), (6, "S"), (7, "S")]
    private static let defaultTimes = ["12:00", "19:00", "09:00", "21:00", "15:00", "07:00"]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Carrosséis por dia").font(.system(size: 13, weight: .medium))
                Spacer(minLength: 16)
                Stepper(value: Binding(get: { rules.maxPerDay }, set: setMax), in: 1...6) {
                    Text("\(rules.maxPerDay)").font(.system(size: 15, weight: .semibold)).monospacedDigit()
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Horários").font(.system(size: 13, weight: .medium))
                ForEach(0..<min(rules.maxPerDay, rules.times.count), id: \.self) { index in
                    DatePicker("", selection: timeBinding(index), displayedComponents: .hourAndMinute)
                        .labelsHidden()
                        .datePickerStyle(.field)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Dias").font(.system(size: 13, weight: .medium))
                HStack(spacing: 6) {
                    ForEach(Self.dayLabels, id: \.0) { weekday, label in
                        let isOn = rules.weekdays.contains(weekday)
                        Button(label) { toggle(weekday) }
                            .font(.system(size: 12, weight: .semibold))
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(isOn ? Color.accentColor : Color.primary.opacity(0.08)))
                            .foregroundStyle(isOn ? Color.white : Color.primary)
                            .buttonStyle(.plain)
                            .help(Calendar(identifier: .gregorian).weekdaySymbols[weekday - 1])
                    }
                }
            }
        }
        .padding(18)
        .frame(width: 260)
    }

    private func save() {
        let snapshot = rules
        update { $0 = snapshot }
    }

    private func setMax(_ value: Int) {
        rules.maxPerDay = value
        for time in Self.defaultTimes where rules.times.count < value && !rules.times.contains(time) {
            rules.times.append(time)
        }
        save()
    }

    private func toggle(_ weekday: Int) {
        if rules.weekdays.contains(weekday) {
            guard rules.weekdays.count > 1 else { return }  // at least one day stays on
            rules.weekdays.removeAll { $0 == weekday }
        } else {
            rules.weekdays.append(weekday)
            rules.weekdays.sort()
        }
        save()
    }

    private func timeBinding(_ index: Int) -> Binding<Date> {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return Binding(
            get: { formatter.date(from: rules.times[index]) ?? Date() },
            set: { rules.times[index] = formatter.string(from: $0); save() }
        )
    }
}
