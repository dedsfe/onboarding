import Combine
import Sparkle
import SwiftUI

@MainActor
final class AppUpdates: ObservableObject {
    static let shared = AppUpdates()
    @Published private(set) var canCheck = false
    @Published private(set) var automaticChecks = false
    @Published private(set) var message: String?
    private var controller: SPUStandardUpdaterController?

    func start() {
        guard controller == nil else { return }
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String,
              let feed = URL(string: raw), feed.scheme == "https", feed.host != nil,
              let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
              Data(base64Encoded: key)?.count == 32 else {
            message = "As atualizações automáticas serão habilitadas na versão de distribuição."
            return
        }
        let controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil)
        self.controller = controller
        controller.updater.publisher(for: \.canCheckForUpdates).assign(to: &$canCheck)
        controller.updater.publisher(for: \.automaticallyChecksForUpdates).assign(to: &$automaticChecks)
        do { try controller.updater.start() }
        catch { message = "Não foi possível iniciar o serviço de atualizações." }
    }

    func check() { controller?.checkForUpdates(nil) }
    func setAutomaticChecks(_ enabled: Bool) { controller?.updater.automaticallyChecksForUpdates = enabled }
}

struct CheckForAppUpdates: View {
    @ObservedObject private var updates = AppUpdates.shared
    var body: some View {
        Button("Buscar atualizações…") { updates.check() }.disabled(!updates.canCheck)
    }
}

struct UpdateSettingsView: View {
    @ObservedObject private var updates = AppUpdates.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let message = updates.message {
                Text(message).fixedSize(horizontal: false, vertical: true)
            } else {
                Toggle("Buscar novas versões automaticamente", isOn: Binding(
                    get: { updates.automaticChecks }, set: { updates.setAutomaticChecks($0) }))
                CheckForAppUpdates()
            }
        }
        .onAppear { updates.start() }
    }
}
