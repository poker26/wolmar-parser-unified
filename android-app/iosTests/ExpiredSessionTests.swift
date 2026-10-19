import XCTest
import UIKit
@testable import Numi

final class ExpiredSessionTests: XCTestCase {
    @MainActor func testExpiryAndSameAccountLoginKeepPendingCoinDraftAndPhotos() async throws {
        let env = try await environment()
        defer { env.cleanup() }
        let draft = AddCoinModel(model: env.model)
        await draft.restore(); draft.label = "Моя монета"
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }.jpegData(compressionQuality: 1)!
        try await env.disk.storeOriginal(photo, account: "owner", key: "original:pending-photo")
        _ = await draft.keepDraft()
        do { _ = try await env.api.market(itemID: "coin"); XCTFail("Expected 401") }
        catch { XCTAssertTrue(error is NumiError) }
        await waitForLogin(env.model)
        XCTAssertEqual(env.model.user?.id, "owner")
        XCTAssertEqual(env.model.pendingCoins.first?.id, "pending")
        env.model.needsLogin = false
        XCTAssertEqual(draft.label, "Моя монета")
        await env.model.signIn(email: "owner@example.invalid", password: "test-password")
        XCTAssertNil(env.model.error); XCTAssertFalse(env.model.needsLogin)
        XCTAssertEqual(draft.label, "Моя монета")
        XCTAssertEqual(env.model.pendingCoins.first?.photoKeys, ["pending-photo"])
        let savedDraft = try await env.disk.loadAddDraft(account: "owner")
        XCTAssertEqual(savedDraft?.label, "Моя монета")
        let original = await env.disk.image(account: "owner", key: "original:pending-photo")
        XCTAssertEqual(original, photo)
        let page = try await env.api.sync(cursor: "initial")
        XCTAssertEqual(page.nextCursor, "fresh")
    }

    @MainActor func testFailedLoginKeepsOwnerAndExpiredMarker() async throws {
        let env = try await environment(); defer { env.cleanup() }
        _ = try? await env.api.market(itemID: "coin"); await waitForLogin(env.model)
        await env.model.signIn(email: "owner@example.invalid", password: "bad")
        XCTAssertNotNil(env.model.error); XCTAssertTrue(env.model.needsLogin)
        XCTAssertEqual(env.model.user?.id, "owner")
        XCTAssertEqual(env.model.pendingCoins.first?.id, "pending")
        let required = await env.api.requiresAuthentication(account: "owner")
        XCTAssertTrue(required)
        XCTAssertEqual(try env.vault.read()?.user.id, "owner")
    }

    @MainActor func testOtherAccountDoesNotReceiveOwnersPendingCoin() async throws {
        let env = try await environment(); defer { env.cleanup() }
        _ = try? await env.api.market(itemID: "coin"); await waitForLogin(env.model)
        await env.model.signIn(email: "other@example.invalid", password: "test-password")
        XCTAssertEqual(env.model.user?.id, "other")
        XCTAssertTrue(env.model.pendingCoins.isEmpty); XCTAssertTrue(env.model.coins.isEmpty)
        let preserved = try await env.disk.loadPending(account: "owner")
        XCTAssertEqual(preserved.first?.photoKeys, ["pending-photo"])
    }

    @MainActor func testExpiryIsDurableAndPublicCatalogRemainsAvailable() async throws {
        let env = try await environment(); defer { env.cleanup() }
        _ = try? await env.api.market(itemID: "coin")
        let reopened = NumiAPI(session: env.session, vault: env.vault)
        let owner = try await reopened.restore()
        XCTAssertEqual(owner?.id, "owner")
        let required = await reopened.requiresAuthentication(account: "owner")
        XCTAssertTrue(required)
        let countries = try await reopened.catalogCountries()
        XCTAssertEqual(countries.first?.name, "Россия")
        let before = ExpiryProtocol.count
        _ = try? await reopened.market(itemID: "coin")
        XCTAssertEqual(ExpiryProtocol.count, before)
    }

    @MainActor func testDelete401AlsoRequestsLogin() async throws {
        let env = try await environment(); defer { env.cleanup() }
        do { try await env.api.delete("coin", version: 1); XCTFail("Expected 401") }
        catch NumiError.sessionExpired { }
        await waitForLogin(env.model)
        XCTAssertEqual(env.model.coins.count, 2)
    }

    @MainActor func testLate401DoesNotExpireNewSession() async throws {
        let env = try await environment(); defer { env.cleanup() }
        let started = expectation(description: "old request started")
        ExpiryProtocol.holdNext(started)
        let old = Task { try await env.api.market(itemID: "coin") }
        await fulfillment(of: [started], timeout: 3)
        await env.model.signIn(email: "owner@example.invalid", password: "test-password")
        ExpiryProtocol.release()
        do { _ = try await old.value; XCTFail("Expected stale cancellation") }
        catch is CancellationError { }
        let required = await env.api.requiresAuthentication(account: "owner")
        XCTAssertFalse(required); XCTAssertFalse(env.model.needsLogin)
    }

    @MainActor private func waitForLogin(_ model: NumiModel) async {
        for _ in 0..<100 where !model.needsLogin { try? await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertTrue(model.needsLogin)
    }
    private struct Environment {
        let model: NumiModel; let api: NumiAPI; let disk: LibraryDisk
        let vault: SessionVault; let root: URL; let session: URLSession
        func cleanup() { session.invalidateAndCancel(); try? vault.clear(); try? FileManager.default.removeItem(at: root) }
    }
    @MainActor private func environment() async throws -> Environment {
        ExpiryProtocol.reset()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "expiry-tests-" + UUID().uuidString)
        try vault.write(SavedSession(user: NumiUser(id: "owner", email: "owner@example.invalid"),
            cookies: [SavedCookie(name: "__Host-wolmar_session", value: "expired", expires: nil)]))
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ExpiryProtocol.self]
        configuration.httpShouldSetCookies = false; configuration.httpCookieStorage = nil
        let session = URLSession(configuration: configuration)
        let api = NumiAPI(session: session, vault: vault); let disk = LibraryDisk(root: root)
        var library = LibrarySnapshot(); library.cursor = "initial"
        library.items["coin"] = Coin(id: "coin", version: 1, userLabel: "Existing", status: "active")
        try await disk.save(library, account: "owner")
        try await disk.savePending([PendingCoin(id: "pending", input: CreateCoinInput(userLabel: "Pending"),
            coin: Coin(id: "pending", version: 0, userLabel: "Pending", status: "active"), photoKeys: ["pending-photo"])], account: "owner")
        let model = NumiModel(api: api, disk: disk, telemetryEnabled: false)
        model.setCaptureActive(true); await model.bootstrap()
        return Environment(model: model, api: api, disk: disk, vault: vault, root: root, session: session)
    }
}

private final class ExpiryProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var requests = 0
    private static var started: XCTestExpectation?
    private static var waiting: ExpiryProtocol?
    static var count: Int { lock.lock(); defer { lock.unlock() }; return requests }
    static func reset() { lock.lock(); defer { lock.unlock() }; requests = 0; started = nil; waiting = nil }
    static func holdNext(_ expectation: XCTestExpectation) { lock.lock(); defer { lock.unlock() }; started = expectation }
    static func release() { lock.lock(); let pending = waiting; waiting = nil; lock.unlock(); pending?.respond(401, #"{"error":{"code":"authentication_required"}}"#) }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.requests += 1
        let held = Self.started; Self.started = nil
        if held != nil { Self.waiting = self }
        Self.lock.unlock()
        if let held { held.fulfill(); return }
        let path = request.url!.path
        if path.contains("/auth/login") {
            let fields = OnboardingFixtureProtocol.fields(request)
            if fields["password"] as? String == "bad" { respond(401, #"{"error":{"code":"invalid_credentials"}}"#); return }
            let other = fields["email"] as? String == "other@example.invalid"
            respond(200, "{\"user\":{\"id\":\"\(other ? "other" : "owner")\",\"email\":\"\(other ? "other" : "owner")@example.invalid\"}}",
                cookie: "__Host-wolmar_session=fresh; Path=/; Secure; HttpOnly")
        } else if path.contains("/catalog/") {
            respond(200, #"{"countries":[{"value":"russia","name":"Россия","count":1}]}"#)
        } else if request.value(forHTTPHeaderField: "Cookie")?.contains("=fresh") == true {
            respond(200, #"{"changes":[],"nextCursor":"fresh","hasMore":false}"#)
        } else { respond(401, #"{"error":{"code":"authentication_required"}}"#) }
    }
    private func respond(_ status: Int, _ body: String, cookie: String? = nil) {
        var headers = ["Content-Type": "application/json"]
        if let cookie { headers["Set-Cookie"] = cookie }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
