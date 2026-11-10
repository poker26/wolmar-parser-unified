import SwiftUI

enum Cabinet {
    static let background = Color(red: 16/255, green: 17/255, blue: 20/255)
    static let panel = Color(red: 26/255, green: 27/255, blue: 32/255)
    static let ivory = Color(red: 245/255, green: 241/255, blue: 232/255)
    static let muted = Color(red: 185/255, green: 178/255, blue: 167/255)
    static let copper = Color(red: 217/255, green: 160/255, blue: 111/255)
    static let green = Color(red: 134/255, green: 199/255, blue: 160/255)
}
extension View {
    func cabinetPanel() -> some View { padding(18).background(Cabinet.panel).cornerRadius(20) }
    func sessionLoginOverlay(model: NumiModel) -> some View {
        modifier(SessionLoginOverlay(model: model))
    }
}
private struct SessionLoginOverlay: ViewModifier {
    @ObservedObject var model: NumiModel
    @State private var presenterID = UUID()
    func body(content: Content) -> some View {
        content.onAppear { model.activateSessionLoginPresenter(presenterID) }
            .onDisappear { model.deactivateSessionLoginPresenter(presenterID) }
            .overlay {
            if model.needsLogin && model.sessionLoginPresenter == presenterID {
                LoginView(model: model, reauthentication: true)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Cabinet.background.ignoresSafeArea())
            }
        }
    }
}
struct ContentView: View {
    @StateObject private var model = NumiModel.forApp()
    @ObservedObject private var notifications = NotificationCoordinator.shared
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        Group {
            if model.loading { ProgressView("Открываем коллекцию…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if model.user == nil { WelcomeView(model: model) }
            else { NumiHomeView(model: model).id(model.user?.id) }
        }
        .background(Cabinet.background.ignoresSafeArea())
        .foregroundColor(Cabinet.ivory).tint(Cabinet.copper).preferredColorScheme(.dark)
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-numi-open-notification-fixture") {
                notifications.accept(["v": "1", "eventId": "fixture-event", "userId": "ui-fixture"])
            }
            #endif
            notifications.attach(model); await model.bootstrap(); notifications.refresh()
        }
        .onChange(of: model.user?.id) { _ in notifications.refresh() }
        .onChange(of: model.needsLogin) { _ in notifications.refresh() }
        .sheet(isPresented: Binding(get: {
            let settingsRequested = notifications.showingSettings && model.user?.guest == false && !model.needsLogin
            return settingsRequested || notifications.visibleOwnerMatches && notifications.pending != nil
        }, set: { if !$0 { notifications.showingSettings = false; notifications.closeEvent() } })) {
            NotificationScreen(notifications: notifications).sessionLoginOverlay(model: model)
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { notifications.refresh(); Task { await model.recordForegroundActivity() } }
        }
    }
}
struct LoginView: View {
    @ObservedObject var model: NumiModel
    @Environment(\.dismiss) private var dismiss
    let dismissAfterSuccess: Bool
    let reauthentication: Bool
    @State private var email = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var code = ""
    @State private var mode: AccountAction
    @State private var recovering = false
    @State private var resetEmail: String?
    @State private var requestingCode = false
    @State private var formError: String?
    init(model: NumiModel, initialMode: AccountAction = .login, dismissAfterSuccess: Bool = false, reauthentication: Bool = false) {
        self.model = model
        self.dismissAfterSuccess = dismissAfterSuccess
        self.reauthentication = reauthentication
        _email = State(initialValue: reauthentication ? model.user?.email ?? "" : "")
        _mode = State(initialValue: initialMode)
    }
    private var busy: Bool { model.signingIn || requestingCode }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if reauthentication {
                    Button("Назад") { model.needsLogin = false; model.error = nil }
                        .disabled(busy).accessibilityIdentifier("login.cancel")
                }
                Text("Нуми").font(.system(size: 54, design: .serif)).padding(.top, 72)
                Text(recovering ? "Восстановить пароль" : mode == .register ? "Создать аккаунт" : reauthentication ? "Войдите снова" : "Ваша коллекция").font(.title3).foregroundColor(Cabinet.muted)
                VStack(spacing: 16) {
                    TextField("Электронная почта", text: $email)
                        .keyboardType(.emailAddress).textContentType(.username)
                        .autocapitalization(.none).disableAutocorrection(true)
                        .accessibilityIdentifier("login.email")
                        .disabled(resetEmail != nil)
                    if !recovering || resetEmail != nil {
                        if recovering {
                            Divider()
                            TextField("Код из письма", text: $code).textContentType(.oneTimeCode)
                                .autocapitalization(.allCharacters).disableAutocorrection(true)
                                .accessibilityIdentifier("auth.code")
                        }
                        Divider()
                        SecureField(recovering ? "Новый пароль" : "Пароль", text: $password)
                            .textContentType(mode == .login && !recovering ? .password : .newPassword)
                            .accessibilityIdentifier("login.password").onSubmit { submit() }
                        if mode != .login || recovering {
                            Divider()
                            SecureField("Повторите пароль", text: $confirmation).textContentType(.newPassword)
                                .accessibilityIdentifier("auth.confirmation")
                            Text("От 10 до 128 символов.").font(.caption).foregroundColor(Cabinet.muted)
                        }
                    }
                }.cabinetPanel()
                if let formError { Text(formError).foregroundColor(.orange).font(.callout).accessibilityIdentifier("auth.error") }
                if let error = model.error { Text(error).foregroundColor(.orange).font(.callout) }
                Button(action: submit) {
                    HStack {
                        Spacer()
                        if busy { ProgressView() }
                        else { Text(recovering ? (resetEmail == nil ? "Получить код" : "Сохранить пароль") : mode == .register ? "Зарегистрироваться" : "Войти").fontWeight(.semibold) }
                        Spacer()
                    }.padding(18)
                }.background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                    .disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("login.submit")
                if mode == .login && !recovering {
                    Button("Создать аккаунт") { switchMode(.register) }.accessibilityIdentifier("auth.register")
                    Button("Забыли пароль?") { switchMode(.reset); recovering = true }.accessibilityIdentifier("auth.forgot")
                } else {
                    if resetEmail != nil {
                        Button("Отправить код ещё раз") { requestCode() }.accessibilityIdentifier("auth.resend")
                        Button("Изменить почту") { resetEmail = nil; code = "" }
                    }
                    Button("Вернуться ко входу") { switchMode(.login) }.accessibilityIdentifier("auth.back")
                }
            }.padding(28)
                .disabled(busy)
        }.background(Cabinet.background.ignoresSafeArea())
    }
    private func submit() {
        if recovering && resetEmail == nil { requestCode(); return }
        formError = nil; model.error = nil
        do {
            try validateAccount(email: email, password: password, confirmation: confirmation, action: mode)
            if recovering && code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw NumiError.server("Введите код из письма.") }
        } catch { formError = error.localizedDescription; return }
        Task {
            await model.signIn(email: resetEmail ?? email, password: password, action: mode, code: code)
            if model.error == nil && model.user != nil && !model.needsLogin {
                password = ""; confirmation = ""; code = ""
                if dismissAfterSuccess { dismiss() }
            }
        }
    }
    private func switchMode(_ action: AccountAction) {
        mode = action; recovering = false; resetEmail = nil
        let fixturePassword = ProcessInfo.processInfo.arguments.contains("-numi-onboarding-fixture") && action != .login ? "test-password" : ""
        password = fixturePassword; confirmation = fixturePassword; code = ""; formError = nil; model.error = nil
    }
    private func requestCode() {
        guard !busy else { return }
        formError = nil; model.error = nil; requestingCode = true
        let address = (resetEmail ?? email).trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            defer { requestingCode = false }
            do { try await model.api.requestPasswordReset(email: address); resetEmail = address }
            catch { formError = error.localizedDescription }
        }
    }
}

struct ErrorBanner: View {
    let text: String; let dismiss: () -> Void
    var body: some View {
        HStack(alignment: .top) {
            Text(text).font(.callout); Spacer()
            Button(action: dismiss) { Image(systemName: "xmark") }.accessibilityLabel("Закрыть сообщение")
        }.padding(14).foregroundColor(.orange).background(Color.orange.opacity(0.08)).cornerRadius(14)
    }
}
struct CachedCoinImage: View {
    let disk: LibraryDisk; let account: String; let cacheKey: String?; let revision: Int
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            Cabinet.panel
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else {
                Circle().stroke(Cabinet.copper.opacity(0.25), lineWidth: 1).padding(20)
                Image(systemName: "photo").font(.title2).foregroundColor(Cabinet.muted)
            }
        }.task(id: account + (cacheKey ?? "") + String(revision)) {
            guard let cacheKey else { image = nil; return }
            let data = await disk.image(account: account, key: cacheKey)
            guard !Task.isCancelled else { return }
            image = data.flatMap { UIImage(data: $0) }
        }.accessibilityLabel(image == nil ? "Фото не загружено" : "Фото монеты")
    }
}
struct AlbumCoinTile: View {
    @ObservedObject var model: NumiModel
    let coin: Coin
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: model.coverKey(coin), revision: model.mediaRevision)
                .aspectRatio(1, contentMode: .fit).cornerRadius(18)
            Text(coin.title).font(.system(size: 16, weight: .medium)).lineLimit(3).multilineTextAlignment(.leading)
            Text(coin.caption).font(.caption).foregroundColor(Cabinet.muted).lineLimit(2)
            if model.pendingCoins.contains(where: { $0.id == coin.id }) {
                Label("Ожидает отправки", systemImage: "arrow.triangle.2.circlepath").font(.caption).foregroundColor(Cabinet.copper)
            }
            if let valuation = coin.currentValuationAvailability, let amount = valuation.amountMinor, let currency = valuation.currency {
                Text((valuation.isMetal ? "≥ " : "≈ ") + money(amount, currency: currency))
                    .font(.subheadline.weight(.semibold)).foregroundColor(valuation.isMetal ? Cabinet.copper : Cabinet.green)
            } else if let forecast = coin.currentForecast {
                Text("Прогноз \(money(forecast.medianMinor, currency: forecast.currency))")
                    .font(.subheadline.weight(.semibold)).foregroundColor(Cabinet.green)
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
