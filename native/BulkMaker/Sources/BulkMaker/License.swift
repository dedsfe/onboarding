import AppKit
import Combine
import Foundation

@MainActor
final class License: ObservableObject {
    static let shared: License = {
        let configuration = LicenseConfiguration.bundled
        let storage: any LicenseStorage = (Bundle.main.bundleIdentifier?.hasSuffix(".dev") == true)
            ? DevelopmentLicenseStorage(url: DevelopmentLicenseStorage.defaultURL(environment: configuration.environment))
            : LicenseKeychain(service: "com.andrefelipe.carouselmaker.license.\(configuration.environment)")
        return License(provider: LemonSqueezyLicenseProvider(configuration: configuration),
                       storage: storage,
                       configuration: configuration)
    }()

    @Published private(set) var record = LicenseRecord()
    @Published private(set) var isBusy = false
    @Published private(set) var message: String?
    @Published private(set) var storageFailed = false
    @Published private(set) var isOffline = false
    @Published private var clock = Date()
    @Published var showsActivation = false

    let configuration: LicenseConfiguration
    private let provider: any LicenseProvider
    private let storage: any LicenseStorage
    private let now: () -> Date
    private var lastAttempt: Date?
    private var monitoring = false
    private var monitorTask: Task<Void, Never>?

    init(provider: any LicenseProvider, storage: any LicenseStorage,
         configuration: LicenseConfiguration, now: @escaping () -> Date = Date.init) {
        self.provider = provider
        self.storage = storage
        self.configuration = configuration
        self.now = now
        reloadStorage()
    }

    var access: LicenseAccess {
        if storageFailed { return .locked(LicenseFailure.storage.localizedDescription) }
        return LicensePolicy.access(record: record, now: now(), offline: isOffline)
    }

    var hasActivation: Bool { record.credentials != nil }
    /// Stable integration point for the onboarding/paywall owned by Claude.
    var status: LicenseAccess { access }
    var canStartTrial: Bool { !storageFailed && record.trialStartedAt == nil && !hasActivation }

    func canUse(_ feature: LicensedFeature) -> Bool {
        !feature.needsSubscription || access.isAllowed
    }

    /// UI entry points use require; background workers use canUse and simply skip the job.
    @discardableResult
    func require(_ feature: LicensedFeature) -> Bool {
        guard canUse(feature) else { showsActivation = true; return false }
        return true
    }

    func startTrial() {
        guard !isBusy, canStartTrial else { return }
        var next = record
        next.trialStartedAt = now()
        next.lastObservedAt = now()
        do {
            try persist(next)
            message = nil
            showsActivation = false
        } catch { message = LicenseFailure.storage.localizedDescription }
    }

    func activate(key: String) async {
        guard !isBusy, !storageFailed else { return }
        let key = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { message = "Cole a chave recebida por e-mail."; return }
        // Revalidating the same key must not consume a second slot on this Mac.
        if record.credentials?.key == key { await revalidate(); return }
        guard !hasActivation else {
            message = "Desative a chave atual neste Mac antes de ativar outra."
            return
        }
        isBusy = true
        message = nil
        defer { isBusy = false }
        do {
            // An opaque local label avoids sending the user's computer/account name.
            let entitlement = try await provider.activate(key: key, instanceName: "Mac \(UUID().uuidString)")
            var next = record
            next.credentials = .init(key: key, entitlement: entitlement, validatedAt: now())
            next.lastObservedAt = now()
            do { try persist(next) }
            catch {
                // Do not strand a remote activation if Keychain cannot save its instance_id.
                do { try await provider.deactivate(key: key, instanceID: entitlement.instanceID) }
                catch {
                    record = next
                    storageFailed = true
                    message = "A ativação foi criada, mas o Chaves não pôde salvá-la. Mantenha o app aberto, desbloqueie o Chaves e clique em Tentar novamente."
                    return
                }
                throw LicenseFailure.storage
            }
            isOffline = false
            showsActivation = false
        } catch { message = userMessage(error) }
    }

    func revalidate() async {
        guard !isBusy, !storageFailed, let credentials = record.credentials else { return }
        isBusy = true
        lastAttempt = now()
        defer { isBusy = false }
        do {
            let entitlement = try await provider.validate(key: credentials.key,
                                                          instanceID: credentials.entitlement.instanceID)
            var next = record
            next.credentials = .init(key: credentials.key, entitlement: entitlement, validatedAt: now())
            next.lastObservedAt = now()
            try persist(next)
            isOffline = false
            message = nil
        } catch let failure as LicenseFailure {
            switch failure {
            case .rejected, .wrongProduct, .activationLimit:
                var next = record
                next.credentials?.rejected = true
                // Keep the rejection in memory even if the Keychain write fails.
                record = next
                do { try persist(next) } catch { storageFailed = true }
                isOffline = false
            case .unavailable, .invalidResponse:
                // A broken response cannot extend the last known good validation.
                isOffline = true
            case .configuration:
                record.credentials?.rejected = true
            case .storage:
                storageFailed = true
            }
            message = userMessage(failure)
        } catch {
            isOffline = true
            message = userMessage(error)
        }
    }

    func deactivate() async {
        guard !isBusy, let credentials = record.credentials else { return }
        isBusy = true
        message = nil
        defer { isBusy = false }
        do {
            do { try await provider.deactivate(key: credentials.key, instanceID: credentials.entitlement.instanceID) }
            catch LicenseFailure.rejected where credentials.rejected {
                // A previously revoked/deleted instance must not trap the user on an unusable key.
            }
            var next = record
            next.credentials = nil
            // Deactivation is not a new trial and never deletes projects or output.
            next.trialStartedAt = record.trialStartedAt ?? now().addingTimeInterval(-LicensePolicy.trialDuration)
            next.lastObservedAt = now()
            record = next
            try persist(next)
            isOffline = false
        } catch { message = userMessage(error) }
    }

    /// Retry a failed save without losing the only copy of a newly issued instance_id.
    func retryStorage() async {
        guard !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            let storage = storage
            // Never ask for the login Keychain password, including explicit retries.
            let recovered = try await Task.detached(priority: .userInitiated) { try storage.recover() }.value
            if record.credentials != nil || record.trialStartedAt != nil { try persist(record) }
            else { record = recovered ?? LicenseRecord(); storageFailed = false }
            if !storageFailed { message = nil }
        } catch { message = LicenseFailure.storage.localizedDescription }
    }

    /// Owned by the shared license, so closing the first window cannot stop other windows' checks.
    func startMonitoring() {
        guard monitorTask == nil else { return }
        monitorTask = Task { await monitor() }
    }

    /// Revalidate at launch and after waking if 24h elapsed.
    private func monitor() async {
        guard !monitoring else { return }
        monitoring = true
        defer { monitoring = false }
        await revalidate()
        while !Task.isCancelled {
            heartbeat()
            if let validatedAt = record.credentials?.validatedAt,
               now().timeIntervalSince(validatedAt) >= LicensePolicy.validationInterval,
               lastAttempt.map({ now().timeIntervalSince($0) >= 15 * 60 }) ?? true {
                await revalidate()
            }
            do { try await Task.sleep(for: .seconds(60)) }
            catch { return }
        }
    }

    func heartbeat() {
        clock = now() // Publish expiry even if the app remains open for days.
        guard !storageFailed, !isBusy else { return }
        let seen = record.lastObservedAt ?? .distantPast
        guard now() > seen, now().timeIntervalSince(seen) >= 60 else { return }
        var next = record
        next.lastObservedAt = now()
        do { try persist(next) }
        catch { message = LicenseFailure.storage.localizedDescription }
    }

    func openPortal() { open(configuration.portalURL) }
    func openCheckout() { open(configuration.checkoutURL) }
    func startCheckout() { openCheckout() }

    private func open(_ url: URL?) {
        guard let url, url.scheme == "https", url.host != nil else {
            message = "Este link ainda não foi configurado nesta versão."
            return
        }
        if !NSWorkspace.shared.open(url) { message = "Não foi possível abrir o navegador." }
    }

    private func reloadStorage() {
        do {
            record = try storage.load() ?? LicenseRecord()
            storageFailed = false
        } catch {
            storageFailed = true
            message = LicenseFailure.storage.localizedDescription
        }
    }

    private func persist(_ next: LicenseRecord) throws {
        do { try storage.save(next) }
        catch { storageFailed = true; throw LicenseFailure.storage }
        record = next
        storageFailed = false
    }

    private func userMessage(_ error: Error) -> String {
        // Never surface raw network responses, URLs, keys or credentials in UI/logs.
        (error as? LicenseFailure)?.localizedDescription ?? LicenseFailure.unavailable.localizedDescription
    }
}
