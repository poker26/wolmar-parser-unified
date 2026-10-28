import Foundation

struct NotificationPreferences: Decodable {
    var emailEnabled: Bool
    var pushEnabled: Bool
    var events: [String: Bool]
}
struct NotificationCapabilities: Decodable { var email: Bool; var apns: Bool; var fcm: Bool }
func apnsTransportReady(_ capabilities: NotificationCapabilities?, environment: String) -> Bool {
    // The deployed provider has a production-only key. Sandbox needs separately advertised support.
    capabilities?.apns == true && environment == "production"
}
struct NotificationDevice: Decodable {
    var installationId: String; var platform: String; var provider: String
    var environment: String; var permission: String; var active: Bool
}
struct NotificationSettings: Decodable {
    var preferences: NotificationPreferences
    var capabilities: NotificationCapabilities
    var emailVerified: Bool
    var devices: [NotificationDevice]
    var revision: Int
}
struct NotificationDeviceInput: Encodable {
    var platform = "ios"; var provider = "apns"
    var token: String; var environment: String; var appVersion: String; var permission: String
}
struct NotificationDeviceAck: Decodable { var device: NotificationDevice; var revision: Int }
struct NotificationActionAck: Decodable { var ok: Bool }
struct ObservationEvent: Decodable { var id: String; var kind: String; var detectedAt: String? }
struct ObservationDestination: Decodable { var path: String }
struct NotificationPhoto: Decodable {
    var url: String?
    enum CodingKeys: String, CodingKey { case url }
    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) { url = value }
        else { url = try? decoder.container(keyedBy: CodingKeys.self).decodeIfPresent(String.self, forKey: .url) }
    }
}
struct ObservationLot: Decodable {
    var id: String
    var label: String?; var source: String?; var sourceName: String?; var sourceUrl: String?
    var priceMinor: Int64?; var currency: String?; var endsAt: String?
    var photos: [NotificationPhoto]
    enum CodingKeys: String, CodingKey { case id, label, source, sourceName, sourceUrl, priceMinor, currency, endsAt, photos }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let string = try? c.decode(String.self, forKey: .id) { id = string }
        else { id = String(try c.decode(Int64.self, forKey: .id)) }
        label = try c.decodeIfPresent(String.self, forKey: .label)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        sourceName = try c.decodeIfPresent(String.self, forKey: .sourceName)
        sourceUrl = try c.decodeIfPresent(String.self, forKey: .sourceUrl)
        priceMinor = try c.decodeIfPresent(Int64.self, forKey: .priceMinor)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        endsAt = try c.decodeIfPresent(String.self, forKey: .endsAt)
        photos = try c.decodeIfPresent([NotificationPhoto].self, forKey: .photos) ?? []
    }
}
struct ObservationEventDetails: Decodable {
    var event: ObservationEvent; var destination: ObservationDestination; var lot: ObservationLot?
}
struct NotificationFailure: LocalizedError {
    var status: Int
    var errorDescription: String? {
        status == 404 ? "Уведомление больше недоступно." : "Не удалось выполнить действие. Проверьте интернет и повторите."
    }
}
let notificationEventLabels: [(String, String)] = [
    ("new_offer", "Новые предложения"), ("price_changed", "Изменение цены"),
    ("ending_soon", "Скорое завершение торгов"), ("auction_ended", "Торги завершены"),
    ("availability_changed", "Изменение доступности")
]
func safeNotificationURL(_ value: String?) -> URL? {
    guard let value, let url = URL(string: value), url.scheme == "https", url.host?.isEmpty == false, url.user == nil, url.password == nil else { return nil }
    return url
}
