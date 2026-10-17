import AppKit
import SwiftUI

extension Notification.Name {
    /// Leaves onboarding straight into the open project's batch screen.
    static let enterCurrentProject = Notification.Name("enterCurrentProject")
}

/// First run, deconstructed like Dia's: no window. The whole screen becomes the stage. The desktop behind
/// blurs and dims, the screen's edges flood with a soft moving color, and the steps float in the middle.
/// It opens once (until `completedKey` is set) or with `--onboarding-preview`.
@MainActor
final class OnboardingStage {
    static let shared = OnboardingStage()
    static let completedKey = "onboardingCompleted"

    /// The full-screen stage: welcome and site only.
    private var window: NSWindow?
    /// The rest of onboarding, in a normal window the browser can sit on top of.
    private var stepsWindow: NSWindow?
    private var stepsDelegate: StepsWindowDelegate?
    private var model: OnboardingModel?

    var shouldPresent: Bool {
        ProcessInfo.processInfo.arguments.contains("--onboarding-preview")
            || !UserDefaults.standard.bool(forKey: Self.completedKey)
    }

    func presentIfNeeded() {
        guard shouldPresent else { return }
        present()
    }

    func present() {
        guard window == nil, stepsWindow == nil, let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let model = OnboardingModel()
        model.handoff = { [weak self] in self?.handoff() }
        self.model = model
        let stage = StageWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        stage.isOpaque = false
        stage.backgroundColor = .clear
        stage.hasShadow = false
        stage.level = .floating
        stage.collectionBehavior = [.fullScreenAuxiliary, .stationary, .ignoresCycle]
        stage.isReleasedWhenClosed = false
        stage.contentView = NSHostingView(rootView: OnboardingStageView(model: model, screenSize: screen.frame.size) { [weak self] into in
            self?.finish(enteringProject: into)
        })
        stage.setFrame(screen.frame, display: true)
        stage.makeKeyAndOrderFront(nil)
        NSApp.activate()
        window = stage
        #if DEBUG
        // Dev: `--onboarding-window <site> <step>` jumps straight to the window with that site read.
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--onboarding-window"), index + 1 < args.count,
           let url = SiteSnapshot.normalize(args[index + 1]) {
            let step = index + 2 < args.count ? Int(args[index + 2]).flatMap(OnboardingStep.init(rawValue:)) : nil
            setvbuf(stdout, nil, _IONBF, 0)
            Task {
                // The card rises like it does after "Começar", so the hand-off to the window can be seen.
                try? await Task.sleep(for: .seconds(1.2))
                withAnimation(.spring(response: 0.7, dampingFraction: 0.84)) { model.panelUp = true }
                model.snapshot = try? await SiteSnapshot.read(url)
                model.profile.whatItDoes = model.snapshot?.description ?? ""
                model.profile.umbrellaNiche = "Exemplo de nicho"
                model.profile.keywords = ["primeira busca de exemplo", "segunda busca", "terceira busca bem mais longa", "quarta", "quinta busca", "sexta busca"]
                model.researchTerm = model.profile.keywords[0]
                let research = TerminalHandoff.projectDirectory.appendingPathComponent(".bulk-maker/pesquisa")
                let modified = { (url: URL) in (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast }
                // A 4th argument on the research step runs that search for real; otherwise the latest one is shown.
                let liveTerm = index + 3 < args.count ? args[index + 3] : nil
                if let liveTerm, liveTerm != "auto", step == .research { model.researchTerm = liveTerm }
                if let step, [.research, .ready, .access].contains(step), liveTerm == nil,
                   let latest = (try? FileManager.default.contentsOfDirectory(at: research, includingPropertiesForKeys: [.contentModificationDateKey]))?
                       .filter({ FileManager.default.fileExists(atPath: $0.appendingPathComponent("resultado.json").path) })
                       .max(by: { modified($0) < modified($1) }) {
                    model.accounts = ResearchedAccount.load(from: latest)
                    model.chosen = ResearchedPost.ranked(model.accounts.flatMap(\.posts)).first
                }
                try? await Task.sleep(for: .seconds(2))
                model.step = step ?? .product
                withAnimation(.smooth(duration: 0.55)) { model.handingOff = true }
                handoff()
                // "auto": the real thing end to end, the AI reads the site, then the hunt runs with what it found.
                if liveTerm == "auto", step == .research {
                    model.understand()
                    while model.understanding { try? await Task.sleep(for: .milliseconds(300)) }
                    print("[hunt] understood:", model.understandError ?? "ok", "| term:", model.researchTerm,
                          "| competitors:", model.profile.competitors, "| sellers:", model.profile.sellerSearches)
                    model.research()
                } else if liveTerm != nil, step == .research { model.research() }
            }
        }
        #endif
    }

    /// Once the site is in, the edges fade away and onboarding moves into a normal window: from here on the
    /// person will open their browser, and a full-screen stage would be in the way. The window is born exactly
    /// where the site card was, takes its place, then grows into its own size while the glow recedes.
    private func handoff() {
        guard let model, let stage = window, let screen = stage.screen ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        let card = model.panelFrame
        let start = card.isEmpty
            ? NSRect(x: area.midX - 340, y: area.midY - 210, width: 680, height: 420)
            : NSRect(x: screen.frame.minX + card.minX, y: screen.frame.maxY - card.maxY, width: card.width, height: card.height)
        let steps = NSWindow(contentRect: start, styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
                             backing: .buffered, defer: false)
        steps.titlebarAppearsTransparent = true
        steps.titleVisibility = .hidden
        steps.isMovableByWindowBackground = true
        steps.isReleasedWhenClosed = false
        steps.isOpaque = false
        steps.backgroundColor = .clear
        // Above the stage while it takes the card's place.
        steps.level = .floating
        stepsWindow = steps
        morphing = true
        let hosting = NSHostingView(rootView: OnboardingWindowView(model: model) { [weak self] height in
            self?.fitSteps(to: height)
        } finish: { [weak self] into in
            self?.finish(enteringProject: into)
        })
        // The window's size is ours to set (it follows the step's height), not SwiftUI's.
        hosting.sizingOptions = []
        steps.contentView = hosting
        let delegate = StepsWindowDelegate { [weak self] in self?.finish(enteringProject: false) }
        steps.delegate = delegate
        stepsDelegate = delegate
        steps.alphaValue = 0
        steps.setFrame(start, display: true)
        steps.makeKeyAndOrderFront(nil)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.28
            steps.animator().alphaValue = 1
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self else { return }
            morphing = false
            fitSteps(to: stepsHeight, recenter: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.15) { [weak self] in
            stage.orderOut(nil)
            steps.level = .normal
            if self?.window === stage { self?.window = nil }
        }
    }

    private static let stepsWidth: CGFloat = 720
    private static let stepsMaxShare: CGFloat = 0.66
    /// True while the window is still sitting where the card was: its size waits for the grow.
    private var morphing = false
    private var stepsHeight: CGFloat = 0

    /// The window is as tall as the current step, never more than ~2/3 of the screen, and stays where it is
    /// (growing and shrinking around its middle). `recenter` is the grow out of the card, into the screen's middle.
    private func fitSteps(to contentHeight: CGFloat, recenter: Bool = false) {
        stepsHeight = contentHeight
        guard !morphing else { return }
        DispatchQueue.main.async { [weak self] in
            guard let steps = self?.stepsWindow, let area = (steps.screen ?? NSScreen.main)?.visibleFrame else { return }
            let height = min(ceil(contentHeight > 0 ? contentHeight : 540), (area.height * Self.stepsMaxShare).rounded())
            var frame = steps.frame
            if recenter {
                frame = NSRect(x: (area.midX - Self.stepsWidth / 2).rounded(), y: (area.midY - height / 2).rounded(),
                               width: Self.stepsWidth, height: height)
            } else {
                guard abs(frame.height - height) > 1 else { return }
                frame.origin.y = min(max(frame.midY - height / 2, area.minY), area.maxY - height)
                frame.size.height = height
            }
            guard steps.alphaValue > 0 else { return steps.setFrame(frame, display: true) }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = recenter ? 0.62 : 0.35
                context.timingFunction = recenter ? CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.25, 1)
                    : CAMediaTimingFunction(name: .easeInEaseOut)
                steps.animator().setFrame(frame, display: true)
            }
        }
    }

    /// Back in front once the browser login lands.
    func bringToFront() {
        NSApp.activate()
        (stepsWindow ?? window)?.makeKeyAndOrderFront(nil)
    }

    private func finish(enteringProject: Bool) {
        guard model != nil else { return }
        model = nil
        UserDefaults.standard.set(true, forKey: Self.completedKey)
        NotificationCenter.default.post(name: enteringProject ? .enterCurrentProject : .showProjectsHome, object: nil)
        for window in [window, stepsWindow].compactMap({ $0 }) {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.4
                window.animator().alphaValue = 0
            } completionHandler: {
                MainActor.assumeIsolated { window.orderOut(nil) }
            }
        }
        stepsWindow?.delegate = nil
        window = nil
        stepsWindow = nil
        stepsDelegate = nil
    }

    private final class StepsWindowDelegate: NSObject, NSWindowDelegate {
        let closed: () -> Void
        init(closed: @escaping () -> Void) { self.closed = closed }
        func windowShouldClose(_ sender: NSWindow) -> Bool { closed(); return false }
    }

    /// Borderless windows refuse focus by default; the steps have text fields.
    private final class StageWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { true }
    }
}

// MARK: - Steps

private enum OnboardingStep: Int, CaseIterable {
    case site, product, you, tiktok, research, ready, access

    var label: String {
        switch self {
        case .site: "Site"
        case .product: "Produto"
        case .you: "Você"
        case .tiktok: "TikTok"
        case .research: "Pesquisa"
        case .ready: "Pronto"
        case .access: "Acesso"
        }
    }
}

@MainActor
private final class OnboardingModel: ObservableObject {
    @Published var step = OnboardingStep.site
    @Published var siteText = ""
    @Published var snapshot: SiteSnapshot?
    @Published var reading = false
    @Published var siteError: String?
    @Published var understanding = false
    @Published var understandError: String?
    @Published var profile = ProductProfile()
    @Published var researchTerm = ""
    @Published var researching = false
    @Published var researchError: String?
    /// The competitors being hunted, shown while the research runs.
    @Published var hunted: [String] = []
    @Published var accounts: [ResearchedAccount] = []
    /// The viral carousel the first batch will follow.
    @Published var chosen: ResearchedPost?
    @Published var login: BrowserLogin?
    /// The "Começar" button has turned into the site card.
    @Published var panelUp = false
    /// The stage is fading its edges before the steps move into a window.
    @Published var handingOff = false
    /// Where the site card sits on the stage (top-left origin): the window grows out of it.
    var panelFrame = CGRect.zero
    var handoff: (() -> Void)?
    private var readTask: Task<Void, Never>?

    var brandColor: Color? { snapshot?.brandColor.map(Color.init(nsColor:)) }

    /// Reads the site a moment after the person stops typing, so the brand shows up on its own.
    func siteChanged() {
        readTask?.cancel()
        siteError = nil
        guard let url = SiteSnapshot.normalize(siteText) else { snapshot = nil; reading = false; return }
        if snapshot?.url.host() == url.host() { return }
        readTask = Task {
            try? await Task.sleep(for: .milliseconds(650))
            guard !Task.isCancelled else { return }
            reading = true
            do {
                let read = try await SiteSnapshot.read(url)
                guard !Task.isCancelled else { return }
                withAnimation(.smooth(duration: 0.5)) { snapshot = read }
            } catch {
                guard !Task.isCancelled else { return }
                siteError = "Não consegui abrir esse site. Confira o endereço."
                snapshot = nil
            }
            reading = false
        }
    }

    /// The project is born from the site: named after the brand, with its icon.
    func confirmSite() {
        guard let snapshot else { return }
        ProjectStore.shared.create(named: snapshot.name)
        ProjectStore.shared.saveIcon(snapshot.iconData)
        profile.site = snapshot.url.absoluteString
        profile.name = snapshot.name
        ProjectStore.shared.setProfile(site: profile.site, about: snapshot.description ?? "")
        withAnimation(.smooth(duration: 0.55)) { handingOff = true }
        step = .product
        handoff?()
        understand()
    }

    func understand() {
        guard let snapshot else { return }
        understanding = true
        understandError = nil
        Task {
            do {
                var read = try await ProductUnderstanding.understand(snapshot)
                read.role = profile.role
                read.goal = profile.goal
                withAnimation(.smooth(duration: 0.5)) { profile = read }
                researchTerm = read.sellerSearches.first ?? read.keywords.first ?? read.umbrellaNiche
            } catch {
                understandError = (error as? ProductUnderstanding.Failure)?.message ?? "A IA não conseguiu ler o site agora."
                if profile.whatItDoes.isEmpty { profile.whatItDoes = snapshot.description ?? "" }
            }
            understanding = false
            ProjectStore.shared.setProductProfile(profile)
        }
    }

    func confirmProduct() {
        if researchTerm.isEmpty { researchTerm = profile.sellerSearches.first ?? profile.keywords.first ?? profile.umbrellaNiche }
        ProjectStore.shared.setProductProfile(profile)
        go(.you)
    }

    func confirmYou() {
        ProjectStore.shared.setProductProfile(profile)
        go(.tiktok)
    }

    func startLogin() {
        guard let browser = DefaultBrowser.current, browser.kind != .unsupported else { return }
        let login = BrowserLogin(network: .tiktok, browser: browser)
        self.login = login
        login.start()
    }

    func loginFinished() {
        OnboardingStage.shared.bringToFront()
    }

    func cancelLogin() {
        login?.cancel()
        login = nil
    }

    func research() {
        let term = researchTerm.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty, !researching else { return }
        researching = true
        researchError = nil
        accounts = []
        Task {
            do {
                // The hunt: the apps that already sell this (named by the AI and found on the App Store), searched
                // by name, plus searches written the way app sellers write. The fixed rule then puts first what
                // sells an app with millions of views.
                let store = await Competitors.appStore([profile.category, profile.umbrellaNiche, profile.whatItDoes]
                    .filter { !$0.isEmpty }.map { String($0.prefix(60)) }, excluding: profile.name)
                var names: [String] = []
                for name in profile.competitors + store where !names.contains(where: { $0.lowercased() == name.lowercased() }) {
                    names.append(name)
                }
                withAnimation(.smooth(duration: 0.4)) { hunted = Array(names.prefix(4)) }
                var searchProfile = profile
                searchProfile.competitors = names
                let queries = TikTokResearcher.researchQueries(term, profile: searchProfile)
                #if DEBUG
                print("[hunt] app store:", store, "| queries:", queries)
                #endif
                let folder = try await TikTokResearcher.shared.runHunt(queries, appNames: names, count: 6)
                withAnimation(.smooth(duration: 0.5)) { accounts = ResearchedAccount.load(from: folder) }
                chosen = ResearchedPost.ranked(accounts.flatMap(\.posts)).first
            } catch {
                researchError = (error as? TikTokResearcher.Failure)?.message ?? "A pesquisa não terminou agora."
                #if DEBUG
                print("[hunt] failed:", error)
                #endif
            }
            researching = false
        }
    }

    func finish() {
        if let folder = chosen?.folder { ProjectStore.shared.setReference(folder) }
    }

    func go(_ next: OnboardingStep) {
        withAnimation(.smooth(duration: 0.55)) { step = next }
    }
}

private struct OnboardingStageView: View {
    @ObservedObject var model: OnboardingModel
    let screenSize: CGSize
    let finish: (_ enteringProject: Bool) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var glass
    @State private var appeared = false
    @State private var panelContent = false

    var body: some View {
        let shown = appeared && !model.handingOff
        ZStack {
            // The desktop, turned into paper: blurred and dimmed, never hidden.
            BehindWindowBlur().opacity(shown ? 1 : 0)
            Color.black.opacity(shown ? (model.panelUp ? 0.5 : 0.42) : 0)
            EdgeGlow(size: screenSize, brand: model.brandColor, animated: !reduceMotion)
                .opacity(shown ? 1 : 0)
                .scaleEffect(shown ? 1 : 1.08)
            header.opacity(shown ? 1 : 0)
            // One glass container, so the "Começar" button can melt into the card.
            GlassEffectContainer(spacing: 60) {
                ZStack {
                    welcome
                        .opacity(model.panelUp ? 0 : 1)
                        .offset(y: model.panelUp ? -60 : 0)
                        .scaleEffect(model.panelUp ? 0.94 : 1)
                        .blur(radius: model.panelUp ? 12 : 0)
                        .allowsHitTesting(!model.panelUp)
                    if model.panelUp {
                        VStack(spacing: 22) {
                            panel
                            StepProgress(step: model.step).opacity(panelContent ? 1 : 0)
                        }
                        // The card hands itself to the window: it fades fast while the window takes its place.
                        .opacity(model.handingOff ? 0 : 1)
                        .animation(.easeOut(duration: 0.28), value: model.handingOff)
                    }
                }
            }
        }
        .animation(.smooth(duration: 1.1), value: model.handingOff)
        .opacity(appeared ? 1 : 0.999)
        .ignoresSafeArea()
        .environment(\.colorScheme, .dark)
        .environment(\.brandTint, model.brandColor)
        .foregroundStyle(.white)
        .onAppear {
            withAnimation(reduceMotion ? .easeOut(duration: 0.2) : .smooth(duration: 1.4)) { appeared = true }
        }
        .onChange(of: model.panelUp) { _, up in
            guard up else { return }
            withAnimation(.smooth(duration: 0.5).delay(reduceMotion ? 0 : 0.28)) { panelContent = true }
        }
        .onExitCommand { finish(false) }
    }

    private var header: some View {
        VStack {
            HStack {
                Text("The Carousel Maker").font(IntroductionAssets.display(size: 20))
                Spacer()
                secondaryButton("Pular", small: true) { finish(false) }
                    .help("Pular a configuração e abrir os projetos")
            }
            .padding(.horizontal, 64).padding(.top, 56)
            Spacer()
        }
    }

    private var welcome: some View {
        VStack(spacing: 26) {

            Text("Ache o que viraliza.\nCrie igual, em lote.")
                .font(IntroductionAssets.display(size: 72))
                .multilineTextAlignment(.center)
                .lineSpacing(2)
            Text("Em alguns minutos o app conhece o seu produto, pesquisa o seu nicho no TikTok\ne cria o seu primeiro lote de carrosséis.")
                .font(.system(size: 17))
                .foregroundStyle(.white.opacity(0.72))
                .multilineTextAlignment(.center)
                .lineSpacing(3)
            // Holds its place, so the text doesn't jump when the button turns into the card.
            ZStack {
                Color.clear.frame(height: 50)
                if !model.panelUp {
                    primaryButton("Começar", glassID: "card", in: glass) {
                        withAnimation(reduceMotion ? .easeOut(duration: 0.25) : .spring(response: 0.7, dampingFraction: 0.84)) {
                            model.panelUp = true
                        }
                    }
                }
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: 900)
        .opacity(appeared ? 1 : 0)
        .offset(y: appeared ? 0 : 24)
    }

    // MARK: The card

    /// Born out of the "Começar" button: the glass morphs into the card, then the content fades in.
    private var panel: some View {
        SiteStep(model: model)
            .opacity(panelContent ? 1 : 0)
            .scaleEffect(panelContent ? 1 : 0.97)
            .padding(48)
            .frame(width: 680)
            .frame(minHeight: 420)
            .glassEffect(.regular.tint(.black.opacity(0.32)), in: .rect(cornerRadius: 34))
            .glassEffectID("card", in: glass)
            .overlay(RoundedRectangle(cornerRadius: 34, style: .continuous)
                .strokeBorder(.white.opacity(panelContent ? 0.1 : 0), lineWidth: 1))
            .shadow(color: .black.opacity(panelContent ? 0.35 : 0), radius: 40, y: 20)
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { model.panelFrame = $0 }
    }
}

/// Onboarding after the site: a normal window, dressed like the stage (blur, dim and a softer glow in the
/// brand's color), that the browser can sit on top of during the TikTok login.
private struct OnboardingWindowView: View {
    @ObservedObject var model: OnboardingModel
    /// Reports the height the current step needs; the window follows it.
    let fit: (CGFloat) -> Void
    let finish: (_ enteringProject: Bool) -> Void

    var body: some View {
        ZStack(alignment: .top) {
            WindowBackdrop(brand: model.brandColor)
            // Sized to the step, so it never scrolls in practice; the scroll view is only a net for tiny screens.
            ScrollView(.vertical) {
                VStack(spacing: 0) {
                    // The title bar row: traffic lights on the left, the brand in the middle, a way out on the right.
                    ZStack {
                        if let snapshot = model.snapshot { BrandChip(snapshot: snapshot, compact: true) }
                        HStack {
                            Spacer()
                            secondaryButton("Pular", small: true) { finish(false) }
                                .help("Pular a configuração e abrir os projetos")
                        }
                    }
                    .frame(height: 56)
                    .padding(.horizontal, 18)
                    StepProgress(step: model.step).padding(.top, 8)
                    // A ZStack, so the outgoing and incoming steps overlap during the transition instead of stacking.
                    ZStack {
                        Group {
                            switch model.step {
                            case .site, .product: ProductStep(model: model)
                            case .you: YouStep(model: model)
                            case .tiktok: TikTokStep(model: model)
                            case .research: ResearchStep(model: model)
                            case .ready: ReadyStep(model: model) {
                                // Already paid (or in the trial): straight in. Otherwise the key comes first.
                                if License.shared.access.isAllowed { model.finish(); finish(true) } else { model.go(.access) }
                            }
                            case .access: AccessStep(model: model) { model.finish(); finish(true) }
                            }
                        }
                        .frame(maxWidth: 560)
                        .id(model.step)
                        .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 14)),
                                                removal: .opacity.combined(with: .offset(y: -14))))
                    }
                    .padding(.horizontal, 64)
                    .padding(.top, 34)
                }
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fit($0) }
            }
            .scrollIndicators(.never)
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .ignoresSafeArea()
        .environment(\.stepTitleSize, 30)
        .environment(\.compactSteps, true)
        .environment(\.brandTint, model.brandColor)
        .environment(\.colorScheme, .dark)
        .foregroundStyle(.white)
        .animation(.smooth(duration: 0.5), value: model.step)
    }
}

/// A calm, static backdrop for the window: deep ink with the brand's color as soft light from the top.
/// Nothing animates, so it costs nothing per frame.
private struct WindowBackdrop: View {
    let brand: Color?

    var body: some View {
        let light = brand ?? Color(red: 0.15, green: 0.96, blue: 0.93)
        ZStack {
            Color(red: 0.055, green: 0.06, blue: 0.07)
            RadialGradient(colors: [light.opacity(0.42), light.opacity(0.08), .clear],
                           center: UnitPoint(x: 0.5, y: -0.15), startRadius: 0, endRadius: 560)
            RadialGradient(colors: [Color(red: 1, green: 0.17, blue: 0.33).opacity(0.10), .clear],
                           center: .bottomTrailing, startRadius: 0, endRadius: 420)
            LinearGradient(colors: [.clear, .black.opacity(0.25)], startPoint: .center, endPoint: .bottom)
        }
        .animation(.smooth(duration: 1), value: brand?.description)
    }
}

/// Thin segments, one per step, with the current step's name: readable at a glance, never in the way.
private struct StepProgress: View {
    let step: OnboardingStep

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                ForEach(OnboardingStep.allCases, id: \.self) { item in
                    Capsule()
                        .fill(item.rawValue <= step.rawValue ? Color.white.opacity(0.9) : Color.white.opacity(0.18))
                        .frame(width: item == step ? 28 : 16, height: 4)
                }
            }
            Text(step.label.uppercased())
                .font(.system(size: 10, weight: .semibold)).tracking(1.2)
                .foregroundStyle(.white.opacity(0.5))
        }
        .animation(.smooth(duration: 0.4), value: step)
    }
}

// MARK: - Step views

private struct SiteStep: View {
    @ObservedObject var model: OnboardingModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 26) {
            StepTitle("Qual é o seu site?", "O app lê a página pra entender o que você vende e achar quem já viraliza no seu nicho.")
            HStack(spacing: 10) {
                Image(systemName: "globe").foregroundStyle(.white.opacity(0.5))
                TextField("seusite.com.br", text: $model.siteText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 18))
                    .focused($focused)
                    .onChange(of: model.siteText) { _, _ in model.siteChanged() }
                    .onSubmit { if model.snapshot != nil { model.confirmSite() } }
                if model.reading { ProgressView().controlSize(.small) }
            }
            .stageField(focused: focused)
            ZStack {
                if let snapshot = model.snapshot {
                    BrandChip(snapshot: snapshot, compact: false)
                        .transition(.scale(scale: 0.92).combined(with: .opacity))
                } else if let error = model.siteError {
                    Text(error).font(.system(size: 13)).foregroundStyle(.orange)
                } else {
                    Text("Obrigatório: é por ele que tudo começa.")
                        .font(.system(size: 13)).foregroundStyle(.white.opacity(0.45))
                }
            }
            .frame(height: 96)
            primaryButton("Continuar", action: model.confirmSite)
                .disabled(model.snapshot == nil)
        }
        .onAppear { focused = true }
    }
}

private struct ProductStep: View {
    @ObservedObject var model: OnboardingModel

    var body: some View {
        VStack(spacing: 22) {
            if model.understanding {
                VStack(spacing: 18) {

                    StepTitle("Lendo o seu site…")
                    ShimmerLines()
                }
                .transition(.opacity)
            } else {
                StepTitle("Entendi assim. Tá certo?", model.understandError ?? "Ajuste o que quiser.")
                VStack(spacing: 10) {
                    LabeledField(label: "O que faz", icon: "sparkles", text: $model.profile.whatItDoes, lines: 3)
                    HStack(alignment: .top, spacing: 10) {
                        LabeledField(label: "Pra quem", icon: "person.2.fill", text: $model.profile.audience, lines: 2)
                        LabeledField(label: "Nicho", icon: "scope", text: $model.profile.umbrellaNiche, lines: 2)
                    }
                }
                if !model.profile.keywords.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            SocialMark(network: .tiktok, size: 14)
                            Text("Primeira pesquisa").font(.system(size: 11, weight: .semibold))
                        }
                        .foregroundStyle(.white.opacity(0.55))
                        ChipFlow(items: Array((model.profile.sellerSearches.isEmpty ? model.profile.keywords : model.profile.sellerSearches).prefix(6)),
                                 selected: model.researchTerm) {
                            model.researchTerm = $0
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                HStack(spacing: 12) {
                    if model.understandError != nil {
                        secondaryButton("Ler de novo", icon: "arrow.clockwise", action: model.understand)
                    }
                    primaryButton("Continuar", action: model.confirmProduct)
                        .disabled(model.profile.umbrellaNiche.trimmingCharacters(in: .whitespaces).isEmpty
                                  && model.profile.whatItDoes.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.top, 4)
            }
        }
    }
}

private struct YouStep: View {
    @ObservedObject var model: OnboardingModel
    private let roles: [OptionTiles.Option] = [
        .init("Criador(a) de conteúdo", "camera.fill"), .init("Social media", "bubble.left.and.bubble.right.fill"),
        .init("Dono(a) de marca", "bag.fill"), .init("Agência", "building.2.fill"),
    ]
    private let goals: [OptionTiles.Option] = [
        .init("Ganhar seguidores", "person.3.fill"), .init("Vender mais", "chart.line.uptrend.xyaxis"),
        .init("Testar um nicho novo", "flask.fill"), .init("Postar todo dia", "calendar"),
    ]

    var body: some View {
        VStack(spacing: 24) {
            StepTitle("Agora sobre você")
            question("Você é…", options: roles, selected: model.profile.role) { model.profile.role = $0 }
            question("Seu objetivo agora", options: goals, selected: model.profile.goal) { model.profile.goal = $0 }
            primaryButton("Continuar", action: model.confirmYou)
                .disabled(model.profile.role == nil || model.profile.goal == nil)
                .padding(.top, 4)
        }
    }

    private func question(_ title: String, options: [OptionTiles.Option], selected: String?, pick: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.55))
            OptionTiles(options: options, selected: selected, pick: pick)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct TikTokStep: View {
    @ObservedObject var model: OnboardingModel

    var body: some View {
        VStack(spacing: 22) {
            SocialMark(network: .tiktok, size: 56)
            if let login = model.login {
                LoginProgress(login: login, model: model)
            } else {
                StepTitle("Conecte o seu TikTok", connectDetail)
                HStack(spacing: 12) {
                    secondaryButton("Agora não") { model.go(.research) }
                    if let browser = DefaultBrowser.current, browser.kind != .unsupported {
                        primaryButton("Entrar pelo \(browser.name)", icon: "arrow.up.forward", action: model.startLogin)
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private var connectDetail: String {
        guard let browser = DefaultBrowser.current, browser.kind != .unsupported else {
            return "Dá pra conectar depois em Ajustes."
        }
        return "Abre no \(browser.name). Com a conta conectada, a pesquisa vai mais fundo."
    }
}

private struct LoginProgress: View {
    @ObservedObject var login: BrowserLogin
    @ObservedObject var model: OnboardingModel

    var body: some View {
        VStack(spacing: 20) {
            switch login.phase {
            case .needsAccess:
                StepTitle("Libere o acesso ao \(login.browser.name)",
                          "Ative o The Carousel Maker em Privacidade e Segurança › Acesso Total ao Disco. Só os cookies do TikTok são lidos.")
                HStack(spacing: 12) {
                    secondaryButton("Cancelar", action: model.cancelLogin)
                    primaryButton("Abrir Ajustes", icon: "gearshape.fill", action: login.openAccessSettings)
                }
            case .done(let handle):
                StepTitle(handle.map { "Conectado como \($0)" } ?? "TikTok conectado", "Fica salvo só neste projeto.")
                primaryButton("Continuar") { model.go(.research) }
            case .failed(let message):
                StepTitle("Não deu certo", message)
                HStack(spacing: 12) {
                    secondaryButton("Agora não") { model.cancelLogin(); model.go(.research) }
                    primaryButton("Tentar de novo", icon: "arrow.clockwise") { model.cancelLogin(); model.startLogin() }
                }
            default:
                ProgressView().controlSize(.regular)
                StepTitle("Entre no TikTok pelo \(login.browser.name)", "Google, passkey, QR code ou senha. Eu volto sozinho.")
                secondaryButton("Cancelar", action: model.cancelLogin)
            }
        }
        .onChange(of: login.phase) { _, phase in
            switch phase {
            case .done, .failed, .needsAccess: model.loginFinished()
            default: break
            }
        }
    }
}

private struct ResearchStep: View {
    @ObservedObject var model: OnboardingModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 22) {
            if model.researching {

                StepTitle("Caçando quem já vende app no seu nicho",
                          model.hunted.isEmpty ? "Leva uns minutos." : "\(model.hunted.joined(separator: ", ")) e quem faz igual. Leva uns minutos.")
                ShimmerGrid()
            } else if model.accounts.contains(where: { !$0.posts.isEmpty }) {
                ViralShowcase(model: model)
            } else {
                StepTitle("Vamos achar quem viraliza", model.researchError ?? "Uma busca no TikTok pelo seu nicho.")
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.white.opacity(0.5))
                    TextField("ex.: oração diária", text: $model.researchTerm)
                        .textFieldStyle(.plain).font(.system(size: 15)).focused($focused)
                        .onSubmit(model.research)
                }
                .stageField(focused: focused)
                HStack(spacing: 12) {
                    secondaryButton("Pular") { model.go(.ready) }
                    primaryButton("Pesquisar", icon: "magnifyingglass", action: model.research)
                        .disabled(model.researchTerm.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.top, 4)
            }
        }
    }
}

/// The research, sold: "olha esse post, puf". The niche's viral carousels pop in one by one while their views
/// add up, then the row keeps flowing left to right. A click picks the reference.
private struct ViralShowcase: View {
    @ObservedObject var model: OnboardingModel
    @Environment(\.brandTint) private var brand
    @State private var revealed = 0
    @State private var counted = 0
    @State private var flowing = false

    private var posts: [ResearchedPost] { ResearchedPost.ranked(model.accounts.flatMap(\.posts)) }

    var body: some View {
        let posts = posts
        let tint = brand ?? .onboardingAccent
        VStack(spacing: 22) {
            VStack(spacing: 4) {
                Text("Seu nicho tem muito potencial").font(IntroductionAssets.display(size: 30)).multilineTextAlignment(.center)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(shortCount(counted))
                        .font(IntroductionAssets.display(size: 64))
                        .contentTransition(.numericText(value: Double(counted)))
                        .foregroundStyle(LinearGradient(colors: [.white, tint.mix(with: .white, by: 0.35)], startPoint: .top, endPoint: .bottom))
                        .shadow(color: tint.opacity(0.45), radius: 24)
                    Text("views").font(.system(size: 18, weight: .semibold)).foregroundStyle(.white.opacity(0.6))
                }
                HStack(spacing: 6) {
                    Image(systemName: "flame.fill").foregroundStyle(.orange)
                    Text("\(posts.count) carrosséis de \(model.accounts.count) contas já viralizaram com isso")
                }
                .font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white.opacity(0.6))
            }
            PostMarquee(posts: posts, revealed: revealed, flowing: flowing, chosen: model.chosen?.id) { post in
                withAnimation(.smooth(duration: 0.25)) { model.chosen = post }
            }
            .padding(.horizontal, -80)
            primaryButton("Fazer igual", icon: "sparkles") { model.go(.ready) }
                .disabled(model.chosen == nil)
        }
        .task { await reveal(posts) }
    }

    private func reveal(_ posts: [ResearchedPost]) async {
        guard revealed == 0, !posts.isEmpty else { return }
        try? await Task.sleep(for: .milliseconds(500))
        // Only what's on screen pops; the rest is already there when the row starts moving.
        for index in 0..<min(posts.count, 5) {
            withAnimation(.spring(response: 0.42, dampingFraction: 0.56)) { revealed = index + 1 }
            withAnimation(.smooth(duration: 0.45)) { counted += posts[index].views }
            NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .now)
            try? await Task.sleep(for: .milliseconds(420))
        }
        withAnimation(.smooth(duration: 0.9)) {
            revealed = posts.count
            counted = posts.reduce(0) { $0 + $1.views }
        }
        try? await Task.sleep(for: .milliseconds(700))
        flowing = true
    }
}

/// A loop of covers drifting left to right, slow enough to click one on the way.
private struct PostMarquee: View {
    let posts: [ResearchedPost]
    let revealed: Int
    let flowing: Bool
    let chosen: URL?
    let pick: (ResearchedPost) -> Void
    @State private var start = Date()

    private let cardWidth: CGFloat = 126
    private let spacing: CGFloat = 14
    private let speed: CGFloat = 24

    var body: some View {
        let unit = CGFloat(posts.count) * (cardWidth + spacing)
        // Repeated until it's well wider than the window, so the loop never shows its seam.
        let copies = max(3, Int(ceil(2200 / max(unit, 1))))
        TimelineView(.animation(paused: !flowing)) { context in
            let elapsed = flowing ? max(0, context.date.timeIntervalSince(start)) : 0
            let shift = unit > 0 ? (CGFloat(elapsed) * speed).truncatingRemainder(dividingBy: unit) : 0
            HStack(spacing: spacing) {
                ForEach(0..<copies, id: \.self) { _ in
                    ForEach(Array(posts.enumerated()), id: \.offset) { index, post in
                        PostCard(post: post, shown: index < revealed, selected: post.id == chosen, width: cardWidth) { pick(post) }
                    }
                }
            }
            .fixedSize()
            // One copy sits off to the left, ready to slide in.
            .offset(x: shift - unit + 40)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(height: cardWidth * 4 / 3 + 26)
        .padding(.vertical, 8)
        .clipped()
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.1),
                                     .init(color: .black, location: 0.9), .init(color: .clear, location: 1)],
                             startPoint: .leading, endPoint: .trailing))
        .onChange(of: flowing) { _, on in if on { start = Date() } }
    }
}

private struct PostCard: View {
    let post: ResearchedPost
    let shown: Bool
    let selected: Bool
    let width: CGFloat
    let pick: () -> Void
    @State private var cover: NSImage?

    var body: some View {
        Button(action: pick) {
            VStack(alignment: .leading, spacing: 7) {
                Color.white.opacity(0.06)
                    .frame(width: width, height: width * 4 / 3)
                    .overlay { if let cover { Image(nsImage: cover).resizable().scaledToFill() } }
                    .overlay(alignment: .bottomLeading) { ViewsBadge(views: post.views, aboutApp: post.aboutApp).padding(7) }
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .strokeBorder(selected ? Color.white : .white.opacity(0.12), lineWidth: selected ? 2.5 : 1))
                    .overlay(alignment: .topTrailing) {
                        if selected {
                            Image(systemName: "checkmark.circle.fill").font(.system(size: 19))
                                .symbolRenderingMode(.palette).foregroundStyle(.black, .white)
                                .padding(6).transition(.scale.combined(with: .opacity))
                        }
                    }
                    .shadow(color: .black.opacity(0.4), radius: 12, y: 8)
                Text(post.handle).font(.system(size: 11, weight: .semibold)).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
            }
            .frame(width: width)
        }
        .buttonStyle(.plain)
        .scaleEffect(shown ? 1 : 0.3)
        .opacity(shown ? 1 : 0)
        .blur(radius: shown ? 0 : 12)
        .task(id: post.id) { if cover == nil, let url = post.slides.first { cover = await Thumbnails.image(url) } }
    }
}

/// "▶ 138K" over a cover; past 100K it's on fire, and a carousel selling an app says so.
private struct ViewsBadge: View {
    let views: Int
    var aboutApp = false

    var body: some View {
        HStack(spacing: 4) {
            if aboutApp { Image(systemName: "apps.iphone").foregroundStyle(.cyan) }
            Image(systemName: views >= 100_000 ? "flame.fill" : "play.fill")
                .foregroundStyle(views >= 100_000 ? Color.orange : .white)
            Text(shortCount(views))
        }
        .font(.system(size: 11.5, weight: .bold))
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(Capsule().fill(.black.opacity(0.62)))
        .overlay(Capsule().strokeBorder(.white.opacity(0.15), lineWidth: 1))
    }
}

/// Covers repeat in the marquee: each one is decoded once.
@MainActor
private enum Thumbnails {
    private static var cache: [URL: NSImage] = [:]

    static func image(_ url: URL) async -> NSImage? {
        if let hit = cache[url] { return hit }
        let image = await ResearchedAccount.thumbnail(url, maxPixels: 380)
        cache[url] = image
        return image
    }
}

private struct ReadyStep: View {
    @ObservedObject var model: OnboardingModel
    let enter: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            StepTitle("Tudo pronto\(model.profile.name.isEmpty ? "" : ", \(model.profile.name)").",
                      model.chosen.map { "O seu primeiro lote vai seguir o formato do \($0.handle)." }
                        ?? "Agora é só escolher as fotos e gerar.")
            if let post = model.chosen {
                // Few slides in the reference? The niche's other hits fill the hand.
                SlideFan(post: post, extras: ResearchedPost.ranked(model.accounts.flatMap(\.posts).filter { $0.id != post.id })
                    .compactMap(\.slides.first))
            }
            HStack(spacing: 8) {
                summary("scope", model.profile.umbrellaNiche)
                summary("flag.fill", model.profile.goal ?? "")
            }
            primaryButton("Criar meu primeiro lote", icon: "sparkles", action: enter)
        }
    }

    @ViewBuilder private func summary(_ icon: String, _ value: String) -> some View {
        if !value.isEmpty {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold)).foregroundStyle(.white.opacity(0.55))
                Text(value).font(.system(size: 12.5, weight: .medium)).foregroundStyle(.white.opacity(0.85)).lineLimit(1)
            }
            .padding(.horizontal, 14).frame(height: 32)
            .frame(maxWidth: 270)
            .fixedSize()
            .glassEffect(.regular, in: .capsule)
        }
    }
}

/// The reference's slides, dealt out like cards: the format the first batch will follow, at a glance.
private struct SlideFan: View {
    let post: ResearchedPost
    let extras: [URL]
    @State private var images: [NSImage?] = []
    @State private var dealt = false

    var body: some View {
        let slides = Array((post.slides + extras).prefix(5))
        ZStack {
            ForEach(Array(slides.enumerated()), id: \.offset) { index, _ in
                // The reference's first slide in the middle, the rest alternating right and left behind it.
                let spread = CGFloat(index == 0 ? 0 : index % 2 == 1 ? (index + 1) / 2 : -(index / 2))
                let isReference = index < post.slides.count
                Color.white.opacity(0.06)
                    .frame(width: 128, height: 170)
                    .overlay { if index < images.count, let image = images[index] { Image(nsImage: image).resizable().scaledToFill() } }
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.16), lineWidth: 1))
                    .brightness(isReference ? 0 : -0.12)
                    .shadow(color: .black.opacity(0.45), radius: 14, y: 10)
                    .rotationEffect(.degrees(dealt ? Double(spread) * 7 : 0), anchor: .bottom)
                    .offset(x: dealt ? spread * 82 : 0, y: dealt ? abs(spread) * 10 : 0)
                    .zIndex(-abs(Double(spread)))
                    .animation(.spring(response: 0.6, dampingFraction: 0.72).delay(0.08 * Double(index)), value: dealt)
            }
        }
        .overlay(alignment: .bottom) { ViewsBadge(views: post.views, aboutApp: post.aboutApp).scaleEffect(1.15).offset(y: 14) }
        .frame(height: 200)
        .task(id: post.id) {
            var loaded: [NSImage?] = []
            for url in slides { loaded.append(await Thumbnails.image(url)) }
            images = loaded
            try? await Task.sleep(for: .milliseconds(150))
            dealt = true
        }
    }
}

/// The last step: already bought, it's one paste; not yet, the site sells the key and the person comes back.
private struct AccessStep: View {
    @ObservedObject var model: OnboardingModel
    let enter: () -> Void
    @ObservedObject private var license = License.shared
    @Environment(\.brandTint) private var brand
    @State private var key = ""
    @State private var wentToCheckout = false
    @FocusState private var focused: Bool

    var body: some View {
        let tint = brand ?? .onboardingAccent
        VStack(spacing: 22) {
            Image(systemName: "key.fill")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(tint.label)
                .frame(width: 72, height: 72)
                .glassEffect(.regular.tint(tint.opacity(0.85)), in: .circle)
                .shadow(color: tint.opacity(0.5), radius: 24)
            StepTitle("Desbloqueie o seu lote", wentToCheckout
                      ? "Você entrou na fila. Quando abrir, a chave chega no seu e-mail: cole aqui."
                      : "O lançamento está chegando. Tem uma chave? Cole aqui.")
            VStack(spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: "key.horizontal.fill").foregroundStyle(.white.opacity(0.5))
                    TextField("XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX", text: $key)
                        .textFieldStyle(.plain).font(.system(size: 14, design: .monospaced)).focused($focused)
                        .onSubmit(activate)
                    if license.isBusy {
                        ProgressView().controlSize(.small)
                    } else if key.isEmpty {
                        secondaryButton("Colar", icon: "doc.on.clipboard", small: true) {
                            key = NSPasteboard.general.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                        }
                    }
                }
                .stageField(focused: focused)
                if let message = license.message {
                    Text(message).font(.system(size: 12.5)).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            }
            // No key yet: the waitlist is the way forward until launch. With one pasted, activating is.
            HStack(spacing: 12) {
                if key.trimmingCharacters(in: .whitespaces).isEmpty {
                    primaryButton("Entrar na lista de espera", icon: "arrow.up.forward", action: checkout)
                } else {
                    secondaryButton("Lista de espera", icon: "arrow.up.forward", action: checkout)
                    primaryButton("Ativar", icon: "lock.open.fill", action: activate)
                        .disabled(license.isBusy)
                }
            }
            .animation(.smooth(duration: 0.3), value: key.isEmpty)
        }
        .onAppear { focused = true }
    }

    private func checkout() {
        withAnimation(.smooth(duration: 0.3)) { wentToCheckout = true }
        license.openCheckout()
    }

    private func activate() {
        Task {
            await license.activate(key: key)
            if license.access.isAllowed { enter() }
        }
    }
}


// MARK: - Pieces

private struct BrandChip: View {
    let snapshot: SiteSnapshot
    let compact: Bool

    var body: some View {
        HStack(spacing: compact ? 10 : 16) {
            Group {
                if let icon = snapshot.icon {
                    Image(nsImage: icon).resizable().interpolation(.high).scaledToFit()
                } else {
                    Text(snapshot.name.prefix(1).uppercased())
                        .font(.system(size: compact ? 16 : 28, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(snapshot.brandColor.map(Color.init(nsColor:)) ?? .white.opacity(0.15))
                }
            }
            .frame(width: compact ? 30 : 60, height: compact ? 30 : 60)
            .clipShape(RoundedRectangle(cornerRadius: compact ? 8 : 14, style: .continuous))
            .shadow(color: .black.opacity(0.3), radius: 8, y: 4)
            VStack(alignment: .leading, spacing: 2) {
                Text(snapshot.name).font(.system(size: compact ? 14 : 22, weight: .semibold)).lineLimit(1)
                Text(compact ? snapshot.domain : (snapshot.description ?? snapshot.domain))
                    .font(.system(size: compact ? 11 : 13)).foregroundStyle(.white.opacity(0.55)).lineLimit(compact ? 1 : 2)
            }
        }
        .frame(maxWidth: compact ? nil : 520, alignment: .leading)
    }
}

extension EnvironmentValues {
    /// 42 on the full-screen stage, smaller inside the window.
    @Entry var stepTitleSize: CGFloat = 42
    /// Tighter fields and buttons inside the window; the stage keeps its roomy ones.
    @Entry var compactSteps = false
    /// The brand's color, once the site is read: it tints the glass of the primary controls.
    @Entry var brandTint: Color? = nil
}

private struct StepTitle: View {
    let title: String
    let detail: String?
    @Environment(\.stepTitleSize) private var size
    init(_ title: String, _ detail: String? = nil) { self.title = title; self.detail = detail }

    var body: some View {
        VStack(spacing: size > 38 ? 10 : 8) {
            Text(title).font(IntroductionAssets.display(size: size)).multilineTextAlignment(.center)
            if let detail {
                Text(detail).font(.system(size: size > 38 ? 15 : 13.5)).foregroundStyle(.white.opacity(0.62))
                    .multilineTextAlignment(.center).lineSpacing(2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: 560)
    }
}

private struct LabeledField: View {
    let label: String
    let icon: String
    @Binding var text: String
    let lines: Int
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 9.5, weight: .bold))
                Text(label).font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(.white.opacity(0.5))
            TextField(label, text: $text, axis: .vertical)
                .lineLimit(1...max(lines, 1))
                .fixedSize(horizontal: false, vertical: true)
                .textFieldStyle(.plain).font(.system(size: 13.5)).lineSpacing(1).focused($focused)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .stageField(focused: focused)
    }
}

/// Wrapping glass chips: the chosen one takes the brand's color. A flow `Layout`, laid out once per change.
private struct ChipFlow: View {
    let items: [String]
    let selected: String
    let pick: (String) -> Void
    @Environment(\.brandTint) private var brand

    var body: some View {
        let tint = brand ?? .onboardingAccent
        GlassEffectContainer(spacing: 8) {
            FlowLayout(spacing: 8) {
                ForEach(items, id: \.self) { item in
                    let on = item == selected
                    Button { pick(item) } label: {
                        Text(item)
                            .font(.system(size: 12.5, weight: on ? .semibold : .medium))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .foregroundStyle(on ? tint.label : .white.opacity(0.86))
                            .contentShape(.capsule)
                            .glassEffect(on ? .regular.tint(tint.opacity(0.85)).interactive() : .regular.interactive(), in: .capsule)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .animation(.smooth(duration: 0.3), value: selected)
    }
}

/// Big glass tiles with an icon: picking reads at a glance, no sentences needed.
private struct OptionTiles: View {
    struct Option {
        let title: String
        let icon: String
        init(_ title: String, _ icon: String) { self.title = title; self.icon = icon }
    }

    let options: [Option]
    let selected: String?
    let pick: (String) -> Void
    @Environment(\.brandTint) private var brand

    var body: some View {
        let tint = brand ?? .onboardingAccent
        GlassEffectContainer(spacing: 10) {
            HStack(spacing: 10) {
                ForEach(options, id: \.title) { option in
                    let on = option.title == selected
                    Button { pick(option.title) } label: {
                        VStack(spacing: 9) {
                            Image(systemName: option.icon).font(.system(size: 18, weight: .semibold)).frame(height: 22)
                            Text(option.title)
                                .font(.system(size: 12, weight: on ? .semibold : .medium))
                                .multilineTextAlignment(.center).lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .foregroundStyle(on ? tint.label : .white.opacity(0.82))
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, minHeight: 88)
                        .contentShape(.rect(cornerRadius: 20))
                        .glassEffect(on ? .regular.tint(tint.opacity(0.85)).interactive() : .regular.interactive(),
                                     in: .rect(cornerRadius: 20))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .animation(.smooth(duration: 0.3), value: selected)
    }
}

private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: proposal.width ?? rows.width, height: rows.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = arrange(width: bounds.width, subviews: subviews)
        for (index, point) in rows.points.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (points: [CGPoint], width: CGFloat, height: CGFloat) {
        var points: [CGPoint] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            points.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x)
        }
        return (points, maxX, y + rowHeight)
    }
}

/// 1.2M, 138K, 950.
private func shortCount(_ value: Int) -> String {
    value >= 1_000_000 ? String(format: "%.1fM", Double(value) / 1_000_000).replacingOccurrences(of: ".0M", with: "M")
        : value >= 1_000 ? "\(value / 1_000)K" : "\(value)"
}

private struct ShimmerLines: View {
    @State private var on = false
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach([1.0, 0.86, 0.94, 0.6], id: \.self) { width in
                Capsule().fill(.white.opacity(on ? 0.14 : 0.06)).frame(height: 10).frame(maxWidth: 520 * width, alignment: .leading)
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .onAppear { withAnimation(.easeInOut(duration: 0.9).repeatForever()) { on = true } }
    }
}

private struct ShimmerGrid: View {
    @State private var on = false
    var body: some View {
        HStack(spacing: 12) {
            ForEach(0..<3) { _ in
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(.white.opacity(on ? 0.12 : 0.05))
                    .aspectRatio(3 / 4, contentMode: .fit)
            }
        }
        .frame(maxWidth: 400)
        .onAppear { withAnimation(.easeInOut(duration: 1.1).repeatForever()) { on = true } }
    }
}

// MARK: - Buttons


/// The stage's colors, turning slowly: what fills the primary button until the brand takes over.
private struct SpinningAura: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        GeometryReader { proxy in
            let side = max(proxy.size.width, proxy.size.height) * 1.6
            AngularGradient(colors: EdgeGlow.palette, center: .center)
                .frame(width: side, height: side)
                .rotationEffect(.degrees(spin ? 360 : 0))
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
        .allowsHitTesting(false)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 4.5).repeatForever(autoreverses: false)) { spin = true }
        }
    }
}

private struct OptionalGlassID: ViewModifier {
    let id: String?
    let namespace: Namespace.ID?

    func body(content: Content) -> some View {
        if let id, let namespace { content.glassEffectID(id, in: namespace) } else { content }
    }
}


@MainActor
private func primaryButton(_ title: String, icon: String? = "arrow.right", glassID: String? = nil, in namespace: Namespace.ID? = nil,
                           action: @escaping () -> Void) -> some View {
    Button(action: action) {
        if let icon { Label(title, systemImage: icon) } else { Text(title) }
    }
    .buttonStyle(.appPrimary)
    .keyboardShortcut(.defaultAction)
}

@MainActor
private func secondaryButton(_ title: String, icon: String? = nil, small: Bool = false, action: @escaping () -> Void) -> some View {
    Button(action: action) {
        if let icon { Label(title, systemImage: icon) } else { Text(title) }
    }
    .buttonStyle(.appSecondary)
    .controlSize(small ? .small : .regular)
}

private extension Color {
    /// The onboarding's own color before a brand is known: the cyan of the stage's glow.
    static let onboardingAccent = Color(red: 0.15, green: 0.96, blue: 0.93)

    /// Text on top of this color: dark on light brands, white otherwise.
    var label: Color {
        guard let rgb = NSColor(self).usingColorSpace(.sRGB) else { return .white }
        let luminance = 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent
        return luminance > 0.62 ? .black : .white
    }
}

private struct StageField: ViewModifier {
    let focused: Bool
    @Environment(\.compactSteps) private var compact

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: compact ? 16 : 14, style: .continuous)
        content
            .padding(.horizontal, 16).padding(.vertical, compact ? 13 : 12)
            .background(shape.fill(.white.opacity(focused ? 0.1 : 0.07)))
            .overlay(shape.strokeBorder(.white.opacity(focused ? 0.4 : 0.12), lineWidth: 1))
            .animation(.smooth(duration: 0.2), value: focused)
    }
}

private extension View {
    func stageField(focused: Bool) -> some View {
        modifier(StageField(focused: focused))
    }
}

// MARK: - Edge glow

/// The screen's border flooded with soft color. Drawn and blurred once into a bitmap; after that only its hue
/// turns (a cheap color matrix on the GPU), so the stage never re-blurs a full-screen layer per frame. Once
/// the site is read, a glow in the brand's color fades in over it.
private struct EdgeGlow: View {
    let size: CGSize
    let brand: Color?
    let animated: Bool
    /// 1 for the whole screen; smaller for a window.
    var thickness: CGFloat = 1
    @State private var base: NSImage?
    @State private var branded: NSImage?

    static let palette: [Color] = [
        Color(red: 0.15, green: 0.96, blue: 0.93), Color(red: 0.42, green: 0.62, blue: 0.36),
        Color(red: 0.96, green: 0.78, blue: 0.38), Color(red: 1.0, green: 0.17, blue: 0.33),
        Color(red: 0.55, green: 0.45, blue: 0.95), Color(red: 0.15, green: 0.96, blue: 0.93)
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20, paused: !animated)) { context in
            let degrees = animated ? context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 24) / 24 * 360 : 0
            ZStack {
                if let base { Image(nsImage: base).resizable().hueRotation(.degrees(degrees)) }
                if let branded {
                    Image(nsImage: branded).resizable()
                        .hueRotation(.degrees(sin(degrees * .pi / 180) * 14))
                        .transition(.opacity)
                }
            }
        }
        .frame(width: size.width, height: size.height)
        .animation(.smooth(duration: 1.2), value: branded != nil)
        .task { base = Self.render(size: size, colors: Self.palette, thickness: thickness) }
        .task(id: brand?.description) {
            guard let brand else { branded = nil; return }
            let light = brand.mix(with: .white, by: 0.35), deep = brand.mix(with: .black, by: 0.2)
            branded = Self.render(size: size, colors: [brand, light, deep, brand, light, brand], thickness: thickness)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @MainActor
    private static func render(size: CGSize, colors: [Color], thickness: CGFloat) -> NSImage? {
        let gradient = AngularGradient(colors: colors, center: .center)
        let t = thickness
        let glow = ZStack {
            Rectangle().strokeBorder(gradient, lineWidth: 120 * t).blur(radius: 90 * t).opacity(0.85)
            Rectangle().strokeBorder(gradient, lineWidth: 34 * t).blur(radius: 26 * t)
            Rectangle().strokeBorder(gradient, lineWidth: 5 * t).blur(radius: 4 * t).opacity(0.7)
        }
        .frame(width: size.width, height: size.height)
        let renderer = ImageRenderer(content: glow)
        // Soft light needs no retina pixels; half the cost to draw and to keep.
        renderer.scale = 1
        return renderer.nsImage
    }
}

/// The desktop behind the stage, blurred by the window server.
private struct BehindWindowBlur: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .fullScreenUI

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}
