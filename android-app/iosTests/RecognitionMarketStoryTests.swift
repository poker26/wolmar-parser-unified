import XCTest
import UIKit
@testable import Numi

final class RecognitionMarketStoryTests: XCTestCase {
    func testBundledExampleContainsVerifiedSalesAndLocalPhoto() {
        let story = RecognitionMarketStory.bundled
        XCTAssertEqual(story.id, "kamchatka-sales-v1")
        XCTAssertEqual(story.sales.map(\.lotId), [4340344, 4358454, 4404363])
        XCTAssertEqual(story.sales.map(\.priceRub).min(), 31963)
        XCTAssertEqual(story.sales.map(\.priceRub).max(), 42908)
        XCTAssertEqual(story.exampleLabel, "Пример из каталога")
        XCTAssertNotNil(UIImage(named: "MarketStoryCoin"))
        XCTAssertTrue(story.sales.allSatisfy { $0.url.hasPrefix("https://www.wolmar.ru/auction/") })
    }
    func testLongWaitDoesNotPromiseADeadline() {
        let story = RecognitionMarketStory.bundled
        XCTAssertEqual(story.timingText(elapsedSeconds: 0), story.expectedTime)
        XCTAssertEqual(story.timingText(elapsedSeconds: 14.9), story.expectedTime)
        XCTAssertEqual(story.timingText(elapsedSeconds: 15), story.longWait)
        XCTAssertEqual(story.timingText(elapsedSeconds: 300), story.longWait)
    }

    @MainActor func testClosingTheWaitingScreenDoesNotCancelOrDuplicateTheSavedRequest() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "numi-waiting-" + UUID().uuidString)
        defer { WaitingStoryProtocol.reset(); try? vault.clear(); try? FileManager.default.removeItem(at: root) }
        try vault.write(SavedSession(user: NumiUser(id: "waiting-owner", email: "waiting@example.invalid"),
            cookies: [SavedCookie(name: "__Host-wolmar_session", value: "fixture", expires: nil),
                      SavedCookie(name: "__Host-wolmar_csrf", value: "fixture", expires: nil)]))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WaitingStoryProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: configuration), vault: vault)
        let disk = LibraryDisk(root: root)
        var library = LibrarySnapshot(); library.cursor = "existing"
        try await disk.save(library, account: "waiting-owner")
        let model = NumiModel(api: api, disk: disk, telemetryEnabled: false)
        await model.bootstrap()
        let draft = AddCoinModel(model: model); await draft.restore()
        let photo = try XCTUnwrap(UIImage(named: "MarketStoryCoin")?.jpegData(compressionQuality: 1))
        await draft.addImages([photo, photo])
        let screenTask = Task { await draft.identify() }
        for _ in 0..<200 {
            if WaitingStoryProtocol.started { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertTrue(WaitingStoryProtocol.started)
        XCTAssertTrue(draft.identifying)
        let kept = await draft.keepDraft(); XCTAssertTrue(kept)
        screenTask.cancel()
        let resumedScreen = Task { await draft.identify() }
        WaitingStoryProtocol.complete()
        await screenTask.value; await resumedScreen.value
        XCTAssertEqual(WaitingStoryProtocol.calls, 1)
        XCTAssertEqual(draft.recognition?.requestId, "waiting-result")
        XCTAssertFalse(draft.identifying)
        let restored = AddCoinModel(model: model); await restored.restore()
        XCTAssertEqual(restored.recognition?.requestId, "waiting-result")
        XCTAssertEqual(restored.images.count, 2)
    }
}

private final class WaitingStoryProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var pending: WaitingStoryProtocol?
    private static var count = 0
    static var started: Bool { lock.lock(); defer { lock.unlock() }; return pending != nil }
    static var calls: Int { lock.lock(); defer { lock.unlock() }; return count }
    static func reset() { lock.lock(); pending = nil; count = 0; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.url?.path == "/api/v1/collection/identify" else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return
        }
        Self.lock.lock(); Self.pending = self; Self.count += 1; Self.lock.unlock()
    }
    static func complete() {
        lock.lock(); let instance = pending; pending = nil; lock.unlock()
        guard let instance else { return }
        let body = #"{"identificationSessionId":"waiting-session","requestId":"waiting-result","catalogMatch":"not_found","extracted":{},"candidates":[]}"#
        let response = HTTPURLResponse(url: instance.request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        instance.client?.urlProtocol(instance, didReceive: response, cacheStoragePolicy: .notAllowed)
        instance.client?.urlProtocol(instance, didLoad: Data(body.utf8))
        instance.client?.urlProtocolDidFinishLoading(instance)
    }
    override func stopLoading() { }
}
