import XCTest
@testable import Numi

final class MobileObservationsTests: XCTestCase {
    let event = MobileObservation(id: "one", kind: "active", occurredAt: "2026-10-01T20:59:00Z")
    func testReplayKeepsOriginalTimeAndDoesNotRequeueAfterAcknowledgement() {
        var queue = MobileObservationQueue()
        queue.add(event)
        queue.add(MobileObservation(id: "one", kind: "active", occurredAt: "2026-10-02T01:00:00Z"))
        XCTAssertEqual(queue.pending, [event])
        queue.acknowledge(["one"])
        queue.add(event)
        XCTAssertTrue(queue.pending.isEmpty)
    }
    func testAcknowledgementRetainsLaterEvents() {
        var queue = MobileObservationQueue()
        queue.add(event)
        let next = MobileObservation(id: "two", kind: "active", occurredAt: event.occurredAt)
        queue.add(next)
        queue.acknowledge(["one", "unknown"])
        XCTAssertEqual(queue.pending, [next])
        XCTAssertEqual(queue.sent, ["one"])
    }
    func testDayUsesMoscowMidnightAndStableUUID() {
        let first = MobileObservation.active(account: "a", now: Date(timeIntervalSince1970: 1790888340))
        let second = MobileObservation.active(account: "a", now: Date(timeIntervalSince1970: 1790888360))
        XCTAssertEqual(first.id, second.id)
        XCTAssertNotNil(UUID(uuidString: first.id))
        XCTAssertNotEqual(first.id, MobileObservation.active(account: "b", now: Date(timeIntervalSince1970: 1790888340)).id)
    }
    func testDiskQueueSurvivesRecreationAndKeepsAccountOwnership() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = LibraryDisk(root: root)
        try await disk.queueObservation(event, account: "a")
        let reopened = LibraryDisk(root: root)
        let loaded = try await reopened.pendingObservations(account: "a")
        let other = try await reopened.pendingObservations(account: "b")
        XCTAssertEqual(loaded, [event]); XCTAssertTrue(other.isEmpty)
        try await reopened.acknowledgeObservations([event.id], account: "a")
        try await reopened.queueObservation(event, account: "a")
        let empty = try await reopened.pendingObservations(account: "a")
        XCTAssertTrue(empty.isEmpty)
    }
}
