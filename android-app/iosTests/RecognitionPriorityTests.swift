import XCTest
import UIKit
@testable import Numi

final class RecognitionPriorityTests: XCTestCase {
    private struct Environment { let model: NumiModel; let disk: LibraryDisk; let vault: SessionVault; let root: URL }
    @MainActor private func environment(photo: Bool = false) async throws -> Environment {
        PriorityProtocol.reset()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "priority-" + UUID().uuidString)
        try vault.write(SavedSession(user: NumiUser(id: "priority", email: "test@example.invalid"), cookies: []))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PriorityProtocol.self]
        let session = URLSession(configuration: config)
        let api = NumiAPI(session: session, vault: vault), disk = LibraryDisk(root: root)
        var library = LibrarySnapshot(); library.cursor = "initial"
        library.items["coin"] = Coin(id: "coin", version: 1, userLabel: "Coin", status: "active")
        if photo { library.photos["photo"] = CoinPhoto(id: "photo", itemId: "coin", side: "obverse", byteSize: 1, status: "ready", sortOrder: 0, displayUrl: "https://fixture.invalid/photo") }
        try await disk.save(library, account: "priority")
        let model = NumiModel(api: api, disk: disk, telemetryEnabled: false, mediaTestSession: session)
        await model.bootstrap()
        return Environment(model: model, disk: disk, vault: vault, root: root)
    }
    @MainActor func testCaptureDefersManualAndQueuedSyncAndHistoryThenResumes() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        env.model.setCaptureActive(true)
        await env.model.sync(); await env.model.sync(); await env.model.refreshValueHistory()
        XCTAssertTrue(PriorityProtocol.paths.isEmpty)
        env.model.setCaptureActive(false)
        await env.model.sync()
        XCTAssertTrue(PriorityProtocol.paths.contains("/api/v1/collection/sync"))
        XCTAssertTrue(PriorityProtocol.paths.contains("/api/v1/collection/value-history"))
        await env.model.signOut()
    }
    @MainActor func testRecognitionRetainsPriorityAfterCaptureClosesAndFailureReleasesIt() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }.jpegData(compressionQuality: 1)!
        await draft.addImages([image, image])
        let started = expectation(description: "identify started")
        PriorityProtocol.hold("/api/v1/collection/identify", started: started)
        env.model.setCaptureActive(true)
        let request = Task { await draft.identify() }
        await fulfillment(of: [started], timeout: 5)
        env.model.setCaptureActive(false)
        await env.model.sync()
        XCTAssertTrue(env.model.transferDeferred)
        XCTAssertFalse(PriorityProtocol.paths.contains("/api/v1/collection/sync"))
        let resumed = expectation(description: "deferred sync resumes automatically")
        PriorityProtocol.hold("/api/v1/collection/sync", started: resumed)
        PriorityProtocol.release(status: 503, body: #"{"error":{"code":"unavailable"}}"#)
        await request.value
        XCTAssertFalse(env.model.transferDeferred); XCTAssertEqual(draft.step, .identificationFailed)
        XCTAssertEqual(draft.images.count, 2)
        await fulfillment(of: [resumed], timeout: 5)
        XCTAssertTrue(PriorityProtocol.paths.contains("/api/v1/collection/sync"))
        PriorityProtocol.release(status: 200, body: #"{"changes":[],"nextCursor":"current","hasMore":false}"#)
        await env.model.signOut()
    }
    @MainActor func testInFlightSyncStopsBeforeNextMediaRequestAndResumes() async throws {
        let env = try await environment(photo: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let started = expectation(description: "sync started")
        PriorityProtocol.hold("/api/v1/collection/sync", started: started)
        let syncing = Task { await env.model.sync() }
        await fulfillment(of: [started], timeout: 5)
        env.model.setCaptureActive(true)
        PriorityProtocol.release(status: 200, body: #"{"changes":[],"nextCursor":"paused","hasMore":false}"#)
        await syncing.value
        XCTAssertFalse(PriorityProtocol.paths.contains("/photo")); XCTAssertNil(env.model.error)
        env.model.setCaptureActive(false); await env.model.sync()
        XCTAssertTrue(PriorityProtocol.paths.contains("/photo"))
        await env.model.signOut()
    }
    @MainActor func testAlreadyRunningMediaDownloadIsCancelledWithoutSyncError() async throws {
        let env = try await environment(photo: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let started = expectation(description: "photo started"), stopped = expectation(description: "photo cancelled")
        PriorityProtocol.hold("/photo", started: started, stopped: stopped)
        let syncing = Task { await env.model.sync() }
        await fulfillment(of: [started], timeout: 5)
        env.model.setCaptureActive(true)
        await fulfillment(of: [stopped], timeout: 5); await syncing.value
        XCTAssertFalse(env.model.syncing); XCTAssertNil(env.model.error)
        env.model.setCaptureActive(false); await env.model.sync()
        let cached = await env.disk.hasImage(account: "priority", key: "photo:photo:")
        XCTAssertTrue(cached)
        await env.model.signOut()
    }
    @MainActor func testHistoryFailureRetainsOfflineCacheAndSignOutClearsVisibleHistory() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        await env.model.refreshValueHistory()
        XCTAssertEqual(env.model.valueHistory.points.count, 2)
        PriorityProtocol.failHistory = true
        await env.model.refreshValueHistory()
        XCTAssertEqual(env.model.valueHistory.points.count, 2); XCTAssertNil(env.model.valueHistoryError)
        await env.model.signOut(); XCTAssertTrue(env.model.valueHistory.points.isEmpty)
    }
}

private final class PriorityProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var records: [String] = []
    private static var heldPath: String?
    private static var started: XCTestExpectation?
    private static var stopped: XCTestExpectation?
    private static var waiting: PriorityProtocol?
    static var failHistory = false
    static var paths: [String] { lock.lock(); defer { lock.unlock() }; return records }
    static func reset() { lock.lock(); defer { lock.unlock() }; records = []; heldPath = nil; waiting = nil; started = nil; stopped = nil; failHistory = false }
    static func hold(_ path: String, started: XCTestExpectation, stopped: XCTestExpectation? = nil) {
        lock.lock(); defer { lock.unlock() }; heldPath = path; self.started = started; self.stopped = stopped
    }
    static func release(status: Int, body: String) {
        lock.lock(); let pending = waiting; waiting = nil; lock.unlock(); pending?.respond(status, Data(body.utf8))
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        Self.lock.lock(); Self.records.append(path)
        let started = Self.heldPath == path ? Self.started : nil
        if started != nil { Self.waiting = self; Self.heldPath = nil; Self.started = nil }
        Self.lock.unlock()
        if let started { started.fulfill(); return }
        if path.hasSuffix("/sync") { respond(200, Data(#"{"changes":[],"nextCursor":"current","hasMore":false}"#.utf8)) }
        else if path.hasSuffix("/value-history") { respond(Self.failHistory ? 503 : 200, Data(CollectionValueHistoryTests.response.utf8)) }
        else if path == "/photo" {
            let data = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
                UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
            }.jpegData(compressionQuality: 1)!
            respond(200, data)
        } else { respond(503, Data("{}".utf8)) }
    }
    private func respond(_ status: Int, _ data: Data) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {
        Self.lock.lock(); let stopped = Self.waiting === self ? Self.stopped : nil
        if stopped != nil { Self.waiting = nil; Self.stopped = nil }
        Self.lock.unlock(); stopped?.fulfill()
    }
}
