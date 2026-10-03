import Foundation

struct MobileObservation: Codable, Equatable {
    let id: String
    let kind: String
    let occurredAt: String
    var itemId: String? = nil
    static func stableID(_ seed: String) -> String {
        let hex = String(LibraryDisk.hash(seed).prefix(32))
        let offsets = [0, 8, 12, 16, 20, 32]
        return (0..<5).map { index in
            let start = hex.index(hex.startIndex, offsetBy: offsets[index])
            let end = hex.index(hex.startIndex, offsetBy: offsets[index + 1])
            return String(hex[start..<end])
        }.joined(separator: "-")
    }
    static func active(account: String, now: Date = Date()) -> MobileObservation {
        let format = DateFormatter()
        format.locale = Locale(identifier: "en_US_POSIX")
        format.calendar = Calendar(identifier: .gregorian)
        format.timeZone = TimeZone(identifier: "Europe/Moscow")
        format.dateFormat = "yyyy-MM-dd"
        return MobileObservation(id: stableID("active:\(account):\(format.string(from: now))"), kind: "active",
            occurredAt: ISO8601DateFormatter().string(from: now))
    }
    static func added(item: String, occurredAt: String) -> MobileObservation {
        MobileObservation(id: stableID("coin-added:\(item)"), kind: "coin_added", occurredAt: occurredAt, itemId: item)
    }
}
struct MobileObservationBatch: Codable { let accountId: String; let events: [MobileObservation] }
struct MobileObservationAck: Codable { let acceptedIds: [String] }
struct MobileObservationQueue: Codable {
    var pending: [MobileObservation] = []
    var sent: Set<String> = []
    mutating func add(_ event: MobileObservation) {
        guard !sent.contains(event.id), !pending.contains(where: { $0.id == event.id }) else { return }
        pending.append(event)
    }
    mutating func acknowledge(_ ids: [String]) {
        let confirmed = Set(ids).intersection(pending.map(\.id))
        sent.formUnion(confirmed)
        pending.removeAll { confirmed.contains($0.id) }
    }
}
