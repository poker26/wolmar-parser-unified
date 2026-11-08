import XCTest
@testable import Numi

final class ValuationJourneyTests: XCTestCase {
    @MainActor func testUnlinkedCoinDoesNotStartValuationOrCreateAnAttempt() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        try await env.model.recalculateCoin("coin")
        XCTAssertEqual(ValuationProtocol.calculations, 0)
        XCTAssertNil(env.model.coins.first?.valuation)
        let saved = try await env.disk.load(account: "valuation")
        XCTAssertNil(saved.items["coin"]?.valuation)
    }
    func testEmptyMarketAndFailedAttemptCannotOpenUnlinkedValuation() {
        var coin = Coin(id: "coin", version: 1, status: "active")
        coin.valuation = CoinValuation(id: "attempt", medianMinor: 17000, status: "insufficient_data")
        XCTAssertNil(coin.currentValuationAvailability)
        coin.typeId = 42
        XCTAssertNil(coin.currentValuationAvailability)
        coin.valuationAvailability = Self.availability(canRecalculate: true)
        XCTAssertEqual(coin.currentValuationAvailability?.showDetails, true)
        coin.version = 2
        XCTAssertNil(coin.currentValuationAvailability)
    }
    func testMetalCalculationRemainsAvailableWithoutCatalogType() {
        var coin = Coin(id: "coin", version: 1, status: "active")
        let values = ["metal": "Серебро", "mass": "31,1", "massUnit": "g", "fineness": "999"]
        coin.properties = CoinProperties(values: values)
        XCTAssertNil(coin.currentValuationAvailability)
        coin.valuationAvailability = Self.availability(canRecalculate: true)
        XCTAssertTrue(coin.needsInitialValuation)
        coin.version = 2
        coin.valuationAvailability = Self.availability(version: 2, canRecalculate: false)
        XCTAssertFalse(coin.needsInitialValuation)
    }
    @MainActor func testSelectingCatalogAutomaticallyCalculatesAndPersistsResult() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        env.model.setCaptureActive(false)
        try await env.model.linkCatalog("coin", choice: CatalogChoice(id: 42, name: "Монета"))
        await wait { env.model.coins.first?.valuation?.amount == 17000 }
        let saved = try await env.disk.load(account: "valuation")
        XCTAssertEqual(saved.items["coin"]?.valuation?.amount, 17000)
        XCTAssertEqual(saved.items["coin"]?.notes, "Мои заметки")
        XCTAssertEqual(ValuationProtocol.calculations, 1)
    }
    @MainActor func testFailedRequestRecoversFromSavedCollectionInNewModel() async throws {
        let env = try await environment(linked: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        ValuationProtocol.fail = true
        env.model.setCaptureActive(false)
        await env.model.recoverMissingValuations()
        await wait { env.model.valuationErrors["coin"] != nil }
        XCTAssertNil(env.model.coins.first?.valuation)
        let model = NumiModel(api: env.api, disk: env.disk, telemetryEnabled: false)
        model.setCaptureActive(true); await model.bootstrap()
        ValuationProtocol.fail = false
        model.setCaptureActive(false)
        await model.recoverMissingValuations()
        await wait { model.coins.first?.valuation?.amount == 17000 }
        let count = ValuationProtocol.calculations
        await model.recoverMissingValuations()
        XCTAssertEqual(ValuationProtocol.calculations, count)
    }
    @MainActor func testQualityAbstentionIsPersistedWithoutInventingGradeOrRetrying() async throws {
        let env = try await environment(linked: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        ValuationProtocol.qualityRequired = true
        env.model.setCaptureActive(false)
        await env.model.recoverMissingValuations()
        await wait { env.model.coins.first?.valuation?.requiresQuality == true }
        XCTAssertNil(env.model.coins.first?.valuation?.amount)
        XCTAssertNil(env.model.coins.first?.gradeCode)
        let count = ValuationProtocol.calculations
        await env.model.recoverMissingValuations()
        XCTAssertEqual(ValuationProtocol.calculations, count)
        let saved = try await env.disk.load(account: "valuation")
        XCTAssertTrue(saved.items["coin"]?.valuation?.requiresQuality == true)
    }
    @MainActor private func wait(_ condition: () -> Bool) async {
        let deadline = Date().addingTimeInterval(10)
        while !condition() && Date() < deadline { try? await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertTrue(condition())
    }
    private struct Environment {
        let model: NumiModel; let api: NumiAPI; let disk: LibraryDisk; let vault: SessionVault; let root: URL
    }
    @MainActor private func environment(linked: Bool = false) async throws -> Environment {
        ValuationProtocol.reset()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "valuation-" + UUID().uuidString)
        try vault.write(SavedSession(user: NumiUser(id: "valuation", email: "test@example.invalid"), cookies: []))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ValuationProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        let disk = LibraryDisk(root: root)
        var snapshot = LibrarySnapshot(); snapshot.cursor = "initial"
        snapshot.items["coin"] = Coin(id: "coin", version: 1, typeId: linked ? 42 : nil, notes: "Мои заметки",
            status: "active", valuationAvailability: Self.availability(canRecalculate: linked))
        try await disk.save(snapshot, account: "valuation")
        let model = NumiModel(api: api, disk: disk, telemetryEnabled: false)
        model.setCaptureActive(true); await model.bootstrap()
        return Environment(model: model, api: api, disk: disk, vault: vault, root: root)
    }
    func testOnlyMissingLinkedOwnedCoinNeedsInitialCalculation() throws {
        var coin = Coin(id: "coin", version: 1, typeId: 1, status: "active",
            valuationAvailability: Self.availability(canRecalculate: true))
        XCTAssertTrue(coin.needsInitialValuation)
        let reopened = try JSONDecoder().decode(Coin.self, from: JSONEncoder().encode(coin))
        XCTAssertTrue(reopened.needsInitialValuation)
        coin.valuation = CoinValuation(id: "v", status: "insufficient_data", abstainReason: "grade_required")
        XCTAssertFalse(coin.needsInitialValuation)
        coin.valuation = nil; coin.valuationAvailability = nil; XCTAssertFalse(coin.needsInitialValuation)
    }
    private static func availability(version: Int64 = 1, canRecalculate: Bool) -> ValuationAvailability {
        ValuationAvailability(contract: "numi-collection-valuation-v1", itemVersion: version,
            state: canRecalculate ? "temporarily_unavailable" : "missing_inputs", reason: nil,
            canRecalculate: canRecalculate, currency: nil, amountMinor: nil, snapshotId: nil, calculatedAt: nil)
    }
    func testQualityRequiredCannotExposeStalePrice() throws {
        let json = #"{"id":"v","status":"insufficient_data","abstainReason":"grade_required","medianMinor":509500,"valueFloorMinor":509500,"estimateKind":"metal_floor"}"#
        var value = try JSONDecoder().decode(CoinValuation.self, from: Data(json.utf8))
        XCTAssertTrue(value.requiresQuality); XCTAssertNil(value.amount)
        value.status = "ready"; XCTAssertNil(value.amount)
        value.status = "floor_only"; XCTAssertNil(value.amount)
        let reopened = try JSONDecoder().decode(CoinValuation.self, from: JSONEncoder().encode(value))
        XCTAssertTrue(reopened.requiresQuality); XCTAssertNil(reopened.amount)
    }
    func testSummaryUsesOwnSalesDateAndMetalBasis() {
        var value = CoinValuation(id: "v", medianMinor: 17000, comparableCount: 21,
            status: "ready", calculatedAt: "2026-11-06T23:30:00Z")
        XCTAssertEqual(value.summaryBasis, "По 21 продаже")
        XCTAssertEqual(value.summaryDate, "06.11.2026")
        value.comparableCount = 11; XCTAssertEqual(value.summaryBasis, "По 11 продажам")
        value.status = "floor_only"; value.valueFloorMinor = 9000
        XCTAssertEqual(value.summaryBasis, "По стоимости металла")
        value.status = "insufficient_data"; XCTAssertNil(value.summaryBasis)
        value.calculatedAt = "null"; XCTAssertNil(value.summaryDate)
    }
    func testOwnNameAndNotesDoNotChangeValuationInputsButQualityDoes() {
        let coin = Coin(id: "coin", version: 1, typeId: 1, status: "active")
        var updated = coin; updated.userLabel = "Подарок"; updated.notes = "Мои заметки"
        XCTAssertTrue(coin.sameValuationInputs(as: updated))
        updated.gradeCode = "PF"; XCTAssertFalse(coin.sameValuationInputs(as: updated))
        updated = coin; updated.typeId = 2; XCTAssertFalse(coin.sameValuationInputs(as: updated))
        updated = coin; updated.properties = CoinProperties(values: ["mass": "31.1"])
        XCTAssertFalse(coin.sameValuationInputs(as: updated))
    }
}

private final class ValuationProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var count = 0
    static var fail = false
    static var qualityRequired = false
    static var calculations: Int { lock.lock(); defer { lock.unlock() }; return count }
    static func reset() { lock.lock(); defer { lock.unlock() }; count = 0; fail = false; qualityRequired = false }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        if path.hasSuffix("/valuation/recalculate") {
            Self.lock.lock(); Self.count += 1; let fail = Self.fail; let quality = Self.qualityRequired; Self.lock.unlock()
            if fail { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return }
            respond(200, quality
                ? #"{"valuation":{"id":"v","status":"insufficient_data","abstainReason":"grade_required","medianMinor":null}}"#
                : #"{"valuation":{"id":"v","status":"ready","medianMinor":17000}}"#)
        } else if request.httpMethod == "PATCH" {
            let fields = OnboardingFixtureProtocol.fields(request)
            let item: [String: Any] = ["id": "coin", "version": 2, "typeId": fields["typeId"] ?? 42,
                "properties": fields["properties"] ?? [:], "status": "active", "notes": "Мои заметки",
                "valuationAvailability": ["contract": "numi-collection-valuation-v1", "itemVersion": 2,
                    "state": "temporarily_unavailable", "canRecalculate": true]]
            respond(200, String(decoding: try! JSONSerialization.data(withJSONObject: ["item": item]), as: UTF8.self))
        } else if path.hasSuffix("/sync") {
            respond(200, #"{"changes":[],"nextCursor":"initial","hasMore":false}"#)
        } else if path.contains("/auth/") {
            respond(200, #"{"user":{"id":"valuation","email":"test@example.invalid"}}"#)
        } else { respond(503, #"{"error":{"code":"unavailable"}}"#) }
    }
    private func respond(_ status: Int, _ body: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
