import XCTest
@testable import Numi

@MainActor final class APNsTokenRequestTests: XCTestCase {
    func testFreshOsCallbackCompletesRequest() async throws {
        let broker = APNsTokenRequest()
        let value = try await broker.request { broker.received(Data([1, 2, 3])) }
        XCTAssertEqual(value, Data([1, 2, 3]))
    }
    func testPreviousCallbackIsNotReused() async throws {
        let broker = APNsTokenRequest()
        broker.received(Data([1]))
        let value = try await broker.request { broker.received(Data([2])) }
        XCTAssertEqual(value, Data([2]))
    }
    func testMissingOsCallbackReleasesWaiter() async {
        let broker = APNsTokenRequest()
        do { _ = try await broker.request(timeoutNanoseconds: 1_000_000) {}; XCTFail("Expected unavailable") }
        catch { XCTAssertTrue(error is APNsTokenRequestError) }
        broker.received(Data([3])) // The already completed waiter is not resumed a second time.
    }
    func testCancellationDoesNotConsumeNextRequestsCallback() async throws {
        let broker = APNsTokenRequest()
        let started = expectation(description: "OS registration started")
        let first = Task { try await broker.request { started.fulfill() } }
        await fulfillment(of: [started], timeout: 1)
        first.cancel()
        do { _ = try await first.value; XCTFail("Expected cancellation") }
        catch { XCTAssertTrue(error is CancellationError) }
        let second = try await broker.request { broker.received(Data([4])) }
        XCTAssertEqual(second, Data([4]))
    }
}
