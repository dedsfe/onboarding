import AppKit
import AVFoundation
import CoreText
import SwiftUI

extension Notification.Name {
    static let showProductIntroduction = Notification.Name("showProductIntroduction")
}

/// An invitation into the product. The functional onboarding owns when to present this
/// view and what follows `continue`. It does not activate a trial or mark setup complete.
struct ProductIntroductionView: View {
    let onContinue: () -> Void

    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("introductionSoundEnabled") private var soundEnabled = false
    @StateObject private var playback = IntroductionPlayback()
    @State private var pointer = CGPoint.zero
    @State private var resumeWhenActive = false

    private var reduceMotion: Bool {
        #if DEBUG
        systemReduceMotion || ProcessInfo.processInfo.arguments.contains("--intro-reduced-motion")
        #else
        systemReduceMotion
        #endif
    }

    var body: some View {
        GeometryReader { geometry in
            TimelineView(.animation(minimumInterval: 1 / 60, paused: !playback.isPlaying)) { _ in
                let time = playback.elapsed
                let composition = IntroductionComposition(time: time, size: geometry.size)
                ZStack {
                    IntroductionPainting(composition: composition, pointer: reduceMotion ? .zero : pointer)
                    ForEach(0..<3) { index in
                        IntroductionSlide(index: index, composition: composition,
                                          pointer: reduceMotion ? .zero : pointer)
                    }
                    headline(composition).zIndex(3)
                    VStack(spacing: 0) {
                        header
                        Spacer(minLength: 0)
                        footer
                    }
                    .zIndex(4)
                }
                .onChange(of: time >= IntroductionPlayback.duration) { _, finished in
                    if finished { playback.finish() }
                }
            }
            .onContinuousHover { phase in
                guard !reduceMotion else { return }
                switch phase {
                case .active(let point):
                    pointer = CGPoint(x: point.x / max(geometry.size.width, 1) - 0.5,
                                      y: point.y / max(geometry.size.height, 1) - 0.5)
                case .ended: pointer = .zero
                }
            }
        }
        .background(IntroductionAssets.ink)
        .environment(\.colorScheme, .dark)
        .foregroundStyle(.white)
        .ignoresSafeArea()
        .onAppear {
            playback.start(reduceMotion: reduceMotion, soundEnabled: soundEnabled)
        }
        .onDisappear { playback.stop() }
        .onChange(of: soundEnabled) { _, enabled in playback.setSound(enabled) }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced { playback.finish() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                if playback.isPlaying {
                    resumeWhenActive = true
                    playback.pause()
                }
            } else if resumeWhenActive {
                resumeWhenActive = false
                playback.play()
            }
        }
        .onExitCommand(perform: onContinue)
    }

    private func headline(_ composition: IntroductionComposition) -> some View {
        Text("Uma ideia.\nMuitas possibilidades.")
            .font(IntroductionAssets.display(size: composition.titleSize))
            .multilineTextAlignment(.center)
            .lineSpacing(1)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: composition.size.width - 96)
            .position(x: composition.size.width / 2, y: composition.titleY)
            .accessibilityAddTraits(.isHeader)
            .allowsHitTesting(false)
    }

    private var header: some View {
        HStack {
            Text("The Carousel Maker")
                .font(IntroductionAssets.display(size: 22))
            Spacer()
            if !playback.isFinished && !reduceMotion {
                Button("Pular apresentação") { playback.finish() }
                    .buttonStyle(.appSecondary)
                    .help("Ir para a composição final")
            }
        }
        .padding(.horizontal, 40)
        .padding(.top, 48)
    }

    private var footer: some View {
        VStack(spacing: 22) {
            HStack(alignment: .center, spacing: 24) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Fotos, textos e sua IA.")
                        .font(.system(size: 17, weight: .medium))
                    Text("Um estúdio de carrosséis no seu Mac.")
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.84))
                }
                Spacer(minLength: 16)
                Button("Abrir meus projetos", action: onContinue)
                    .buttonStyle(.appPrimary)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityHint("Fecha a apresentação e abre seus projetos. Não inicia o teste grátis.")
            }
            HStack(alignment: .center) {
                Link("Claude Monet, 1880 · National Gallery of Art",
                     destination: URL(string: "https://www.nga.gov/artworks/46652-banks-seine-vetheuil")!)
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.8))
                    .help("Banks of the Seine, Vétheuil. Obra em domínio público.")
                Spacer()
                HStack(spacing: 16) {
                    if !reduceMotion {
                        Button {
                            playback.isPlaying ? playback.pause() : playback.play()
                        } label: {
                            Label(playback.isFinished ? "Rever" : playback.isPlaying ? "Pausar" : "Continuar",
                                  systemImage: playback.isFinished ? "arrow.counterclockwise"
                                    : playback.isPlaying ? "pause.fill" : "play.fill")
                        }
                        .buttonStyle(.appSecondary)
                        .controlSize(.small)
                        .help(playback.isFinished ? "Rever a apresentação" : "Controlar a reprodução")
                    }
                    Button {
                        soundEnabled.toggle()
                    } label: {
                        Label(soundEnabled ? "Som ligado" : "Ativar som",
                              systemImage: soundEnabled ? "speaker.wave.2" : "speaker.slash")
                    }
                    .buttonStyle(.appSecondary)
                    .controlSize(.small)
                    .accessibilityValue(soundEnabled ? "Ligado" : "Desligado")
                    .help("Trilha original e opcional da apresentação")
                    .disabled(reduceMotion)
                }
            }
        }
        .padding(.horizontal, 40)
        .padding(.bottom, 28)
        .padding(.top, 22)
        .background {
            if reduceTransparency {
                IntroductionAssets.ink.opacity(0.96)
            }
        }
    }
}

/// Only the artwork is choreographed. The heading, action and playback controls are
/// visible and usable even if the animation never advances. Initial state is the final frame.
private struct IntroductionComposition {
    let time: Double
    let size: CGSize

    var separation: CGFloat { eased(from: 1.4, to: 5.8) }
    var settling: CGFloat { eased(from: 5.8, to: 8.8) }
    var titleSize: CGFloat { mix(min(76, size.width * 0.069), min(46, size.width * 0.044), separation) }
    var titleY: CGFloat { mix(size.height * 0.43, size.height * 0.235, separation) }
    var cardHeight: CGFloat { min(330, size.height * 0.43) }
    var cardWidth: CGFloat { cardHeight * 0.8 }

    func eased(from: Double, to: Double) -> CGFloat {
        let value = CGFloat(min(max((time - from) / (to - from), 0), 1))
        return value * value * value * (value * (value * 6 - 15) + 10)
    }

    func mix(_ start: CGFloat, _ end: CGFloat, _ fraction: CGFloat) -> CGFloat {
        start + (end - start) * fraction
    }
}

private struct IntroductionPainting: View {
    let composition: IntroductionComposition
    let pointer: CGPoint

    var body: some View {
        GeometryReader { proxy in
            Image(nsImage: IntroductionAssets.painting)
                .resizable().scaledToFill()
                .frame(width: proxy.size.width, height: proxy.size.height)
                .scaleEffect(1.04 + 0.025 * (1 - composition.separation))
                .offset(x: pointer.x * -7, y: pointer.y * -5)
                .overlay(IntroductionAssets.ink.opacity(0.38 + 0.26 * Double(composition.separation)))
                .overlay {
                    LinearGradient(stops: [
                        .init(color: IntroductionAssets.ink.opacity(0.22), location: 0),
                        .init(color: .clear, location: 0.38),
                        .init(color: IntroductionAssets.ink.opacity(0.15), location: 0.7),
                        .init(color: IntroductionAssets.ink.opacity(0.6), location: 1)
                    ], startPoint: .top, endPoint: .bottom)
                }
        }
        .clipped()
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

private struct IntroductionSlide: View {
    let index: Int
    let composition: IntroductionComposition
    let pointer: CGPoint

    private var title: String { ["Uma ideia.\nVárias histórias.", "Seu olhar.\nSeu jeito.", "Mais espaço\npara criar."][index] }

    var body: some View {
        let c = composition
        let p = c.separation
        let direction = CGFloat(index - 1)
        let initialX = c.size.width * (CGFloat(index) + 0.5) / 3
        let spread = c.cardWidth * (0.91 + 0.34 * c.settling)
        let width = c.mix(c.size.width / 3 + 1, c.cardWidth, p)
        let height = c.mix(c.size.height, c.cardHeight, p)
        let centerX = c.mix(initialX, c.size.width / 2 + direction * spread, p)
        let centerY = c.mix(c.size.height / 2, c.size.height * 0.54 + abs(direction) * 11, p)
        let photoWidth = c.mix(c.size.width * 1.065, c.cardWidth * 1.08, p)
        let photoHeight = c.mix(c.size.height * 1.065, c.cardHeight * 1.08, p)

        ZStack(alignment: .bottomLeading) {
            Image(nsImage: IntroductionAssets.painting)
                .resizable().scaledToFill()
                .frame(width: photoWidth, height: photoHeight)
                .offset(x: (c.size.width / 2 - initialX) * (1 - p) + direction * 12 * p,
                        y: pointer.y * -5 * p)
                .frame(width: width, height: height)
                .overlay(IntroductionAssets.ink.opacity(0.42 * Double(1 - p)))
            LinearGradient(colors: [.clear, .black.opacity(0.62)], startPoint: .center, endPoint: .bottom)
                .opacity(Double(p))
            VStack(alignment: .leading, spacing: 10) {
                Text(String(format: "%02d", index + 1))
                    .font(.system(size: 10, weight: .medium)).monospacedDigit()
                Text(title)
                    .font(IntroductionAssets.display(size: c.cardWidth * 0.135))
                    .lineSpacing(1)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(c.cardWidth * 0.095)
            // These words are part of the decorative example, not a live control.
            .opacity(Double(p))
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 14 * p, style: .continuous))
        .rotationEffect(.degrees(Double(direction) * (8 - 2 * c.settling) * Double(p)))
        .rotation3DEffect(.degrees(Double(pointer.x * direction * 2 * p)), axis: (x: 0, y: 1, z: 0))
        .position(x: centerX + pointer.x * 9 * p,
                  y: centerY + pointer.y * 5 * p)
        .zIndex(index == 1 ? 2 : 1)
        .accessibilityHidden(true)
        .allowsHitTesting(false)
    }
}

@MainActor
private final class IntroductionPlayback: ObservableObject {
    static let duration: TimeInterval = 9.5
    @Published private(set) var isPlaying = false
    @Published private var accumulated: TimeInterval = duration
    private var beganAt: TimeInterval?
    private var audio: AVAudioPlayer?
    private var soundEnabled = false

    var elapsed: TimeInterval {
        min(Self.duration, accumulated + (beganAt.map { ProcessInfo.processInfo.systemUptime - $0 } ?? 0))
    }

    var isFinished: Bool { !isPlaying && accumulated >= Self.duration }

    func start(reduceMotion: Bool, soundEnabled: Bool) {
        self.soundEnabled = soundEnabled
        guard !reduceMotion else { finish(); return }
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let index = args.firstIndex(of: "--intro-frame"), index + 1 < args.count,
           let frame = Double(args[index + 1]), frame.isFinite {
            accumulated = min(max(frame, 0), Self.duration)
            return
        }
        #endif
        accumulated = 0
        play()
    }

    func play() {
        guard !isPlaying else { return }
        if accumulated >= Self.duration { accumulated = 0 }
        beganAt = ProcessInfo.processInfo.systemUptime
        isPlaying = true
        syncAudio()
    }

    func pause() {
        guard isPlaying else { return }
        let current = elapsed
        beganAt = nil
        accumulated = current
        isPlaying = false
        audio?.pause()
    }

    func finish() {
        beganAt = nil
        accumulated = Self.duration
        isPlaying = false
        audio?.stop()
    }

    func stop() { pause(); audio?.stop() }

    func setSound(_ enabled: Bool) {
        soundEnabled = enabled
        if enabled {
            if isFinished { play() } else { syncAudio() }
        } else {
            audio?.stop()
        }
    }

    private func syncAudio() {
        guard soundEnabled, isPlaying else { return }
        if audio == nil, let url = Bundle.module.url(forResource: "intro-score", withExtension: "wav") {
            audio = try? AVAudioPlayer(contentsOf: url)
            audio?.volume = 0.32
            audio?.prepareToPlay()
        }
        audio?.currentTime = elapsed
        audio?.play()
    }
}

@MainActor
enum IntroductionAssets {
    static let ink = Color(red: 0.055, green: 0.105, blue: 0.085)
    static let painting: NSImage = {
        guard let url = Bundle.module.url(forResource: "intro-monet", withExtension: "jpg"),
              let image = NSImage(contentsOf: url) else { return NSImage(size: NSSize(width: 1, height: 1)) }
        return image
    }()
    static let registeredFont: String = {
        if let url = Bundle.module.url(forResource: "Gambarino-Regular", withExtension: "otf") {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
        return NSFont(name: "Gambarino-Regular", size: 20) != nil ? "Gambarino-Regular" : "Georgia"
    }()

    static func display(size: CGFloat) -> Font { .custom(registeredFont, size: size) }
}

/// Opt-in presentation for the current app. Claude can embed ProductIntroductionView
/// directly in the functional onboarding without inheriting a second first-run flag.
struct ProductIntroductionLifecycle: ViewModifier {
    @State private var presented = false
    @State private var window: NSWindow?

    func body(content: Content) -> some View {
        content
            .disabled(presented)
            .accessibilityHidden(presented)
            .background { IntroductionWindowReader { window = $0 } }
            .overlay {
                if presented {
                    ProductIntroductionView {
                        presented = false
                        NotificationCenter.default.post(name: .showProjectsHome, object: nil)
                    }
                    .zIndex(100)
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .showProductIntroduction)) { _ in
                guard window?.isKeyWindow == true else { return }
                presented = true
            }
            .onAppear {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--intro-preview") { presented = true }
                #endif
            }
    }
}

private struct IntroductionWindowReader: NSViewRepresentable {
    let found: (NSWindow?) -> Void
    func makeNSView(context: Context) -> WindowView { WindowView(found: found) }
    func updateNSView(_ nsView: WindowView, context: Context) {}

    final class WindowView: NSView {
        let found: (NSWindow?) -> Void
        init(found: @escaping (NSWindow?) -> Void) {
            self.found = found
            super.init(frame: .zero)
        }
        required init?(coder: NSCoder) { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            let current = window
            DispatchQueue.main.async { [weak self] in self?.found(current) }
        }
    }
}
