import XCTest
import UIKit
@testable import Numi

final class OnboardingTests: XCTestCase {
    @MainActor func testOfflineSaveIsVisibleAndDurableWithoutWaitingForServer() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "numi-offline-save-" + UUID().uuidString)
        defer { try? vault.clear(); try? FileManager.default.removeItem(at: root) }
        try vault.write(SavedSession(user: NumiUser(id: "offline", email: "new@example.invalid"), cookies: []))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OfflineProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        let disk = LibraryDisk(root: root)
        var library = LibrarySnapshot(); library.cursor = "existing-cursor"
        try await disk.save(library, account: "offline")
        let model = NumiModel(api: api, disk: disk)
        await model.bootstrap()
        let pending = PendingCoin(id: "offline-first-coin", input: CreateCoinInput(userLabel: "My coin"),
            coin: Coin(id: "offline-first-coin", version: 0, userLabel: "My coin", status: "active"), photoKeys: [])
        try await model.enqueue(pending)
        XCTAssertEqual(model.coins.count, 1)
        try await model.enqueue(pending)
        XCTAssertEqual(model.pendingCoins.count, 1)
        let reopened = try await LibraryDisk(root: root).loadPending(account: "offline")
        XCTAssertEqual(reopened.first?.id, "offline-first-coin")
        XCTAssertEqual(reopened.first?.input.userLabel, "My coin")
        await model.signOut()
        XCTAssertTrue(model.coins.isEmpty)
    }
    func testAccountValidationAndErrorMessages() throws {
        try validateAccount(email: " new@example.invalid ", password: "long-password", confirmation: "long-password", action: .register)
        XCTAssertThrowsError(try validateAccount(email: "missing", password: "long-password", confirmation: "long-password", action: .register))
        XCTAssertThrowsError(try validateAccount(email: "new@example.invalid", password: "short", confirmation: "short", action: .register))
        XCTAssertThrowsError(try validateAccount(email: "new@example.invalid", password: "long-password", confirmation: "different", action: .reset))
        XCTAssertThrowsError(try validateAccount(email: "new@example.invalid", password: String(repeating: "a", count: 129), confirmation: "", action: .register))
        XCTAssertNotNil(apiErrorMessage("email_taken"))
        XCTAssertNotNil(apiErrorMessage("invalid_reset_code"))
        XCTAssertNil(apiErrorMessage("not_a_known_error"))
    }
    func testMultipartContainsBothImagesOnce() throws {
        let multipart = try CoinMultipart(images: [Data("photo-one".utf8), Data("photo-two".utf8)], boundary: "test-boundary")
        let text = String(decoding: multipart.body, as: UTF8.self)
        XCTAssertTrue(multipart.contentType.contains("test-boundary"))
        XCTAssertEqual(text.components(separatedBy: "name=\"images\"").count - 1, 2)
        XCTAssertEqual(text.components(separatedBy: "photo-one").count - 1, 1)
        XCTAssertTrue(text.hasSuffix("--test-boundary--\r\n"))
        XCTAssertThrowsError(try CoinMultipart(images: []))
    }
    func testRegistrationResetAndCookiePersistence() async throws {
        let vault = SessionVault(service: "numi-auth-tests-" + UUID().uuidString)
        defer { try? vault.clear() }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OnboardingFixtureProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        let user = try await api.register(email: "new@example.invalid", password: "test-password")
        XCTAssertEqual(user.id, "onboarding-user")
        XCTAssertEqual(try vault.read()?.cookies.count, 2)
        try await api.requestPasswordReset(email: "new@example.invalid")
        do {
            _ = try await api.resetPassword(email: "new@example.invalid", code: "WRONG", password: "test-password")
            XCTFail("Wrong code must fail")
        } catch { XCTAssertEqual(error.localizedDescription, apiErrorMessage("invalid_reset_code")) }
        let reset = try await api.resetPassword(email: "new@example.invalid", code: "TEST-CODE-1234", password: "new-password")
        XCTAssertEqual(reset.id, user.id)
        let restored = try await NumiAPI(session: URLSession(configuration: config), vault: vault).restore()
        XCTAssertEqual(restored, reset)
    }
    @MainActor func testCandidateEvidenceUsesServerContractAndNeverInventsGrade() throws {
        let draft = AddCoinModel(model: NumiModel())
        let fields = IdentifiedFields(year: 1990, metal: "silver")
        let candidates = [IdentificationCandidate(id: 11, name: "First", year: 1990, issueId: 99, issueYear: 1990), IdentificationCandidate(id: 12, name: "Second", year: 1990)]
        draft.recognition = IdentificationResult(identificationSessionId: "session", requestId: "request", catalogMatch: "ambiguous", extracted: fields, candidates: candidates)
        draft.choose(candidates[0])
        let first = try draft.makePending()
        XCTAssertNil(first.input.gradeCode)
        XCTAssertEqual(first.input.identificationEvidence?.decision, "accepted_top")
        XCTAssertEqual(first.input.issueId, 99)
        draft.year = "1991"
        XCTAssertNil(try draft.makePending().input.issueId)
        draft.choose(candidates[1])
        XCTAssertEqual(try draft.makePending().input.identificationEvidence?.decision, "selected_alternative")
        draft.choose(CatalogChoice(id: 20, name: "Manual match"))
        XCTAssertNil(try draft.makePending().input.identificationEvidence)
        draft.selected = nil; draft.label = "My coin"
        XCTAssertNil(try draft.makePending().input.typeId)
        XCTAssertNil(try draft.makePending().input.identificationEvidence)
    }
    func testPendingCoinSurvivesRestartWithImmutableRequestAndPhotos() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = LibraryDisk(root: root)
        let pending = PendingCoin(id: "stable-idempotency-key", input: CreateCoinInput(typeId: 42),
            coin: Coin(id: "local", version: 0, userLabel: "My coin", status: "active"), sessionID: "previous-upload", photoKeys: ["photo-one"])
        try await disk.savePending([pending], account: "first")
        let reopened = try await LibraryDisk(root: root).loadPending(account: "first")
        XCTAssertEqual(reopened.first?.id, pending.id)
        XCTAssertEqual(reopened.first?.sessionID, "previous-upload")
        XCTAssertEqual(reopened.first?.photoKeys, ["photo-one"])
        let another = try await disk.loadPending(account: "second")
        XCTAssertTrue(another.isEmpty)
    }
    func testUnfinishedCoinDraftSurvivesRestartAndStaysInItsAccount() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = LibraryDisk(root: root)
        let draft = AddCoinDraft(id: "stable-draft", photoKeys: ["front", "back"],
            selected: nil, candidate: nil, recognition: nil, label: "Leopard", year: "2022",
            country: "Сомали", denominationValue: "100", denominationUnit: "шиллингов",
            subject: "Леопард", metal: "Серебро", fineness: "999", mass: "31.1",
            massUnit: "g", finish: "PF", grade: "", notes: "Моя монета")
        try await disk.saveAddDraft(draft, account: "owner")
        let reopened = try await LibraryDisk(root: root).loadAddDraft(account: "owner")
        XCTAssertEqual(reopened?.id, "stable-draft")
        XCTAssertEqual(reopened?.photoKeys, ["front", "back"])
        XCTAssertEqual(reopened?.metal, "Серебро")
        XCTAssertEqual(reopened?.mass, "31.1")
        let other = try await disk.loadAddDraft(account: "other")
        XCTAssertNil(other)
        try await disk.clearAddDraft(account: "owner")
        let removed = try await disk.loadAddDraft(account: "owner")
        XCTAssertNil(removed)
    }
    func testCreateSendsCSRFAndStableIdempotencyKey() async throws {
        let vault = SessionVault(service: "numi-create-tests-" + UUID().uuidString)
        defer { try? vault.clear() }
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OnboardingFixtureProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        _ = try await api.register(email: "new@example.invalid", password: "test-password")
        let pending = PendingCoin(id: "stable-idempotency-key", input: CreateCoinInput(typeId: 42),
            coin: Coin(id: "local", version: 0, status: "active"), photoKeys: [])
        let first = try await api.create(pending)
        let retry = try await api.create(pending)
        XCTAssertEqual(first.id, retry.id)
        let choices = try await api.searchCatalog("Камчатская экспедиция")
        XCTAssertEqual(choices.first?.mintage, 1000)
    }
    func testManualMetalFloorRecalculationResponse() async throws {
        let vault = SessionVault(service: "numi-floor-tests-" + UUID().uuidString)
        defer { try? vault.clear() }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OnboardingFixtureProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        _ = try await api.register(email: "new@example.invalid", password: "test-password")
        let valuation = try await api.recalculate(itemID: "unlinked-coin")
        XCTAssertTrue(valuation.isFloor)
        XCTAssertEqual(valuation.amount, 125000)
    }
    func testGuidedSearchReturnsCatalogIdentity() async throws {
        let vault = SessionVault(service: "numi-search-tests-" + UUID().uuidString)
        defer { try? vault.clear() }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [OnboardingFixtureProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        _ = try await api.register(email: "new@example.invalid", password: "test-password")
        let page = try await api.searchSpecimens(query: "Камчатская экспедиция", country: "Россия",
            year: "2004", denomination: "25 рублей", metal: "silver")
        XCTAssertEqual(page.total, 1)
        XCTAssertEqual(page.items.first?.key, "type:42")
        XCTAssertEqual(page.items.first?.typeId, 42)
    }
}
final class OfflineProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() { }
}
