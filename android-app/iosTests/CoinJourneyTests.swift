import XCTest
import UIKit
@testable import Numi

final class CoinJourneyTests: XCTestCase {
    func testMarketEntryRequiresUsefulData() throws {
        var coin = Coin(id: "coin", version: 1, status: "active")
        XCTAssertFalse(coin.hasMarketEntry(nil))
        coin.valuation = CoinValuation(id: "floor", valueFloorMinor: 125000, status: "floor_only")
        XCTAssertTrue(coin.hasMarketEntry(nil))
        coin.valuation = nil; coin.typeId = 42
        XCTAssertTrue(coin.hasMarketEntry(nil))
        coin.typeId = nil
        let market = MarketEvidence(activity: MarketActivity(activeOffersCount: 1), gradeBuckets: [], events: [])
        XCTAssertTrue(coin.hasMarketEntry(market))
    }
    func testUnlinkPayloadExplicitlyClearsCatalogIdentity() throws {
        let input = LinkCatalogInput(typeId: nil, issueId: nil, identifiedYear: 2022,
            properties: CoinProperties(values: ["metal": "silver"]), userLabel: "Leopard")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        XCTAssertTrue(json["typeId"] is NSNull); XCTAssertTrue(json["issueId"] is NSNull)
        XCTAssertEqual(json["userLabel"] as? String, "Leopard")
    }
    @MainActor func testBackWithoutAcceptingCandidateSavesUnlinkedCoinAndPhotos() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }.jpegData(compressionQuality: 1)!
        await draft.addImages([image, image])
        let candidate = IdentificationCandidate(id: 42, name: "Coin", year: 2022)
        draft.recognition = IdentificationResult(recognizedName: "Leopard", catalogMatch: "ambiguous",
            extracted: IdentifiedFields(year: 2022), candidates: [candidate])
        draft.choose(candidate)
        let saved = await draft.saveWithoutMatch()
        XCTAssertTrue(saved)
        let pending = try XCTUnwrap(env.model.pendingCoins.first)
        XCTAssertNil(pending.input.typeId); XCTAssertEqual(pending.input.userLabel, "Leopard")
        XCTAssertEqual(pending.photoKeys.count, 2)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.photoKeys, pending.photoKeys)
        for key in pending.photoKeys {
            let photo = await env.disk.previewImage(account: "journey", key: key)
            XCTAssertNotNil(photo)
        }
        await env.model.signOut()
    }
    @MainActor func testConfirmPersistsSelectedCatalogAndSnapshotWithoutSecondSave() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        draft.choose(CatalogChoice(id: 42, name: "Coin", year: 2022, country: "Somalia",
            metal: "silver", denomination: "100 shillings", mass: "31.1", subject: "Leopard"))
        let saved = await draft.save()
        XCTAssertTrue(saved)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.input.typeId, 42)
        XCTAssertEqual(reopened.first?.coin.catalog?.mass, "31.1")
        XCTAssertEqual(reopened.first?.coin.properties?.values["subject"], "Leopard")
        await env.model.signOut()
    }
    @MainActor func testSourceChoiceSavesPropertiesWithoutInventedCatalogType() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        let choice = try JSONDecoder().decode(SpecimenChoice.self, from: Data(#"{"key":"source:123","kind":"source","id":"123","name":"Leopard","country":"Somalia","year":2022,"metal":"silver","mass":"31.1","denomination":"100 shillings"}"#.utf8))
        draft.choose(choice)
        let saved = await draft.save(); XCTAssertTrue(saved)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertNil(reopened.first?.input.typeId)
        XCTAssertEqual(reopened.first?.input.userLabel, "Leopard")
        XCTAssertEqual(reopened.first?.coin.properties?.values["mass"], "31.1")
        await env.model.signOut()
    }
    @MainActor func testFailedConfirmationKeepsSelectionForRetry() async throws {
        let draft = AddCoinModel(model: NumiModel(telemetryEnabled: false))
        draft.choose(CatalogChoice(id: 42, name: "Coin"))
        let saved = await draft.save()
        XCTAssertFalse(saved); XCTAssertEqual(draft.selected?.id, 42)
        XCTAssertNotNil(draft.error)
    }
    @MainActor func testDeletionRejectsAlreadyInFlightSyncSnapshot() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let started = expectation(description: "sync requested")
        JourneyProtocol.holdNextSync(started: started)
        let sync = Task { await env.model.sync(includePhotos: false) }
        await fulfillment(of: [started], timeout: 5)
        try await env.model.deleteCoin("coin")
        XCTAssertFalse(env.model.coins.contains(where: { $0.id == "coin" }))
        JourneyProtocol.releaseSync()
        await sync.value
        XCTAssertFalse(env.model.coins.contains(where: { $0.id == "coin" }), "Late sync restored deleted coin")
        let reopened = try await env.disk.load(account: "journey")
        XCTAssertNil(reopened.items["coin"])
        await env.model.signOut()
    }
    @MainActor func testFailedDeletionKeepsCoin() async throws {
        let env = try await environment(failDelete: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        do { try await env.model.deleteCoin("coin"); XCTFail("Expected deletion error") } catch { }
        XCTAssertTrue(env.model.coins.contains(where: { $0.id == "coin" }))
        let reopened = try await env.disk.load(account: "journey")
        XCTAssertNotNil(reopened.items["coin"])
        await env.model.signOut()
    }
    private struct Environment {
        let model: NumiModel; let disk: LibraryDisk; let vault: SessionVault; let root: URL
    }
    @MainActor private func environment(failDelete: Bool = false) async throws -> Environment {
        JourneyProtocol.reset(failDelete: failDelete)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "journey-" + UUID().uuidString)
        try vault.write(SavedSession(user: NumiUser(id: "journey", email: "test@example.invalid"), cookies: []))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [JourneyProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        let disk = LibraryDisk(root: root)
        var library = LibrarySnapshot(); library.cursor = "initial"
        library.items["coin"] = Coin(id: "coin", version: 1, userLabel: "Existing", status: "active")
        try await disk.save(library, account: "journey")
        let model = NumiModel(api: api, disk: disk, telemetryEnabled: false); await model.bootstrap()
        return Environment(model: model, disk: disk, vault: vault, root: root)
    }
}

private final class JourneyProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var syncExpectation: XCTestExpectation?
    private static var waiting: JourneyProtocol?
    private static var failDelete = false
    static func reset(failDelete: Bool) {
        lock.lock(); defer { lock.unlock() }; syncExpectation = nil; waiting = nil; self.failDelete = failDelete
    }
    static func holdNextSync(started: XCTestExpectation) { lock.lock(); defer { lock.unlock() }; syncExpectation = started }
    static func releaseSync() {
        lock.lock(); let pending = waiting; waiting = nil; lock.unlock()
        pending?.respond(200, #"{"changes":[{"seq":"1","entityKind":"item","entityId":"coin","itemId":"coin","operation":"upsert","item":{"id":"coin","version":1,"userLabel":"Stale","status":"active"}}],"nextCursor":"late","hasMore":false}"#)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        if path.hasSuffix("/sync") {
            Self.lock.lock()
            let started = Self.syncExpectation; Self.syncExpectation = nil
            if started != nil { Self.waiting = self }
            Self.lock.unlock()
            if let started { started.fulfill(); return }
            respond(200, #"{"changes":[],"nextCursor":"unchanged","hasMore":false}"#)
        } else if request.httpMethod == "DELETE" {
            Self.lock.lock(); let fail = Self.failDelete; Self.lock.unlock()
            respond(fail ? 503 : 204, "")
        } else if path.contains("/auth/") {
            respond(200, #"{"user":{"id":"journey","email":"test@example.invalid"}}"#)
        } else {
            // Keep new specimens local to test the durable offline confirmation path.
            respond(503, #"{"error":{"code":"unavailable"}}"#)
        }
    }
    private func respond(_ status: Int, _ body: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
