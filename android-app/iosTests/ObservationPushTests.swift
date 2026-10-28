import XCTest
@testable import Numi

final class ObservationPushTests: XCTestCase {
    let owner = PushAccount(id: "account-a", sessionRevision: 1)
    let token = PushToken(provider: .apns, value: "abcdef12", environment: .production)
    var event: ObservationPush { ObservationPush(eventId: "event-1", userId: owner.id) }
    func ready() -> ObservationPushPolicy {
        var p = ObservationPushPolicy()
        p.session(owner); p.transport(true); p.permission(.granted); p.token(token); p.consent(true)
        XCTAssertTrue(p.acknowledge(p.registration!))
        return p
    }
    func testPermissionAndConsentAreRequired() {
        var p = ObservationPushPolicy(); p.session(owner); p.token(token); p.transport(true)
        XCTAssertNil(p.registration)
        p.consent(true); XCTAssertNil(p.registration)
        p.permission(.denied); XCTAssertNil(p.registration)
        p.permission(.granted); XCTAssertNotNil(p.registration)
        XCTAssertFalse(p.canDisplay(event))
    }
    func testLateAcknowledgementCannotUndoOptOut() {
        var p = ready(); let attempt = p.registration!
        p.consent(false)
        XCTAssertFalse(p.acknowledge(attempt)); XCTAssertFalse(p.canDisplay(event))
    }
    func testTokenRotationRejectsOldAcknowledgement() {
        var p = ready(); let old = p.registration!
        p.token(PushToken(provider: .apns, value: "abcdef34", environment: .production))
        XCTAssertFalse(p.acknowledge(old)); XCTAssertFalse(p.canDisplay(event))
        XCTAssertTrue(p.acknowledge(p.registration!)); XCTAssertTrue(p.canDisplay(event))
    }
    func testAccountSwitchInvalidatesDeliveryAndNavigation() {
        var p = ready(); let old = p.registration!
        XCTAssertTrue(p.open(event)); p.session(PushAccount(id: "account-b", sessionRevision: 2))
        XCTAssertNil(p.pendingOpen); XCTAssertFalse(p.requested)
        XCTAssertFalse(p.acknowledge(old)); XCTAssertFalse(p.canDisplay(event)); XCTAssertFalse(p.open(event))
    }
    func testLogoutRejectsOldNotification() {
        var p = ready(); p.displayed(event); p.session(nil)
        XCTAssertFalse(p.open(event)); XCTAssertNil(p.registration)
    }
    func testRenewedSessionKeepsOwnPendingTapAndRejectsOldRegistration() {
        var p = ready(); p.open(event); let old = p.registration!
        let renewed = PushAccount(id: owner.id, sessionRevision: 2); p.session(renewed)
        XCTAssertEqual(event, p.pendingOpen); XCTAssertFalse(p.acknowledge(old))
        XCTAssertFalse(p.resolved(event, owner: owner)); XCTAssertTrue(p.resolved(event, owner: renewed))
    }
    func testDuplicateDeliveryAcrossTransportChanges() {
        var p = ready()
        XCTAssertTrue(p.displayed(event)); XCTAssertFalse(p.displayed(event))
        p.token(PushToken(provider: .apns, value: "aabbccdd", environment: .sandbox))
        p.acknowledge(p.registration!); XCTAssertFalse(p.canDisplay(event))
    }
    func testPermissionRevokedOrTransportUnavailable() {
        var p = ready(); let old = p.registration!
        p.permission(.denied)
        XCTAssertFalse(p.canDisplay(event)); XCTAssertFalse(p.acknowledge(old))
        p.permission(.granted); p.acknowledge(p.registration!); p.transport(false)
        XCTAssertFalse(p.canDisplay(event)); XCTAssertNotNil(p.registration)
    }
    func testMalformedTokensAndDestinationsAreRejected() {
        var p = ready()
        for value in ["", "a b", "a\n", "xyz"] {
            p.token(PushToken(provider: .apns, value: value, environment: .production))
            XCTAssertNil(p.registration)
        }
        XCTAssertFalse(PushToken(provider: .fcm, value: "token", environment: .sandbox).isValid)
        XCTAssertFalse(p.open(ObservationPush(eventId: "https://other.example/a", userId: owner.id)))
        XCTAssertFalse(p.open(ObservationPush(eventId: "../account", userId: owner.id)))
    }
    func testStaleResolverCannotNavigate() {
        var p = ready(); p.open(event)
        let second = ObservationPush(eventId: "event-2", userId: owner.id); p.open(second)
        XCTAssertFalse(p.resolved(event, owner: owner)); XCTAssertEqual(second, p.pendingOpen)
        p.session(PushAccount(id: "other", sessionRevision: 2))
        XCTAssertFalse(p.resolved(second, owner: owner))
    }
}
