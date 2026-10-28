import Foundation

// Local policy; network DTOs and endpoints follow the agreed notification contract.
struct PushAccount: Equatable {
    var id: String
    var sessionRevision: Int
}
enum PushPermission { case notAsked, granted, denied }
enum PushProvider { case fcm, rustore, apns }
enum PushEnvironment { case production, sandbox }
struct PushToken: Equatable {
    var provider: PushProvider
    var value: String
    var environment: PushEnvironment
    var isValid: Bool {
        guard (1...4096).contains(value.count),
              value.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil else { return false }
        if provider != .apns { return environment == .production }
        return value.count % 2 == 0 && value.range(of: "^[0-9a-fA-F]+$", options: .regularExpression) != nil
    }
}
struct PushRegistrationAttempt: Equatable {
    var account: PushAccount
    var token: PushToken
    var revision: Int
}
struct ObservationPush: Equatable, Hashable {
    var eventId: String
    var userId: String
    var isValid: Bool {
        [eventId, userId].allSatisfy {
            $0.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", options: .regularExpression) != nil
        }
    }
}

/// Calls are serialized by the platform adapter. An old HTTP success cannot restore a revoked
/// registration or bind the current token to the wrong account after a session transition.
struct ObservationPushPolicy {
    private(set) var account: PushAccount?
    private(set) var permission = PushPermission.notAsked
    private(set) var requested = false
    private(set) var transportAvailable = false
    private(set) var token: PushToken?
    private(set) var pendingOpen: ObservationPush?
    private var revision = 0
    private var registered: PushRegistrationAttempt?
    private var displayed: [ObservationPush] = []

    mutating func session(_ value: PushAccount?) {
        guard account != value else { return }
        let sameOwner = value != nil && value?.id == account?.id
        invalidate(); account = value; requested = false
        if !sameOwner { pendingOpen = nil }
    }
    mutating func consent(_ value: Bool) {
        if requested != value { invalidate(); requested = value }
    }
    mutating func permission(_ value: PushPermission) {
        if permission != value { invalidate(); permission = value }
    }
    mutating func transport(_ value: Bool) {
        if transportAvailable != value { invalidate(); transportAvailable = value }
    }
    mutating func token(_ value: PushToken?) {
        let valid = value?.isValid == true ? value : nil
        if token != valid { invalidate(); token = valid }
    }
    var registration: PushRegistrationAttempt? {
        guard let account, let token, requested, permission == .granted else { return nil }
        return PushRegistrationAttempt(account: account, token: token, revision: revision)
    }
    @discardableResult mutating func acknowledge(_ attempt: PushRegistrationAttempt) -> Bool {
        guard attempt == registration else { return false }
        registered = attempt
        return true
    }
    func canDisplay(_ event: ObservationPush) -> Bool {
        event.isValid && event.userId == account?.id && transportAvailable && registered != nil &&
            registered == registration && !displayed.contains(event)
    }
    @discardableResult mutating func displayed(_ event: ObservationPush) -> Bool {
        guard canDisplay(event) else { return false }
        displayed.append(event)
        if displayed.count > 512 { displayed.removeFirst(displayed.count - 512) }
        return true
    }
    @discardableResult mutating func open(_ event: ObservationPush) -> Bool {
        guard event.isValid, event.userId == account?.id else { return false }
        pendingOpen = event
        return true
    }
    @discardableResult mutating func resolved(_ event: ObservationPush, owner: PushAccount) -> Bool {
        guard owner == account, event == pendingOpen, event.userId == owner.id else { return false }
        pendingOpen = nil
        return true
    }
    mutating func dismiss() { pendingOpen = nil }
    private mutating func invalidate() { revision += 1; registered = nil }
}
