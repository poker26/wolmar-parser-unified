import XCTest
@testable import Numi

final class NotificationContractTests: XCTestCase {
    func testPreferencesPreserveUnknownFieldsAndFutureEventKinds() throws {
        let data = Data(#"{"preferences":{"emailEnabled":false,"pushEnabled":true,"events":{"new_offer":true,"future":false}},"capabilities":{"email":true,"apns":true,"fcm":false},"emailVerified":true,"devices":[],"revision":7,"extra":1}"#.utf8)
        let settings = try JSONDecoder().decode(NotificationSettings.self, from: data)
        XCTAssertEqual(settings.revision, 7); XCTAssertTrue(settings.preferences.pushEnabled)
        XCTAssertEqual(settings.preferences.events["future"], false)
    }
    func testEventAcceptsNumericLotIdAndBothPhotoShapes() throws {
        let data = Data(#"{"event":{"id":"event-1","kind":"new_offer","detectedAt":"2026-10-27T12:00:00Z"},"destination":{"path":"/lots/17?typeId=3"},"lot":{"id":17,"label":"Монета","priceMinor":12345,"currency":"RUB","photos":["https://example.org/one.jpg",{"url":"https://example.org/two.jpg"}]}}"#.utf8)
        let value = try JSONDecoder().decode(ObservationEventDetails.self, from: data)
        XCTAssertEqual(value.lot?.id, "17"); XCTAssertEqual(value.lot?.priceMinor, 12345)
        XCTAssertEqual(value.lot?.photos.compactMap(\.url).count, 2)
    }
    func testEventWithoutLotStillResolvesToObservation() throws {
        let data = Data(#"{"event":{"id":"event-1","kind":"auction_ended"},"destination":{"path":"/watch"},"lot":null}"#.utf8)
        let value = try JSONDecoder().decode(ObservationEventDetails.self, from: data)
        XCTAssertNil(value.lot); XCTAssertEqual(value.destination.path, "/watch")
    }
    func testExternalLinksRequireHttpsAndNoCredentials() {
        XCTAssertNotNil(safeNotificationURL("https://example.org/lot/3"))
        for value in ["http://example.org", "javascript:alert(1)", "https://user:pass@example.org", "/watch", "https:///wrong"] {
            XCTAssertNil(safeNotificationURL(value))
        }
    }
    func testProductionProviderDoesNotAdvertiseSandboxReadiness() {
        let capabilities = NotificationCapabilities(email: true, apns: true, fcm: true)
        XCTAssertTrue(apnsTransportReady(capabilities, environment: "production"))
        XCTAssertFalse(apnsTransportReady(capabilities, environment: "sandbox"))
        XCTAssertFalse(apnsTransportReady(nil, environment: "production"))
    }
    func testDeviceRegistrationEncodesEveryRequiredField() throws {
        let input = NotificationDeviceInput(token: String(repeating: "ab", count: 32), environment: "production", appVersion: "1.1.7", permission: "granted")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: String])
        XCTAssertEqual(Set(object.keys), Set(["platform", "provider", "token", "environment", "appVersion", "permission"]))
        XCTAssertEqual(object["platform"], "ios"); XCTAssertEqual(object["provider"], "apns")
    }
}
