import Foundation
import Security
import XCTest
@testable import BulkMaker

final class LicenseTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_800_000_000)
    private var configuration: LicenseConfiguration {
        .init(environment: "test", storeID: 10, productID: 20, variantIDs: [30])
    }
    private func entitlement(expires: Date? = nil) -> LicenseEntitlement {
        .init(instanceID: "this-mac", email: "test@example.invalid", plan: "Mensal",
              expiresAt: expires, activationUsage: 1)
    }

    func testTrialAndOfflineWindowsEndAtExactlySevenDays() {
        let trial = LicenseRecord(trialStartedAt: start, lastObservedAt: start)
        XCTAssertTrue(LicensePolicy.access(record: trial, now: start.addingTimeInterval(604_799), offline: false).isAllowed)
        XCTAssertFalse(LicensePolicy.access(record: trial, now: start.addingTimeInterval(604_800), offline: false).isAllowed)
        let paid = LicenseRecord(credentials: .init(key: "dummy", entitlement: entitlement(), validatedAt: start))
        XCTAssertEqual(LicensePolicy.access(record: paid, now: start, offline: true), .offline(until: start.addingTimeInterval(604_800)))
        XCTAssertFalse(LicensePolicy.access(record: paid, now: start.addingTimeInterval(604_800), offline: true).isAllowed)
    }

    func testExplicitRejectionAndKnownExpiryOverrideOfflineGraceAndTrial() {
        let credentials = LicenseCredentials(key: "dummy", entitlement: entitlement(expires: start), validatedAt: start)
        var record = LicenseRecord(trialStartedAt: start, credentials: credentials)
        XCTAssertFalse(LicensePolicy.access(record: record, now: start, offline: true).isAllowed)
        record.credentials?.entitlement.expiresAt = nil
        record.credentials?.rejected = true
        XCTAssertFalse(LicensePolicy.access(record: record, now: start, offline: true).isAllowed)
    }

    func testRollingClockBackDoesNotExtendTrial() {
        let record = LicenseRecord(trialStartedAt: start, lastObservedAt: start.addingTimeInterval(3_600))
        XCTAssertFalse(LicensePolicy.access(record: record, now: start, offline: false).isAllowed)
    }

    @MainActor func testTrialSurvivesRelaunchAndCannotRestart() async {
        let storage = MemoryLicenseStorage()
        let provider = FakeLicenseProvider(entitlement: entitlement())
        let time = TestLicenseClock(start)
        let license = License(provider: provider, storage: storage, configuration: configuration, now: { time.date })
        license.startTrial()
        XCTAssertTrue(license.canUse(.generateBatch))
        time.date = start.addingTimeInterval(604_800)
        license.heartbeat()
        license.startTrial()
        let reopened = License(provider: provider, storage: storage, configuration: configuration, now: { time.date })
        XCTAssertFalse(reopened.canUse(.research))
        XCTAssertFalse(reopened.canStartTrial)
        XCTAssertTrue(reopened.canUse(.openExisting))
        XCTAssertTrue(reopened.canUse(.exportExisting))
        XCTAssertEqual(storage.record?.trialStartedAt, start)
    }

    @MainActor func testNetworkFailureDoesNotMoveLastGoodValidation() async {
        let storage = MemoryLicenseStorage()
        let provider = FakeLicenseProvider(entitlement: entitlement())
        let time = TestLicenseClock(start)
        let license = License(provider: provider, storage: storage, configuration: configuration, now: { time.date })
        await license.activate(key: "dummy")
        provider.failure = .unavailable
        time.date = start.addingTimeInterval(6 * 86_400)
        await license.revalidate()
        XCTAssertTrue(license.canUse(.post))
        XCTAssertTrue(license.isOffline)
        XCTAssertEqual(storage.record?.credentials?.validatedAt, start)
        time.date = start.addingTimeInterval(7 * 86_400)
        XCTAssertFalse(license.canUse(.post))
        XCTAssertTrue(license.canUse(.exportExisting))
    }

    @MainActor func testRevocationPersistsAcrossOfflineRelaunchAndCanRecover() async {
        let storage = MemoryLicenseStorage()
        let provider = FakeLicenseProvider(entitlement: entitlement())
        let license = License(provider: provider, storage: storage, configuration: configuration, now: { self.start })
        await license.activate(key: "dummy")
        provider.failure = .rejected
        await license.revalidate()
        provider.failure = .unavailable
        let reopened = License(provider: provider, storage: storage, configuration: configuration, now: { self.start })
        await reopened.revalidate()
        XCTAssertFalse(reopened.canUse(.generateBatch))
        provider.failure = nil
        await reopened.revalidate()
        XCTAssertTrue(reopened.canUse(.generateBatch))
    }

    @MainActor func testDuplicateActivationOnlyValidatesAndDeactivationKeepsTrialHistory() async {
        let storage = MemoryLicenseStorage()
        let provider = FakeLicenseProvider(entitlement: entitlement())
        let license = License(provider: provider, storage: storage, configuration: configuration, now: { self.start })
        license.startTrial()
        await license.activate(key: " dummy ")
        await license.activate(key: "dummy")
        XCTAssertEqual(provider.activations, 1)
        XCTAssertEqual(provider.validations, 1)
        await license.activate(key: "other-key")
        XCTAssertEqual(provider.activations, 1)
        provider.failure = .unavailable
        await license.deactivate()
        XCTAssertTrue(license.hasActivation)
        provider.failure = nil
        await license.deactivate()
        XCTAssertFalse(license.hasActivation)
        XCTAssertFalse(license.canStartTrial)
        XCTAssertEqual(storage.record?.trialStartedAt, start)
    }

    @MainActor func testLockedOrCorruptKeychainNeverStartsFreshTrial() async {
        let storage = MemoryLicenseStorage()
        storage.fails = true
        let license = License(provider: FakeLicenseProvider(entitlement: entitlement()), storage: storage,
                              configuration: configuration, now: { self.start })
        license.startTrial()
        XCTAssertFalse(license.canUse(.generateBatch))
        XCTAssertFalse(license.canStartTrial)
        XCTAssertTrue(license.canUse(.exportExisting))
        storage.fails = false
        await license.retryStorage()
        XCTAssertTrue(license.canStartTrial)
    }

    @MainActor func testFailedActivationSaveReleasesRemoteSlot() async {
        let storage = MemoryLicenseStorage()
        let provider = FakeLicenseProvider(entitlement: entitlement())
        let license = License(provider: provider, storage: storage, configuration: configuration, now: { self.start })
        storage.fails = true
        await license.activate(key: "dummy")
        XCTAssertEqual(provider.deactivations, 1)
        XCTAssertFalse(license.canUse(.generateBatch))
        XCTAssertNil(storage.record?.credentials)
    }

    func testDataProtectionKeychainUsesStableAccessGroupAndNeverLegacyKeychain() {
        let store = LicenseKeychain(service: "test")
        XCTAssertEqual(store.query[kSecUseDataProtectionKeychain as String] as? Bool, true)
        XCTAssertEqual(store.query[kSecAttrAccessGroup as String] as? String, "4ZQ8PBTL5U.com.andrefelipe.carouselmaker")
        XCTAssertEqual(store.query[kSecAttrSynchronizable as String] as? Bool, false)
    }

    func testDevelopmentStorageSurvivesRebuildWithPrivatePermissions() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("license.json")
        let store = DevelopmentLicenseStorage(url: url)
        XCTAssertNil(try store.load())
        try store.save(.init(trialStartedAt: start))
        XCTAssertEqual(try DevelopmentLicenseStorage(url: url).load()?.trialStartedAt, start)
        try store.save(.init(trialStartedAt: start, credentials: .init(key: "dummy", entitlement: entitlement(), validatedAt: start)))
        XCTAssertEqual(try store.load()?.credentials?.key, "dummy")
        XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int, 0o600)
        XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as? Int, 0o700)
    }

    func testKeychainRoundTripUsesSeparateDeviceOnlyItem() throws {
        let service = "com.andrefelipe.carouselmaker.tests.\(UUID().uuidString)"
        let store = LicenseKeychain(service: service)
        // A bare swift-test executable does not have the distribution host's access-group entitlement.
        var probe: CFTypeRef?
        let probeStatus = SecItemCopyMatching(store.query as CFDictionary, &probe)
        if probeStatus == errSecMissingEntitlement || probeStatus == errSecNotAvailable {
            throw XCTSkip("Data Protection Keychain integration requires the signed app host.")
        }
        defer {
            SecItemDelete(store.query as CFDictionary)
        }
        XCTAssertNil(try store.load())
        var record = LicenseRecord(trialStartedAt: start)
        try store.save(record)
        XCTAssertEqual(try store.load()?.trialStartedAt, start)
        record.credentials = .init(key: "test-key", entitlement: entitlement(), validatedAt: start)
        try store.save(record)
        XCTAssertEqual(try store.load()?.credentials?.key, "test-key")
        XCTAssertEqual(try store.load()?.credentials?.entitlement.instanceID, "this-mac")
    }
}

private final class MemoryLicenseStorage: LicenseStorage {
    var record: LicenseRecord?
    var fails = false
    func load() throws -> LicenseRecord? {
        if fails { throw LicenseFailure.storage }
        return record
    }
    func save(_ record: LicenseRecord) throws {
        if fails { throw LicenseFailure.storage }
        self.record = record
    }
}

private final class TestLicenseClock {
    var date: Date
    init(_ date: Date) { self.date = date }
}

private final class FakeLicenseProvider: LicenseProvider {
    let entitlement: LicenseEntitlement
    var failure: LicenseFailure?
    var activations = 0
    var validations = 0
    var deactivations = 0
    init(entitlement: LicenseEntitlement) { self.entitlement = entitlement }
    func activate(key: String, instanceName: String) async throws -> LicenseEntitlement {
        activations += 1
        if let failure { throw failure }
        return entitlement
    }
    func validate(key: String, instanceID: String) async throws -> LicenseEntitlement {
        validations += 1
        if let failure { throw failure }
        return entitlement
    }
    func deactivate(key: String, instanceID: String) async throws {
        deactivations += 1
        if let failure { throw failure }
    }
}
