import Foundation

enum LicensedFeature {
    case generateBatch, research, post, useAI, openExisting, exportExisting

    var needsSubscription: Bool {
        switch self {
        case .openExisting, .exportExisting: false
        default: true
        }
    }
}

/// The rest of the app depends on this contract, never on Lemon Squeezy response types.
protocol LicenseProvider {
    func activate(key: String, instanceName: String) async throws -> LicenseEntitlement
    func validate(key: String, instanceID: String) async throws -> LicenseEntitlement
    func deactivate(key: String, instanceID: String) async throws
}

struct LicenseEntitlement: Codable, Equatable {
    var instanceID: String
    var email: String
    var plan: String
    var expiresAt: Date?
    // The public License API does not expose subscription.renews_at.
    var renewsAt: Date? = nil
    var activationUsage: Int
}

struct LicenseCredentials: Codable {
    var key: String
    var entitlement: LicenseEntitlement
    var validatedAt: Date
    var rejected = false
}

/// All of this record, including the trial, lives exclusively in Keychain.
struct LicenseRecord: Codable {
    var trialStartedAt: Date?
    var lastObservedAt: Date?
    var credentials: LicenseCredentials?
}

enum LicenseAccess: Equatable {
    case notStarted
    case trial(until: Date)
    case active
    case offline(until: Date)
    case locked(String)

    var isAllowed: Bool {
        switch self {
        case .trial, .active, .offline: true
        default: false
        }
    }
}

enum LicensePolicy {
    static let day: TimeInterval = 86_400
    static let trialDuration = 7 * day
    static let offlineDuration = 7 * day
    static let validationInterval = day

    static func access(record: LicenseRecord, now: Date, offline: Bool) -> LicenseAccess {
        if let seen = record.lastObservedAt, now < seen.addingTimeInterval(-300) {
            return .locked("Confira a data e a hora deste Mac para continuar.")
        }
        if let credentials = record.credentials {
            guard !credentials.rejected else { return .locked("A licença não está ativa neste Mac.") }
            if let expires = credentials.entitlement.expiresAt, now >= expires {
                return .locked("Sua licença venceu. Confira a assinatura no portal.")
            }
            let deadline = credentials.validatedAt.addingTimeInterval(offlineDuration)
            guard now < deadline else { return .locked("Conecte este Mac à internet para validar a licença.") }
            return offline ? .offline(until: deadline) : .active
        }
        if let started = record.trialStartedAt {
            let end = started.addingTimeInterval(trialDuration)
            return now < end ? .trial(until: end) : .locked("Seus 7 dias de teste terminaram.")
        }
        return .notStarted
    }
}

enum LicenseFailure: LocalizedError, Equatable {
    case configuration, unavailable, invalidResponse, rejected, wrongProduct, activationLimit, storage

    var errorDescription: String? {
        switch self {
        case .configuration: "A ativação de assinaturas ainda não foi configurada nesta versão."
        case .unavailable: "Não foi possível conectar ao serviço de licenças. Tente novamente com internet."
        case .invalidResponse: "O serviço de licenças enviou uma resposta inesperada. Tente novamente."
        case .rejected: "A chave ou a ativação não está válida. Confira a chave e a assinatura."
        case .wrongProduct: "Esta chave não pertence ao The Carousel Maker desta versão."
        case .activationLimit: "A assinatura permite 2 Macs. Desative a licença em outro Mac para liberar uma vaga."
        case .storage: "Não foi possível acessar a licença no Chaves do macOS. Desbloqueie o Chaves e tente novamente."
        }
    }
}
