import SwiftUI
import UIKit

struct NotificationScreen: View {
    @ObservedObject var notifications: NotificationCoordinator
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if notifications.visibleOwnerMatches {
                    if notifications.busy { ProgressView().frame(maxWidth: .infinity) }
                    if notifications.pending != nil { eventContent } else { settingsContent }
                    if let notice = notifications.notice { Text(notice).foregroundColor(Cabinet.copper) }
                    if let error = notifications.error {
                        Text(error).foregroundColor(.orange)
                        Button("Повторить") { if notifications.pending != nil { notifications.retryEvent() } else { notifications.refresh() } }
                            .disabled(notifications.busy)
                    }
                    } else { ProgressView().frame(maxWidth: .infinity) }
                }.padding(20).frame(maxWidth: 680, alignment: .leading).frame(maxWidth: .infinity)
            }
            .background(Cabinet.background.ignoresSafeArea())
            .navigationTitle(notifications.pending == nil ? "Уведомления" : "Наблюдение")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Закрыть") { dismiss() } } }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
    @ViewBuilder private var settingsContent: some View {
        if let settings = notifications.settings {
            VStack(spacing: 18) {
                Toggle("По электронной почте", isOn: Binding(get: { settings.preferences.emailEnabled }, set: notifications.setEmail))
                    .disabled(notifications.busy || !settings.capabilities.email)
                Toggle("На устройствах", isOn: Binding(get: { notifications.pushRequested }, set: notifications.setPush))
                    .disabled(notifications.busy || (!notifications.canEnablePush && !settings.preferences.pushEnabled))
                if notifications.permission == .denied && notifications.canEnablePush {
                    Button("Разрешить на этом устройстве") {
                        if notifications.prepareDeviceSettings(), let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }.frame(maxWidth: .infinity, alignment: .leading).disabled(notifications.busy)
                }
            }.cabinetPanel()
            VStack(spacing: 18) {
                ForEach(notificationEventLabels, id: \.0) { key, label in
                    Toggle(label, isOn: Binding(get: { settings.preferences.events[key] == true }, set: { notifications.setEvent(key, value: $0) }))
                        .disabled(notifications.busy)
                }
            }.cabinetPanel()
        }
    }
    @ViewBuilder private var eventContent: some View {
        if let response = notifications.details {
            Text(notificationEventLabels.first { $0.0 == response.event.kind }?.1 ?? "Обновление наблюдения")
                .font(.headline)
            if let lot = response.lot {
                ForEach(Array(lot.photos.enumerated()), id: \.offset) { _, photo in
                    if let url = safeNotificationURL(photo.url) {
                        AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { ProgressView() }
                            .frame(maxWidth: .infinity, maxHeight: 320)
                    }
                }
                if let label = lot.label { Text(label).font(.system(size: 28, design: .serif)) }
                if let minor = lot.priceMinor {
                    Text(notificationPrice(minor, currency: lot.currency)).font(.title)
                }
                if let source = lot.sourceName { Text(source).foregroundColor(Cabinet.muted) }
                if let url = safeNotificationURL(lot.sourceUrl) { Link("Открыть предложение", destination: url).buttonStyle(.borderedProminent) }
            }
            if let destination = siteDestination(response.destination.path) {
                Link(response.destination.path == "/watch" ? "Открыть наблюдения на сайте" : "Открыть на сайте", destination: destination)
            }
        }
    }
    private func notificationPrice(_ minor: Int64, currency: String?) -> String {
        let format = NumberFormatter(); format.locale = Locale(identifier: "ru_RU"); format.numberStyle = .decimal; format.maximumFractionDigits = 2
        return (format.string(from: NSDecimalNumber(decimal: Decimal(minor) / 100)) ?? "") + " " + (currency ?? "")
    }
    private func siteDestination(_ path: String) -> URL? {
        guard path == "/watch" || path.range(of: "^/lots/[1-9][0-9]*(\\?typeId=[1-9][0-9]*)?$", options: .regularExpression) != nil else { return nil }
        return URL(string: "https://numi26.ru" + path)
    }
}
