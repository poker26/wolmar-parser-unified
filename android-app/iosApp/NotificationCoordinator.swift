import Foundation
import SwiftUI
import UserNotifications
import UIKit

@MainActor final class NotificationCoordinator: ObservableObject {
    static let shared = NotificationCoordinator()
    @Published private(set) var settings: NotificationSettings?
    @Published private(set) var details: ObservationEventDetails?
    @Published private(set) var pending: ObservationPush?
    @Published var showingSettings = false
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    @Published private(set) var notice: String?
    @Published private(set) var permission = PushPermission.notAsked
    private weak var model: NumiModel?
    private var policy = ObservationPushPolicy()
    private var token: String?
    private let tokenRequest = APNsTokenRequest()
    private var candidate: ObservationPush?
    private var operation: Task<Void, Never>?
    private var generation = 0
    private var refreshRequested = false
    private let defaults = UserDefaults.standard
    var configured: Bool { (Bundle.main.object(forInfoDictionaryKey: "NumiPushEnabled") as? String) == "YES" }
    var canEnablePush: Bool { configured && apnsTransportReady(settings?.capabilities, environment: environment) }
    var pushRequested: Bool { settings?.preferences.pushEnabled == true || policy.account.map { defaults.bool(forKey: "numi.push.enable." + $0.id) } == true }
    var visibleOwnerMatches: Bool { model?.user?.id == policy.account?.id && policy.account != nil && model?.needsLogin != true }
    private var environment: String {
        ["development", "sandbox"].contains(Bundle.main.object(forInfoDictionaryKey: "NumiAPNSEnvironment") as? String ?? "") ? "sandbox" : "production"
    }
    private var installation: String {
        if let value = defaults.string(forKey: "numi.push.installation"), UUID(uuidString: value) != nil { return value }
        let value = UUID().uuidString.lowercased(); defaults.set(value, forKey: "numi.push.installation"); return value
    }
    func attach(_ model: NumiModel) { self.model = model; refresh() }
    func invalidate(clearEnableIntent: Bool = false) {
        if clearEnableIntent, let owner = policy.account { defaults.removeObject(forKey: "numi.push.enable." + owner.id) }
        generation += 1; operation?.cancel(); operation = nil
        policy.session(nil); settings = nil; details = nil; pending = nil; candidate = nil
        busy = false; error = nil; notice = nil
        clearDelivered()
    }
    func refresh() {
        guard let model else { return }
        // Never keep the old account's detail visible while actor authentication catches up.
        if model.user?.id != policy.account?.id || model.needsLogin {
            let savedCandidate = candidate ?? pending
            invalidate(clearEnableIntent: model.user?.id != policy.account?.id); candidate = savedCandidate
        }
        guard !model.needsLogin, model.user?.guest == false else { return }
        if operation != nil { refreshRequested = true; return }
        perform { [self] api in
            guard let owner = await api.notificationOwner() else { return }
            policy.session(owner)
            if let event = candidate {
                candidate = nil
                if event.userId == owner.id { pending = event; policy.open(event) }
            }
            if let pending {
                if details?.event.id != pending.eventId { try await resolve(pending, owner: owner, api: api) }
                return
            }
            let status = await UNUserNotificationCenter.current().notificationSettings()
            permission = status.authorizationStatus == .authorized || status.authorizationStatus == .provisional ? .granted :
                status.authorizationStatus == .notDetermined ? .notAsked : .denied
            policy.permission(permission)
            let response = try await api.notificationSettings(owner: owner)
            try await ensureCurrent(owner, api: api)
            settings = response; policy.transport(apnsTransportReady(response.capabilities, environment: environment)); policy.consent(response.preferences.pushEnabled)
            if defaults.bool(forKey: "numi.push.disable." + owner.id) {
                settings?.preferences.pushEnabled = false; policy.consent(false)
                try await patch(["pushEnabled": false], owner: owner, api: api)
            }
            if defaults.bool(forKey: "numi.push.enable." + owner.id) && permission == .granted && canEnablePush {
                policy.consent(true)
                try await enablePush(owner, api: api)
            } else if settings?.preferences.pushEnabled == true && canEnablePush {
                try await register(owner, api: api)
            }
        }
    }
    func showSettings() { showingSettings = true; refresh() }
    func closeEvent() {
        operation?.cancel(); generation += 1; operation = nil; busy = false; refreshRequested = false
        pending = nil; candidate = nil; details = nil; error = nil; policy.dismiss(); refresh()
    }
    func retryEvent() { perform { [self] api in if let owner = policy.account, let pending { try await resolve(pending, owner: owner, api: api) } } }
    func accept(_ payload: [AnyHashable: Any]) {
        guard payload["v"] as? String == "1", let id = payload["eventId"] as? String, let user = payload["userId"] as? String else { return }
        let event = ObservationPush(eventId: id, userId: user)
        guard event.isValid else { return }
        if let current = model?.user?.id, current != user { return }
        if pending == event || details?.event.id == id { return }
        operation?.cancel(); generation += 1; operation = nil; busy = false; refreshRequested = false
        candidate = event
        if let owner = policy.account, owner.id == user { pending = event; policy.open(event) }
        refresh()
    }
    func foreground(_ payload: [AnyHashable: Any]) -> Bool {
        guard visibleOwnerMatches, payload["v"] as? String == "1",
              let id = payload["eventId"] as? String, let user = payload["userId"] as? String else { return false }
        let event = ObservationPush(eventId: id, userId: user)
        let key = user + "/" + id
        guard !defaults.bool(forKey: "numi.push.disable." + user) else { return false }
        var seen = defaults.stringArray(forKey: "numi.push.displayed") ?? []
        guard !seen.contains(key), policy.displayed(event) else { return false }
        seen.append(key); defaults.set(Array(seen.suffix(512)), forKey: "numi.push.displayed")
        return true
    }
    func receivedToken(_ value: Data) {
        let previous = token
        token = value.map { String(format: "%02x", $0) }.joined()
        policy.token(PushToken(provider: .apns, value: token!, environment: environment == "sandbox" ? .sandbox : .production))
        tokenRequest.received(value)
        if previous != token && (settings?.preferences.pushEnabled == true || pushRequested) {
            if operation == nil { refresh() } else { refreshRequested = true }
        }
    }
    func registrationFailed() { token = nil; policy.token(nil); tokenRequest.failed() }
    func prepareDeviceSettings() -> Bool {
        guard operation == nil, let owner = policy.account, visibleOwnerMatches, canEnablePush else { return false }
        objectWillChange.send()
        defaults.set(true, forKey: "numi.push.enable." + owner.id)
        defaults.removeObject(forKey: "numi.push.disable." + owner.id)
        return true
    }
    func setPush(_ value: Bool) {
        guard operation == nil else { return }
        if !value {
            if let owner = policy.account {
                defaults.set(true, forKey: "numi.push.disable." + owner.id)
                defaults.removeObject(forKey: "numi.push.enable." + owner.id)
            }
            settings?.preferences.pushEnabled = false
            policy.consent(false); clearDelivered(); UIApplication.shared.unregisterForRemoteNotifications()
        }
        perform { [self] api in
            guard let owner = policy.account else { return }
            if value {
                guard canEnablePush else { throw NotificationFailure(status: 503) }
                if permission == .notAsked {
                    let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
                    permission = granted ? .granted : .denied
                }
                policy.permission(permission)
                guard permission == .granted else {
                    defaults.removeObject(forKey: "numi.push.enable." + owner.id)
                    return
                }
                defaults.set(true, forKey: "numi.push.enable." + owner.id)
                defaults.removeObject(forKey: "numi.push.disable." + owner.id)
                policy.consent(true)
                try await enablePush(owner, api: api)
            } else {
                try await patch(["pushEnabled": false], owner: owner, api: api)
            }
        }
    }
    private func enablePush(_ owner: PushAccount, api: NumiAPI) async throws {
        try await register(owner, api: api)
        let latest = try await api.notificationSettings(owner: owner); try await ensureCurrent(owner, api: api); settings = latest
        try await patch(["pushEnabled": true], owner: owner, api: api)
    }
    func setEmail(_ value: Bool) {
        perform { [self] api in
            guard let owner = policy.account else { return }
            if value && settings?.emailVerified != true {
                try await api.requestNotificationEmail(owner: owner); try await ensureCurrent(owner, api: api)
                notice = "Подтвердите адрес по ссылке в письме."
            } else { try await patch(["emailEnabled": value], owner: owner, api: api) }
        }
    }
    func setEvent(_ key: String, value: Bool) {
        guard notificationEventLabels.contains(where: { $0.0 == key }) else { return }
        perform { [self] api in if let owner = policy.account { try await patch(["events": [key: value]], owner: owner, api: api) } }
    }
    private func register(_ owner: PushAccount, api: NumiAPI) async throws {
        let data = try await tokenRequest.request { UIApplication.shared.registerForRemoteNotifications() }
        try await ensureCurrent(owner, api: api)
        let token = data.map { String(format: "%02x", $0) }.joined()
        policy.token(PushToken(provider: .apns, value: token, environment: environment == "sandbox" ? .sandbox : .production))
        let attempt = policy.registration
        let input = NotificationDeviceInput(token: token, environment: environment,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            permission: permission == .granted ? "granted" : "denied")
        let response = try await api.registerNotificationDevice(owner: owner, installation: installation, input: input)
        try await ensureCurrent(owner, api: api)
        guard response.device.installationId == installation,
              response.device.provider == "apns", response.device.platform == "ios" else { throw NotificationFailure(status: 503) }
        if permission != .granted {
            guard !response.device.active else { throw NotificationFailure(status: 503) }
            return
        }
        guard response.device.active, let attempt else { throw NotificationFailure(status: 503) }
        guard policy.acknowledge(attempt) else { throw CancellationError() }
    }
    private func patch(_ patch: [String: Any], owner: PushAccount, api: NumiAPI) async throws {
        guard let revision = settings?.revision else { return }
        do {
            let response = try await api.patchNotificationSettings(owner: owner, revision: revision, patch: patch)
            try await ensureCurrent(owner, api: api); settings = response; policy.consent(response.preferences.pushEnabled)
            if patch["pushEnabled"] != nil {
                defaults.removeObject(forKey: "numi.push.disable." + owner.id)
                defaults.removeObject(forKey: "numi.push.enable." + owner.id)
            }
        } catch let failure as NotificationFailure where failure.status == 409 {
            let latest = try await api.notificationSettings(owner: owner); try await ensureCurrent(owner, api: api); settings = latest
            if defaults.bool(forKey: "numi.push.disable." + owner.id) { settings?.preferences.pushEnabled = false; policy.consent(false) }
            throw NumiError.server("Настройки изменились на другом устройстве. Повторите выбор.")
        }
    }
    private func resolve(_ event: ObservationPush, owner: PushAccount, api: NumiAPI) async throws {
        guard pending == event, event.userId == owner.id else { return }
        let response = try await api.notificationEvent(owner: owner, id: event.eventId)
        try await ensureCurrent(owner, api: api)
        if pending == event && response.event.id == event.eventId { details = response }
    }
    private func ensureCurrent(_ owner: PushAccount, api: NumiAPI) async throws {
        guard !Task.isCancelled, model?.user?.id == owner.id, model?.needsLogin != true,
              await api.notificationOwner() == owner else { throw CancellationError() }
    }
    private func perform(_ action: @escaping (NumiAPI) async throws -> Void) {
        guard operation == nil, let api = model?.api else { return }
        let token = generation
        busy = true; error = nil; notice = nil
        operation = Task { [self] in
            guard generation == token, !Task.isCancelled else { return }
            do { try await action(api) }
            catch is CancellationError { }
            catch { if generation == token { self.error = error.localizedDescription } }
            if generation == token {
                busy = false; operation = nil
                if refreshRequested { refreshRequested = false; refresh() }
            }
        }
    }
    private func clearDelivered() {
        UNUserNotificationCenter.current().getDeliveredNotifications { notifications in
            let ids = notifications.filter { $0.request.content.userInfo["eventId"] != nil }.map { $0.request.identifier }
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids)
        }
    }
}

final class NumiNotificationDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in NotificationCoordinator.shared.receivedToken(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in NotificationCoordinator.shared.registrationFailed() }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in NotificationCoordinator.shared.accept(response.notification.request.content.userInfo) }
        completionHandler()
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in
            completionHandler(NotificationCoordinator.shared.foreground(notification.request.content.userInfo) ? [.banner, .sound] : [])
        }
    }
}
