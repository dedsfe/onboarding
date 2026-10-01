import AppKit
import ImageIO
import CarouselEngine
import SwiftUI

/// Posting calendar. Shows what the AI scheduled in `.bulk-maker/agenda.json`; with nothing scheduled
/// yet it keeps the visual preview built from the output folder.
struct CalendarPrototypeView: View {
    let outputFolder: URL?

    @State private var month = Calendar.current.startOfDay(for: Date())
    @State private var preview: CalendarPreview = .sample
    @State private var hoveredDay: Int?
    /// The card under the pointer in the open fan; it grows and comes to the front.
    @State private var focusedCard: String?
    @State private var isCarouselOpen = false
    @State private var openSlides: [URL] = []
    @State private var agenda = PostAgenda()
    @State private var agendaStamp: Date?
    @State private var showRules = false
    @State private var shareError: String?
    /// Slide files of each scheduled folder, listed once per agenda change instead of on every redraw.
    @State private var slidesByFolder: [String: [URL]] = [:]
    @State private var planStamps: [String: Date?] = [:]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let calendar: Calendar = {
        var value = Calendar(identifier: .gregorian)
        value.firstWeekday = 1
        return value
    }()

    var body: some View {
        GeometryReader { geometry in
            // The page runs under the floating nav; the panel starts below it with even margins around.
            let navInset: CGFloat = 80
            let margin: CGFloat = 32
            let panelWidth = min(geometry.size.width - margin * 2, 1020)
            let panelHeight = min(geometry.size.height - navInset - margin, 704)

            // No backdrop of its own: the app wallpaper from Settings shows through, like every other page.
            ZStack {
                calendarPanel(width: panelWidth, height: panelHeight)
                    .frame(width: panelWidth, height: panelHeight)
                    .glassEffect(.regular, in: .rect(cornerRadius: 38))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.top, navInset).padding(.bottom, margin)

                if isCarouselOpen {
                    CalendarCarouselViewer(slides: openSlides, onSlideChange: reportOpenPost) {
                        reportOpenPost(nil)
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
        .alert("Não deu pra enviar", isPresented: Binding(get: { shareError != nil }, set: { if !$0 { shareError = nil } })) {
            Button("OK") { shareError = nil }
        } message: { Text(shareError ?? "") }
    }

    private static var agendaFile: URL {
        TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/agenda.json")
    }

    private func reloadAgenda() {
        // Every render rewrites the variation's .plano.json: a newer one means its slides were redone.
        for folder in agenda.posts.map(\.folder) {
            let rendered = (try? URL(fileURLWithPath: folder).appendingPathComponent(".plano.json")
                .resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if rendered != planStamps[folder] {
                planStamps[folder] = rendered
                slidesByFolder[folder] = CalendarPreview.slides(in: URL(fileURLWithPath: folder))
            }
        }
        let stamp = (try? Self.agendaFile.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
        guard stamp != agendaStamp else { return }
        agendaStamp = stamp
        if let loaded = try? PostAgenda.load(from: Self.agendaFile) {
            agenda = loaded
            listSlides()
        }
    }

    private func listSlides() {
        let folders = Set(agenda.posts.map(\.folder))
        slidesByFolder = Dictionary(uniqueKeysWithValues: folders.map {
            ($0, slidesByFolder[$0] ?? CalendarPreview.slides(in: URL(fileURLWithPath: $0)))
        })
    }

    /// Tells the AI which post and slide are on screen, so "troca essa imagem" has an address.
    private func reportOpenPost(_ slide: Int?) {
        let workspace = Self.agendaFile.deletingLastPathComponent()
        guard let slide, let first = openSlides.first else {
            AgentSession.updateOpenPost(nil, workspace: workspace)
            return
        }
        let folder = first.deletingLastPathComponent()
        let post = agenda.posts.first { $0.folder == folder.standardizedFileURL.path }
        let plan = try? JSONDecoder().decode(CarouselPlan.self,
                                             from: Data(contentsOf: folder.appendingPathComponent(".plano.json")))
        var line = (post.map { "post de \(PostAgenda.describe(date: $0.date, time: $0.time))" } ?? "carrossel")
            + " em `\(folder.path)`, slide \(slide + 1) de \(openSlides.count)"
        if let planned = plan?.slides, planned.indices.contains(slide) {
            line += " (foto `\(planned[slide].photo)`, texto \"\(planned[slide].text)\")"
        }
        AgentSession.updateOpenPost(line, workspace: workspace)
    }

    /// Load, change and save right away, so an edit here never clobbers a post the AI just added.
    private func updateRules(_ change: (inout PostAgenda.Rules) -> Void) {
        var fresh = (try? PostAgenda.load(from: Self.agendaFile)) ?? agenda
        change(&fresh.rules)
        try? fresh.save(to: Self.agendaFile)
        AgentSession.updateAgendaRules(fresh.rules, workspace: Self.agendaFile.deletingLastPathComponent())
        agenda = fresh
        listSlides()
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
                if !todayPosts.isEmpty {
                    Button { airDrop(todayPosts) } label: {
                        Label("Enviar hoje", systemImage: "square.and.arrow.up")
                            .font(.system(size: 13, weight: .medium))
                            .padding(.horizontal, 6)
                            .frame(height: 30)
                    }
                    .buttonStyle(.glass)
                    .help("Manda os carrosséis de hoje pro iPhone por AirDrop")
                    .padding(.trailing, 8)
                    .transition(.opacity)
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
            calendarStatus
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 64)
                .padding(.top, 12)
        }
        .padding(.horizontal, 30)
        .padding(.bottom, 24)
        .frame(width: width, height: height)
    }

    private var calendarStatus: some View {
        let monthKey = String(PostAgenda.dayFormatter.string(from: monthStart).prefix(7))
        let count = agenda.posts.filter { $0.date.hasPrefix(monthKey) }.count
        let hasPreview = agenda.posts.isEmpty && preview.coverURL != nil
        return SlidiMessage(state: count > 0 ? .happy : hasPreview ? .curious : .resting,
                            title: count > 0 ? "\(count) \(count == 1 ? "carrossel agendado" : "carrosséis agendados") neste mês"
                                : hasPreview ? "Prévia do seu carrossel" : "Agenda livre neste mês",
                            detail: count > 0 ? "Abra um post para revisar seus slides."
                                : hasPreview ? "Peça à IA para agendar quando estiver pronto."
                                : "Os carrosséis agendados pela IA aparecem aqui.", width: 28)
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

                let scheduled = posts(on: day).sorted { $0.time < $1.time }
                if scheduled.count > 1 {
                    // Several posts: one card per post, in posting order, each opening its own carousel.
                    slideFan(for: day, cards: scheduled.prefix(Self.maxFanCards).map { post in
                        let slides = slidesByFolder[post.folder] ?? []
                        return FanCard(id: post.id, cover: slides.first, time: post.time, slides: slides)
                    }, extra: scheduled.count - Self.maxFanCards)
                } else if let post = scheduled.first {
                    slideFan(for: day, cards: slideCards(slidesByFolder[post.folder] ?? [], time: post.time), extra: 0)
                } else if agenda.posts.isEmpty, day == previewDay, preview.coverURL != nil {
                    slideFan(for: day, cards: slideCards(preview.slides, time: nil), extra: 0)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.leading, 10)
        .padding(.top, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: height)
        .overlay(alignment: .top) { Color.primary.opacity(0.10).frame(height: 0.5) }
        .contentShape(Rectangle())
        .contextMenu {
            if let day, !posts(on: day).isEmpty {
                Button("Enviar por AirDrop", systemImage: "square.and.arrow.up") { airDrop(posts(on: day)) }
            }
        }
        .zIndex(hoveredDay == day ? 10 : 0)
    }

    private var todayPosts: [PostAgenda.Post] {
        let key = PostAgenda.dayFormatter.string(from: Date())
        return agenda.posts.filter { $0.date == key }
    }

    /// Sends every slide of the day's posts, in posting order, straight to the AirDrop picker.
    private func airDrop(_ posts: [PostAgenda.Post]) {
        let files = posts.sorted { $0.time < $1.time }.flatMap {
            slidesByFolder[$0.folder] ?? CalendarPreview.slides(in: URL(fileURLWithPath: $0.folder))
        }
        guard !files.isEmpty else {
            shareError = "Os slides desses posts não estão mais na pasta."
            return
        }
        guard let service = NSSharingService(named: .sendViaAirDrop), service.canPerform(withItems: files) else {
            shareError = "AirDrop indisponível. Confira se o Wi-Fi e o Bluetooth estão ligados."
            return
        }
        service.perform(withItems: files)
    }

    private static let maxFanCards = 4

    private struct FanCard: Identifiable {
        let id: String
        let cover: URL?
        /// Set when each card is its own post; shown under the card while the fan is open.
        let time: String?
        let slides: [URL]
    }

    /// One post: its first slides as cards, all opening the same carousel.
    private func slideCards(_ slides: [URL], time: String?) -> [FanCard] {
        slides.prefix(3).map { FanCard(id: $0.path, cover: $0, time: nil, slides: slides) }
    }

    private func slideFan(for day: Int, cards: [FanCard], extra: Int) -> some View {
        let expanded = hoveredDay == day
        let isPostList = cards.contains { $0.time != nil }
        // Post cards spread left to right in posting order; slide cards keep the cover
        // in the middle with the next slide left and the one after right.
        let sides: [CGFloat] = cards.indices.map {
            isPostList ? CGFloat($0) - CGFloat(cards.count - 1) / 2 : [0, -1, 1][$0]
        }
        let step: CGFloat = isPostList ? 24 : 26
        let hitWidth = expanded ? (sides.map(abs).max() ?? 0) * step * 2 + 72 : 48
        return ZStack {
            ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                let side = sides[index]
                let isFocused = expanded && focusedCard == card.id
                fanCardFace(card, expanded: expanded)
                    .scaleEffect(isFocused ? 1.14 : (expanded && focusedCard != nil ? 0.96 : 1), anchor: .bottom)
                    .rotationEffect(.degrees(Double(side) * (expanded ? (isPostList ? 9 : 12) : (isPostList ? 2.5 : 0))), anchor: .bottom)
                    .offset(x: side * (expanded ? step : (isPostList ? 3 : 0)), y: expanded ? (isFocused ? -14 : -8) : 0)
                    // A collapsed post list peeks out behind the first cover, so several posts read at a glance.
                    .opacity(expanded || isPostList || index == 0 ? 1 : 0)
                    .zIndex(isFocused ? 100 : Double(cards.count - index))
                    .allowsHitTesting(false)
            }
        }
        .frame(width: 48, height: 62)
        .overlay(alignment: .topTrailing) {
            // Only past what the fan can show.
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
        // One hit area for the whole fan, split into slices by distance to each card's center:
        // overlapping, rotated cards never fight over the pointer, and the area grows with the fan
        // so reaching the outer cards does not close it.
        .overlay {
            Color.clear
                .frame(width: hitWidth, height: expanded ? 100 : 62)
                .contentShape(Rectangle())
                .offset(y: expanded ? -10 : 0)
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let point):
                        let x = point.x - hitWidth / 2
                        let nearest = sides.indices.min { abs(sides[$0] * step - x) < abs(sides[$1] * step - x) }
                        let focus = expanded ? nearest.map { cards[$0].id } : nil
                        guard hoveredDay != day || focus != focusedCard else { return }
                        withAnimation(fanAnimation) {
                            hoveredDay = day
                            focusedCard = focus
                        }
                    case .ended:
                        withAnimation(fanAnimation) {
                            hoveredDay = nil
                            focusedCard = nil
                        }
                    }
                }
                .onTapGesture {
                    let card = cards.first { $0.id == focusedCard } ?? cards.first
                    openSlides = card?.slides ?? []
                    withAnimation(.easeOut(duration: 0.2)) { isCarouselOpen = true }
                }
                .pointerStyle(.link)
                .help(isPostList ? "Clique no post para ver o carrossel" : "Clique para ver o carrossel")
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isPostList ? "\(cards.count + max(extra, 0)) posts" : "Carrossel")
        .accessibilityAddTraits(.isButton)
    }

    private var fanAnimation: Animation {
        reduceMotion ? .linear(duration: 0.01) : .spring(response: 0.3, dampingFraction: 0.78)
    }

    private func fanCardFace(_ card: FanCard, expanded: Bool) -> some View {
        Group {
            if let cover = card.cover {
                SlideImage(url: cover, maxPixel: 240) { image in image.resizable().scaledToFill() }
            } else {
                Color.primary.opacity(0.08)
            }
        }
        .frame(width: expanded ? 60 : 48, height: expanded ? 80 : 62)
        .clipShape(RoundedRectangle(cornerRadius: expanded ? 10 : 9))
        .shadow(color: .black.opacity(expanded ? 0.18 : 0.08), radius: 6, x: 0, y: 3)
        .overlay(alignment: .bottom) {
            if let time = card.time, expanded {
                Text(time)
                    .font(.system(size: 10, weight: .semibold))
                    .monospacedDigit()
                    .padding(.horizontal, 5)
                    .frame(height: 16)
                    .background(Capsule().fill(.regularMaterial))
                    .offset(y: 9)
                    .transition(.opacity)
            }
        }
        .contentShape(Rectangle())
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
    var onSlideChange: (Int) -> Void = { _ in }
    let close: () -> Void

    @State private var selectedIndex = 0
    @State private var dragOffset: CGFloat = 0
    /// The open post's plan, edited from the panel beside the phone.
    @State private var session: SlideEditSession?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let editorWidth: CGFloat = 320

    var body: some View {
        GeometryReader { geometry in
            let phoneHeight = max(180, min(geometry.size.height - 132, 700,
                                           (geometry.size.width - 184 - Self.editorWidth) * 19.5 / 9))
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
                        if let session {
                            SlideEditorPanel(session: session, index: selectedIndex, close: close)
                                .frame(width: Self.editorWidth, height: phoneHeight)
                        }
                    }
                    .overlay(alignment: .topTrailing) {
                        // With the editor open, its ✓ closes the preview.
                        if session == nil {
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
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    Color.clear.frame(height: 32)
                }
                .environment(\.colorScheme, .dark)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .onChange(of: selectedIndex, initial: true) { _, index in onSlideChange(index) }
        .onAppear {
            if session == nil, let first = slides.first {
                session = SlideEditSession(folder: first.deletingLastPathComponent())
            }
        }
        // The AI can redo this post from the terminal while it is open.
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in session?.checkExternalChanges() }
        .onExitCommand(perform: close)
    }

    private func phone(width: CGFloat, height: CGFloat) -> some View {
                ZStack {
                    HStack(spacing: 0) {
                        ForEach(Array(slides.enumerated()), id: \.element) { index, url in
                            // The editor's newest render wins over the file; a redo by the AI reloads the file.
                            if let edited = session?.images[index] {
                                slideFace(Image(nsImage: edited), width: width, height: height)
                            } else {
                                slide(at: url, width: width, height: height)
                                    .id(session?.revision ?? 0)
                            }
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
        SlideImage(url: url, maxPixel: 1600) { image in
            slideFace(image, width: width, height: height)
        }
        .frame(width: width, height: height)
        .clipped()
    }

    private func slideFace(_ image: Image, width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            image
                .resizable()
                .scaledToFill()
                .frame(width: width, height: height)
                .blur(radius: 24)
                .overlay(.black.opacity(0.35))

            image
                .resizable()
                .scaledToFit()
                .frame(width: width, height: height)
        }
        .frame(width: width, height: height)
        .clipped()
    }
}

struct CalendarPreview {
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

/// A slide decoded off the main thread at the size it is shown and kept in memory,
/// so hover and drag animations only ever redraw pixels that are already decoded.
struct SlideImage<Content: View>: View {
    let url: URL
    let maxPixel: Int
    @ViewBuilder let content: (Image) -> Content
    @State private var image: NSImage?

    private static var cache: NSCache<NSString, NSImage> {
        SlideImageCache.shared
    }

    /// The file date is part of the key: a slide redrawn in place (editor or AI) decodes again.
    private var key: NSString {
        let modified = (try? URL(fileURLWithPath: url.path).resourceValues(forKeys: [.contentModificationDateKey]))?
            .contentModificationDate?.timeIntervalSinceReferenceDate ?? 0
        return "\(maxPixel)|\(url.path)|\(modified)" as NSString
    }

    var body: some View {
        Group {
            if let image = image ?? Self.cache.object(forKey: key) {
                content(Image(nsImage: image))
            } else {
                // Decoding takes a few milliseconds; the slide fades in when ready.
                Color.clear
            }
        }
        .task(id: key) {
            guard Self.cache.object(forKey: key) == nil else { return }
            let url = url, maxPixel = maxPixel
            let decoded = await Task.detached(priority: .userInitiated) { () -> CGImage? in
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
                return CGImageSourceCreateThumbnailAtIndex(source, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceShouldCacheImmediately: true,
                    kCGImageSourceThumbnailMaxPixelSize: maxPixel
                ] as CFDictionary)
            }.value
            guard let decoded else { return }
            let loaded = NSImage(cgImage: decoded, size: .zero)
            Self.cache.setObject(loaded, forKey: key)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}

private enum SlideImageCache {
    static let shared: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>()
        cache.countLimit = 300
        return cache
    }()
}
