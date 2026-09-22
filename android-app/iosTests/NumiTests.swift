import XCTest
import UIKit
@testable import Numi

final class NumiTests: XCTestCase {
    func decode<T: Decodable>(_ text: String, as type: T.Type) throws -> T { try JSONDecoder().decode(type, from: Data(text.utf8)) }
    let coinJSON = #"{"id":"a","version":2,"typeName":"Монета","status":"active","catalog":{"mintage":5000}}"#
    func testMetalGroupsIgnoreLanguageAndFineness() {
        for metal in ["Золото", "Gold", "Au", "золото 999/1000", "999.9 Fine Gold"] {
            XCTAssertEqual(collectionMetalGroup(metal), "Золото", metal)
        }
        for metal in ["Серебро", "silver", "Ag", "серебро 925/1000", ".925 Sterling Silver"] {
            XCTAssertEqual(collectionMetalGroup(metal), "Серебро", metal)
        }
        XCTAssertEqual(collectionMetalGroup("Cu-Ni"), "Медно-никелевый сплав")
        XCTAssertNotEqual(collectionMetalGroup("gold plated"), "Золото")
        XCTAssertNotEqual(collectionMetalGroup("German silver"), "Серебро")
        XCTAssertNil(collectionMetalGroup(nil))
        XCTAssertNil(collectionMetalGroup("unknown"))
    }
    func testLegacyArchivedCoinsRemainInCollection() throws {
        for status in ["active", "archived"] {
            let coin = try decode(coinJSON.replacingOccurrences(of: "active", with: status), as: Coin.self)
            XCTAssertTrue(coin.isInCollection)
        }
        let sold = try decode(coinJSON.replacingOccurrences(of: "active", with: "sold"), as: Coin.self)
        XCTAssertFalse(sold.isInCollection)
    }
    func testAccountPasswordValidation() {
        XCTAssertNoThrow(try validateAccount(email: "new@example.invalid", password: "test-password", confirmation: "test-password", action: .register))
        XCTAssertThrowsError(try validateAccount(email: "new@example.invalid", password: "short", confirmation: "short", action: .register))
        XCTAssertThrowsError(try validateAccount(email: "new@example.invalid", password: "test-password", confirmation: "other-password", action: .register))
    }
    func page(_ changes: String, cursor: String = "next", more: Bool = false) throws -> SyncPage {
        try decode("{\"changes\":[\(changes)],\"nextCursor\":\"\(cursor)\",\"hasMore\":\(more)}", as: SyncPage.self)
    }
    func testMissingEstimateDoesNotBecomeZero() throws {
        let coin = try decode(coinJSON, as: Coin.self)
        XCTAssertNil(coin.valuation?.amount)
        XCTAssertEqual(coin.mintage, 5000)
        let floor = try decode(#"{"id":"v","status":"floor_only","valueFloorMinor":125000,"estimateKind":"metal_floor"}"#, as: CoinValuation.self)
        XCTAssertEqual(floor.amount, 125000)
        XCTAssertTrue(floor.isFloor)
        let unavailable = try decode(#"{"id":"v","status":"insufficient_data","medianMinor":125000}"#, as: CoinValuation.self)
        XCTAssertNil(unavailable.amount)
    }
    func testSyncIsIdempotentAndRejectsIncompletePage() throws {
        let valid = try page("{\"seq\":\"1\",\"entityKind\":\"item\",\"entityId\":\"a\",\"itemId\":\"a\",\"operation\":\"upsert\",\"item\":\(coinJSON)}")
        let first = try LibrarySnapshot().applying(valid)
        let replay = try first.applying(valid)
        XCTAssertEqual(replay.items.count, 1)
        XCTAssertEqual(replay.items["a"]?.version, 2)
        let incomplete = try page(#"{"seq":"2","entityKind":"photo","entityId":"p","itemId":"a","operation":"upsert"}"#)
        XCTAssertThrowsError(try first.applying(incomplete))
        XCTAssertEqual(first.cursor, "next")
        XCTAssertEqual(first.items.count, 1)
        let stuck = try page("", cursor: "next", more: true)
        XCTAssertThrowsError(try first.applying(stuck))
    }
    func testDeletingItemRemovesRelatedEvidence() throws {
        var snapshot = LibrarySnapshot()
        snapshot.items["a"] = try decode(coinJSON, as: Coin.self)
        snapshot.photos["p"] = try decode(#"{"id":"p","itemId":"a","side":"obverse","byteSize":4,"status":"ready","sortOrder":0}"#, as: CoinPhoto.self)
        let deletion = try page(#"{"seq":"3","entityKind":"item","entityId":"a","itemId":"a","operation":"delete"}"#)
        let updated = try snapshot.applying(deletion)
        XCTAssertTrue(updated.items.isEmpty)
        XCTAssertTrue(updated.photos.isEmpty)
    }
    func testSnapshotSurvivesRestartAndIsAccountScoped() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var snapshot = LibrarySnapshot()
        snapshot.items["a"] = try decode(coinJSON, as: Coin.self)
        snapshot.cursor = "durable-position"
        try await LibraryDisk(root: root).save(snapshot, account: "first")
        let reopened = try await LibraryDisk(root: root).load(account: "first")
        let another = try await LibraryDisk(root: root).load(account: "second")
        XCTAssertEqual(reopened.items["a"]?.catalog?.mintage, 5000)
        XCTAssertEqual(reopened.cursor, "durable-position")
        XCTAssertTrue(another.items.isEmpty)
    }
    func testPhotoSurvivesRestartAndRejectsInvalidImage() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
            UIColor.brown.setFill(); context.fill(CGRect(x: 0, y: 0, width: 20, height: 20))
        }
        let disk = LibraryDisk(root: root)
        try await disk.storeImage(try XCTUnwrap(image.pngData()), account: "first", key: "coin-photo")
        let reopened = LibraryDisk(root: root)
        let exists = await reopened.hasImage(account: "first", key: "coin-photo")
        let data = await reopened.image(account: "first", key: "coin-photo")
        let wrongAccount = await reopened.hasImage(account: "second", key: "coin-photo")
        XCTAssertTrue(exists)
        XCTAssertNotNil(data.flatMap { UIImage(data: $0) })
        XCTAssertFalse(wrongAccount)
        do {
            try await disk.storeImage(Data("invalid".utf8), account: "first", key: "bad")
            XCTFail("Invalid image must fail before being cached")
        } catch NumiError.corruptPhoto { }
        let invalidExists = await disk.hasImage(account: "first", key: "bad")
        XCTAssertFalse(invalidExists)
    }
    func testLoginAndRestoreUseKeychainSession() async throws {
        let vault = SessionVault(service: "numi-test-" + UUID().uuidString)
        defer { try? vault.clear() }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        let session = URLSession(configuration: config)
        let api = NumiAPI(session: session, vault: vault)
        let user = try await api.login(email: "test@example.invalid", password: "test-password")
        XCTAssertEqual(user.id, "test-user")
        let restored = try await NumiAPI(session: session, vault: vault).restore()
        XCTAssertEqual(restored?.id, "test-user")
        XCTAssertEqual(try vault.read()?.cookies.first?.name, "__Host-wolmar_session")
        XCTAssertEqual(StubProtocol.lastPath, "/api/v1/auth/login")
    }
    func testOfflineBootstrapDoesNotCallAPI() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "numi-test-" + UUID().uuidString)
        defer { try? vault.clear(); try? FileManager.default.removeItem(at: root) }
        try vault.write(SavedSession(user: NumiUser(id: "offline", email: "test@example.invalid"), cookies: []))
        var snapshot = LibrarySnapshot(); snapshot.cursor = "saved"
        snapshot.items["a"] = try decode(coinJSON, as: Coin.self)
        let disk = LibraryDisk(root: root)
        try await disk.save(snapshot, account: "offline")
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [StubProtocol.self]
        StubProtocol.lastPath = nil
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        let model = await NumiModel(api: api, disk: disk)
        await model.bootstrap()
        let count = await model.coins.count
        XCTAssertEqual(count, 1)
        XCTAssertNil(StubProtocol.lastPath)
    }
}
final class StubProtocol: URLProtocol {
    static var lastPath: String?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lastPath = request.url?.path
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
            headerFields: ["Content-Type": "application/json", "Set-Cookie": "__Host-wolmar_session=test-session; Path=/; Secure; HttpOnly"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"user":{"id":"test-user","email":"test@example.invalid"}}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
