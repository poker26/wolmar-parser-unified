import XCTest
@testable import Numi

final class CollectionValueHistoryTests: XCTestCase {
    static let response = #"{"currency":"RUB","points":[{"date":"2026-10-14","activeCount":3,"valuedCount":1,"floorOnlyCount":1,"unvaluedCount":1,"marketTotalMinor":200000,"floorOnlyTotalMinor":100000,"conservativeTotalMinor":300000,"capturedAt":"2026-10-14T10:00:00Z"},{"date":"2026-10-13","activeCount":3,"valuedCount":1,"floorOnlyCount":1,"unvaluedCount":1,"marketTotalMinor":150000,"floorOnlyTotalMinor":100000,"conservativeTotalMinor":250000,"capturedAt":"2026-10-13T10:00:00Z"}]}"#
    func testContractKeepsAmountsAndCoverageAndOrdersDates() throws {
        let history = try JSONDecoder().decode(CollectionValueHistory.self, from: Data(Self.response.utf8)).ordered()
        XCTAssertEqual(history.currency, "RUB"); XCTAssertEqual(history.points.map(\.date), ["2026-10-13", "2026-10-14"])
        XCTAssertEqual(history.points.last?.conservativeTotalMinor, 300000)
        XCTAssertEqual(history.points.last?.unvaluedCount, 1)
        XCTAssertEqual(history.difference, 50000); XCTAssertEqual(history.differencePercent, 20)
    }
    func testSinglePointAndZeroBaselineDoNotInventPercentage() throws {
        var history = try JSONDecoder().decode(CollectionValueHistory.self, from: Data(Self.response.utf8)).ordered()
        history.points = Array(history.points.suffix(1)); XCTAssertNil(history.difference); XCTAssertNil(history.differencePercent)
        history.points.insert(CollectionValuePoint(date: "2026-10-12", activeCount: 0, valuedCount: 0, floorOnlyCount: 0, unvaluedCount: 0,
            marketTotalMinor: 0, floorOnlyTotalMinor: 0, conservativeTotalMinor: 0, capturedAt: "2026-10-12T00:00:00Z"), at: 0)
        XCTAssertEqual(history.difference, 300000); XCTAssertNil(history.differencePercent)
    }
    func testOfflineCacheIsIsolatedByAccount() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let history = try JSONDecoder().decode(CollectionValueHistory.self, from: Data(Self.response.utf8)).ordered()
        let disk = LibraryDisk(root: root); try await disk.saveValueHistory(history, account: "first")
        let reopened = try await LibraryDisk(root: root).loadValueHistory(account: "first")
        let other = try await disk.loadValueHistory(account: "second")
        XCTAssertEqual(reopened, history); XCTAssertTrue(other.points.isEmpty)
    }
    func testLatestDailyCaptureWins() throws {
        var history = try JSONDecoder().decode(CollectionValueHistory.self, from: Data(Self.response.utf8))
        history.points.append(history.points[0]); XCTAssertEqual(history.ordered().points.count, 2)
    }
    func testTimingNeverPersistsURLOrCredential() throws {
        let clock = ProcessInfo.processInfo.systemUptime
        let timing = RecognitionMetricsDelegate(started: clock, prepared: clock).finish(requestID: "https://secret.invalid/token?key=secret")
        XCTAssertNil(timing.requestID)
        let text = String(decoding: try JSONEncoder().encode(timing), as: UTF8.self)
        XCTAssertFalse(text.contains("secret")); XCTAssertFalse(text.contains("Cookie"))
        XCTAssertEqual(RecognitionMetricsDelegate(started: clock, prepared: clock).finish(requestID: "request-123").requestID, "request-123")
    }
}
