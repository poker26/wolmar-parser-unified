import XCTest
import Foundation
@testable import Numi

final class CollectionRevaluationTests: XCTestCase {
    @MainActor func testModelSynchronizesBeforeStartAndPullsNewValue() async throws {
        try await exerciseModel(failSync: false, resume: false)
    }
    @MainActor func testOfflineSyncPreventsStartingStaleCalculation() async throws {
        try await exerciseModel(failSync: true, resume: false)
    }
    @MainActor func testReopeningReadsExistingJobWithoutStartingAgain() async throws {
        try await exerciseModel(failSync: false, resume: true)
    }
    @MainActor private func exerciseModel(failSync: Bool, resume: Bool) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "batch-tests-" + UUID().uuidString)
        defer { try? vault.clear(); try? FileManager.default.removeItem(at: root) }
        try vault.write(SavedSession(user: NumiUser(id: "batch-user", email: "batch@example.invalid"), cookies: []))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [BatchProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        let disk = LibraryDisk(root: root)
        var library = LibrarySnapshot(); library.cursor = "initial"
        try await disk.save(library, account: "batch-user")
        BatchProtocol.reset(failSync: failSync)
        let model = NumiModel(api: api, disk: disk, telemetryEnabled: false)
        await model.bootstrap()
        if resume { await model.resumeCollectionRevaluation() } else { await model.recalculateCollection() }
        XCTAssertFalse(model.revaluationBusy)
        let paths = BatchProtocol.paths
        if failSync {
            XCTAssertNotNil(model.revaluationError)
            XCTAssertFalse(paths.contains("POST /api/v1/collection/valuation/recalculate"))
        } else {
            XCTAssertNil(model.revaluationError)
            XCTAssertEqual(model.collectionRevaluation?.processed, 1)
            XCTAssertEqual(model.coins.first?.valuation?.amount, 200000)
            let expected = resume ? ["GET /api/v1/collection/valuation/recalculation", "GET /api/v1/collection/sync"]
                : ["GET /api/v1/collection/sync", "POST /api/v1/collection/valuation/recalculate", "GET /api/v1/collection/sync"]
            XCTAssertEqual(paths.filter { $0.contains("/collection/") }, expected)
        }
    }
    func testEmptyStatusResponse() throws {
        let response = try JSONDecoder().decode(CollectionRevaluationResponse.self, from: Data(#"{"job":null}"#.utf8))
        XCTAssertNil(response.job)
    }
    func testProgressAndPartialCompletion() throws {
        let response = try JSONDecoder().decode(CollectionRevaluationResponse.self, from: Data(#"{"job":{"status":"partial","total":50,"processed":50,"valued":47,"unvalued":2,"failed":1,"skipped":0}}"#.utf8))
        let job = try XCTUnwrap(response.job)
        XCTAssertFalse(job.running)
        XCTAssertEqual(job.label, "Обработано 50 из 50 монет. Ошибок: 1.")
        var running = job; running.status = "running"; running.processed = 10
        XCTAssertTrue(running.running)
        XCTAssertEqual(running.label, "Обработано 10 из 50 монет.")
    }
    func testRequestContainsOnlyIdempotencyKey() throws {
        let bytes = try JSONEncoder().encode(CollectionRevaluationRequest(requestId: "request"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: String])
        XCTAssertEqual(body, ["requestId": "request"])
    }
}

private final class BatchProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [String] = []
    private static var failSync = false
    static var paths: [String] { lock.lock(); defer { lock.unlock() }; return recorded }
    static func reset(failSync: Bool) { lock.lock(); defer { lock.unlock() }; recorded = []; self.failSync = failSync }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        Self.lock.lock(); Self.recorded.append("\(request.httpMethod ?? "GET") \(path)"); let failure = Self.failSync; Self.lock.unlock()
        var code = 200
        let body: String
        if path.hasSuffix("/sync") {
            if failure { code = 503; body = #"{"error":{"code":"unavailable"}}"# }
            else {
                body = #"{"changes":[{"seq":"2","entityKind":"item","entityId":"coin","itemId":"coin","operation":"upsert","item":{"id":"coin","version":2,"userLabel":"Coin","status":"active","valuation":{"id":"value","status":"ready","medianMinor":200000}}}],"nextCursor":"updated","hasMore":false}"#
            }
        } else if path.contains("/valuation/recalculat") {
            body = #"{"job":{"status":"completed","total":1,"processed":1,"valued":1,"unvalued":0,"failed":0,"skipped":0}}"#
        } else if path.contains("/auth/") {
            body = #"{"user":{"id":"batch-user","email":"batch@example.invalid"}}"#
        } else { code = 404; body = #"{"error":{"code":"unexpected_test_request"}}"# }
        let response = HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: ["Content-Type":"application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
