import SwiftUI

// Slidi, the app's mascot: a soft-touch 9:16 post card with a Grok-style face drawn in code.
// No mouth, no limbs — two dark capsule eyes that morph between states, and the carousel dots as a signature.

enum SlidiState: Equatable, CaseIterable {
    case idle, happy, generating, thinking
    case curious, resting, concerned

    var label: String {
        switch self {
        case .idle: "Parado"
        case .happy: "Feliz"
        case .generating: "Gerando"
        case .thinking: "Pensando"
        case .curious: "Curioso"
        case .resting: "Descansando"
        case .concerned: "Preocupado"
        }
    }
}

struct SlidiView: View {
    var state: SlidiState

    @State private var blinking = false
    @State private var litDot = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            let w = proxy.size.width, h = proxy.size.height
            ZStack {
                SlidiBody(width: w)
                face(w)
                    .offset(y: h * 0.43 - h / 2)
                dots(w)
                    .offset(y: h * 0.875 - h / 2)
            }
            .frame(width: w, height: h)
        }
        .aspectRatio(9 / 16, contentMode: .fit)
        .animation(reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.66), value: state)
        .task(id: Playback(state: state, reduceMotion: reduceMotion)) { await play() }
        .accessibilityHidden(true)
    }

    private struct Playback: Equatable {
        let state: SlidiState
        let reduceMotion: Bool
    }

    private func face(_ w: CGFloat) -> some View {
        ZStack {
            ForEach([-1.0, 1.0], id: \.self) { side in
                Ellipse()
                    .fill(SlidiPalette.cheek.opacity(state == .happy ? 0.55 : 0.32))
                    .frame(width: w * 0.15, height: w * 0.075)
                    .blur(radius: w * 0.022)
                    .offset(x: side * w * 0.3, y: w * 0.15)
                eye(w, side: side).offset(x: side * w * 0.19)
            }
        }
        .offset(x: state == .thinking ? w * 0.02 : 0)
    }

    private func eye(_ w: CGFloat, side: Double) -> some View {
        let box = w * 0.4
        let glint = state.glint(side: side)
        let spot = glint ?? .zero
        return ZStack {
            EyeShape(trace: state.eyeTrace(side: side), unit: w)
                .fill(LinearGradient(colors: [SlidiPalette.eyeTop, SlidiPalette.eyeBottom], startPoint: .top, endPoint: .bottom))
            Circle().fill(.white)
                .frame(width: w * 0.042, height: w * 0.042)
                .scaleEffect(glint == nil ? 0.01 : 1)
                .opacity(glint == nil ? 0 : 0.95)
                .offset(x: spot.x * w, y: spot.y * w)
            if state == .generating {
                Spinner(width: w, paused: reduceMotion)
                    .transition(.opacity)
            }
        }
        .frame(width: box, height: box)
        .scaleEffect(x: 1, y: blinking ? 0.1 : 1)
    }

    private func dots(_ w: CGFloat) -> some View {
        HStack(spacing: w * 0.038) {
            ForEach(0..<4, id: \.self) { index in
                let lit = index == litDot
                Capsule()
                    .fill(lit && state == .generating ? AnyShapeStyle(SlidiPalette.tiktok)
                          : AnyShapeStyle(SlidiPalette.ink.opacity(lit ? 0.78 : 0.16)))
                    .frame(width: w * (lit ? 0.13 : 0.052), height: w * 0.052)
            }
        }
    }

    /// Blinks now and then while idle or thinking; walks the lit dot along the carousel while generating.
    private func play() async {
        blinking = false
        litDot = 0
        guard !reduceMotion else { return }
        while !Task.isCancelled {
            switch state {
            case .generating:
                try? await Task.sleep(for: .milliseconds(340))
                guard !Task.isCancelled else { return }
                withAnimation(.spring(response: 0.3, dampingFraction: 0.72)) { litDot = (litDot + 1) % 4 }
            case .idle, .thinking, .curious, .concerned:
                try? await Task.sleep(for: .seconds(Double.random(in: 2.4...5.2)))
                guard !Task.isCancelled else { return }
                await blink()
                if Int.random(in: 0..<4) == 0 { await blink() }
            case .happy, .resting:
                return
            }
        }
    }

    private func blink() async {
        withAnimation(.easeIn(duration: 0.07)) { blinking = true }
        try? await Task.sleep(for: .milliseconds(90))
        guard !Task.isCancelled else { return }
        withAnimation(.easeOut(duration: 0.14)) { blinking = false }
        try? await Task.sleep(for: .milliseconds(180))
    }
}

/// Shared, bare mascot and copy. The surrounding screen owns the surface and the spacing.
struct SlidiMessage: View {
    let state: SlidiState
    let title: String
    var detail: String? = nil
    var width: CGFloat = 40
    var stacked = false

    var body: some View {
        Group {
            if stacked {
                VStack(spacing: 20) {
                    portrait
                    copy
                }
            } else {
                HStack(spacing: 16) {
                    portrait
                    copy
                }
            }
        }
        .accessibilityElement(children: .combine)
        .allowsHitTesting(false)
    }

    private var portrait: some View {
        SlidiView(state: state).frame(width: width, height: width * 16 / 9)
    }

    private var copy: some View {
        VStack(alignment: stacked ? .center : .leading, spacing: 6) {
            Text(title).font(.system(size: stacked ? 18 : 14, weight: .semibold))
            if let detail {
                Text(detail).font(.system(size: stacked ? 14 : 12))
                    .foregroundStyle(.secondary)
            }
        }
        .multilineTextAlignment(stacked ? .center : .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// The mascot is the loading indicator itself, with no extra badge, tile or spinner around it.
struct SlidiGenerationStatus: View {
    let compact: Bool

    var body: some View {
        Group {
            if compact {
                HStack(spacing: 16) {
                    SlidiView(state: .generating).frame(width: 40, height: 40 * 16 / 9)
                    caption
                }
            } else {
                VStack(spacing: 24) {
                    SlidiView(state: .generating).frame(width: 88, height: 88 * 16 / 9)
                    caption
                }
            }
        }
        .padding(16)
        .foregroundStyle(.white)
        .allowsHitTesting(false)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("IA gerando imagens")
    }

    private var caption: some View {
        Text("Criando suas imagens")
            .font(.system(size: compact ? 14 : 18, weight: .semibold))
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private enum SlidiPalette {
    static let cyan = Color(red: 0x25 / 255, green: 0xF4 / 255, blue: 0xEE / 255)
    static let pink = Color(red: 0xFE / 255, green: 0x2C / 255, blue: 0x55 / 255)
    static let ink = Color(red: 0.07, green: 0.07, blue: 0.09)
    static let eyeTop = Color(red: 0.19, green: 0.2, blue: 0.24)
    static let eyeBottom = Color(red: 0.04, green: 0.04, blue: 0.06)
    static let cheek = Color(red: 1, green: 0.48, blue: 0.6)
    static let bodyTop = Color(red: 0.93, green: 0.93, blue: 0.95)
    static let bodyBottom = Color(red: 0.74, green: 0.75, blue: 0.79)
    static let tiktok = LinearGradient(colors: [cyan, pink], startPoint: .leading, endPoint: .trailing)
}

/// The card itself: matte gradient lit from above, a soft specular on top, inner shading at the edges,
/// TikTok cyan and pink as rim light on the sides, and a soft cast shadow.
private struct SlidiBody: View {
    let width: CGFloat

    var body: some View {
        let card = RoundedRectangle(cornerRadius: width * 0.3, style: .continuous)
        let rim = LinearGradient(stops: [
            .init(color: SlidiPalette.cyan, location: 0), .init(color: SlidiPalette.cyan.opacity(0), location: 0.2),
            .init(color: SlidiPalette.pink.opacity(0), location: 0.8), .init(color: SlidiPalette.pink, location: 1)
        ], startPoint: .leading, endPoint: .trailing)
        ZStack {
            card.stroke(rim, lineWidth: width * 0.04)
                .blur(radius: width * 0.08)
                .opacity(0.3)
            card.fill(LinearGradient(colors: [SlidiPalette.bodyTop, SlidiPalette.bodyBottom], startPoint: .top, endPoint: .bottom)
                .shadow(.inner(color: .black.opacity(0.35), radius: width * 0.07, y: -width * 0.04))
                .shadow(.inner(color: .white.opacity(0.9), radius: width * 0.02, y: width * 0.025)))
                .shadow(color: .black.opacity(0.45), radius: width * 0.09, y: width * 0.07)
            card.strokeBorder(rim, lineWidth: width * 0.035)
                .blur(radius: width * 0.03)
                .opacity(0.5)
                .mask(card)
            Ellipse().fill(.white)
                .frame(width: width * 0.7, height: width * 0.26)
                .blur(radius: width * 0.05)
                .offset(y: -width * 0.6)
                .mask(card)
            card.strokeBorder(LinearGradient(colors: [.white.opacity(0.9), .white.opacity(0)], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.25)),
                              lineWidth: max(1, width * 0.01))
        }
    }
}

/// The loading arc that spins over the ring eyes while generating.
private struct Spinner: View {
    let width: CGFloat
    let paused: Bool

    var body: some View {
        TimelineView(.animation(paused: paused)) { context in
            let turns = paused ? 0 : context.date.timeIntervalSinceReferenceDate / 0.9
            Circle().trim(from: 0, to: 0.3)
                .stroke(SlidiPalette.tiktok, style: StrokeStyle(lineWidth: width * 0.05, lineCap: .round))
                .frame(width: width * 0.15, height: width * 0.15)
                .rotationEffect(.radians(turns.truncatingRemainder(dividingBy: 1) * 2 * .pi))
        }
    }
}

// MARK: - Eye morph

/// An eye is a round-capped stroke along a polyline; morphing between states interpolates its points and thickness.
private struct EyeShape: Shape {
    var trace: EyeTrace
    let unit: CGFloat

    var animatableData: EyeTrace {
        get { trace }
        set { trace = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let values = trace.values
        guard values.count > 2 else { return Path() }
        let points = stride(from: 0, to: values.count - 2, by: 2).map {
            CGPoint(x: rect.midX + values[$0] * unit, y: rect.midY + values[$0 + 1] * unit)
        }
        var line = Path()
        line.addLines(points)
        return line.strokedPath(StrokeStyle(lineWidth: max(0.5, values[values.count - 1] * unit), lineCap: .round, lineJoin: .round))
    }
}

/// Flat list of x, y pairs followed by the stroke thickness, all in card-width units.
private struct EyeTrace: VectorArithmetic {
    var values: [Double]

    static let zero = EyeTrace(values: [])

    static func + (lhs: EyeTrace, rhs: EyeTrace) -> EyeTrace { lhs.combined(with: rhs, +) }
    static func - (lhs: EyeTrace, rhs: EyeTrace) -> EyeTrace { lhs.combined(with: rhs, -) }
    mutating func scale(by rhs: Double) { values = values.map { $0 * rhs } }
    var magnitudeSquared: Double { values.reduce(0) { $0 + $1 * $1 } }

    private func combined(with other: EyeTrace, _ operation: (Double, Double) -> Double) -> EyeTrace {
        let count = max(values.count, other.values.count)
        return EyeTrace(values: (0..<count).map {
            operation($0 < values.count ? values[$0] : 0, $0 < other.values.count ? other.values[$0] : 0)
        })
    }

    static func sampled(thickness: Double, _ point: (Double) -> (x: Double, y: Double)) -> EyeTrace {
        let samples = 32
        var values: [Double] = []
        for index in 0..<samples {
            let p = point(Double(index) / Double(samples - 1))
            values += [p.x, p.y]
        }
        return EyeTrace(values: values + [thickness])
    }
}

private extension SlidiState {
    func eyeTrace(side: Double) -> EyeTrace {
        switch self {
        case .idle:
            // Tall capsule
            .sampled(thickness: 0.15) { t in (0, -0.075 + 0.15 * t) }
        case .thinking:
            // Shorter capsule glancing up and aside
            .sampled(thickness: 0.14) { t in (0.05, -0.1 + 0.1 * t) }
        case .happy:
            // Closed, smiling ^ arch
            .sampled(thickness: 0.07) { t in (-0.085 * cos(.pi * t), 0.035 - 0.085 * sin(.pi * t)) }
        case .generating:
            // Full ring; the spinner rides on top of it
            .sampled(thickness: 0.05) { t in (0.075 * cos(.pi + 2 * .pi * t), 0.075 * sin(.pi + 2 * .pi * t)) }
        case .curious:
            // Unequal capsules: one eye opens wider while the other narrows inquisitively.
            .sampled(thickness: side < 0 ? 0.17 : 0.12) { t in
                (0.02, side < 0 ? -0.105 + 0.17 * t : -0.015 + 0.055 * t)
            }
        case .resting:
            // Two gently closed eyelids, without adding a mouth or decorative sleep symbols.
            .sampled(thickness: 0.065) { t in (-0.075 + 0.15 * t, 0.02 + 0.025 * sin(.pi * t)) }
        case .concerned:
            // Inward-slanting eyes communicate a problem while staying within the same face.
            .sampled(thickness: 0.09) { t in (-0.055 + 0.11 * t, side * (-0.035 + 0.07 * t)) }
        }
    }

    /// Where the little shine sits on the eye, or nil when the eye is closed or a ring.
    func glint(side: Double) -> CGPoint? {
        switch self {
        case .idle: CGPoint(x: 0.03, y: -0.06)
        case .thinking: CGPoint(x: 0.08, y: -0.08)
        case .curious: CGPoint(x: 0.035, y: side < 0 ? -0.08 : -0.025)
        case .happy, .generating, .resting, .concerned: nil
        }
    }
}
