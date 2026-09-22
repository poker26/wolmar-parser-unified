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
}
struct ContentView: View {
    @StateObject private var model = NumiModel.forApp()
    var body: some View {
        Group {
            if model.loading { ProgressView("Открываем коллекцию…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if model.user == nil { WelcomeView(model: model) }
            else { NumiHomeView(model: model) }
        }
        .background(Cabinet.background.ignoresSafeArea())
        .foregroundColor(Cabinet.ivory).tint(Cabinet.copper).preferredColorScheme(.dark)
        .task { await model.bootstrap() }
    }
}
struct LoginView: View {
    @ObservedObject var model: NumiModel
    @Environment(\.dismiss) private var dismiss
    let dismissAfterSuccess: Bool
    @State private var email = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var code = ""
    @State private var mode: AccountAction
    @State private var recovering = false
    @State private var resetEmail: String?
    @State private var requestingCode = false
    @State private var formError: String?
    init(model: NumiModel, initialMode: AccountAction = .login, dismissAfterSuccess: Bool = false) {
        self.model = model
        self.dismissAfterSuccess = dismissAfterSuccess
        _mode = State(initialValue: initialMode)
    }
    private var busy: Bool { model.signingIn || requestingCode }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Нуми").font(.system(size: 54, design: .serif)).padding(.top, 72)
                Text(recovering ? "Восстановить пароль" : mode == .register ? "Создать аккаунт" : "Ваша коллекция").font(.title3).foregroundColor(Cabinet.muted)
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
            if model.user != nil && !model.needsLogin {
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

struct AlbumView: View {
    @ObservedObject var model: NumiModel
    @State private var query = ""
    @State private var shelf = "active"
    @State private var overview = false
    @State private var profile = false
    @State private var adding = false
    private var filtered: [Coin] {
        model.coins.filter { coin in
            (shelf == "active" ? coin.isInCollection : coin.status == shelf) && (query.isEmpty || (coin.title + " " + coin.caption).localizedCaseInsensitiveContains(query))
        }
    }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Коллекция").font(.system(size: 36, design: .serif))
                        Spacer()
                        Text("\(filtered.count)").font(.title2).foregroundColor(Cabinet.muted)
                    }
                    Button { adding = true } label: { Label("Добавить монету", systemImage: "plus.circle.fill").frame(maxWidth: .infinity).padding(14) }
                        .background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(14)
                        .accessibilityIdentifier("album.add")
                    Picker("Раздел коллекции", selection: $shelf) {
                        Text("Альбом").tag("active"); Text("Продано").tag("sold")
                    }.pickerStyle(.segmented)
                    HStack {
                        Image(systemName: "magnifyingglass").foregroundColor(Cabinet.muted)
                        TextField("Поиск монеты", text: $query).accessibilityIdentifier("album.search")
                        if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel("Очистить поиск") }
                    }.padding(14).background(Cabinet.panel).cornerRadius(14)
                    if model.syncing { HStack { ProgressView(); Text(model.progress).font(.callout) } }
                    if let error = model.error { ErrorBanner(text: error) { model.error = nil } }
                    if filtered.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: query.isEmpty ? "square.grid.2x2" : "magnifyingglass").font(.largeTitle).foregroundColor(Cabinet.copper)
                            Text(query.isEmpty ? (model.syncing ? "Загружаем монеты…" : "В этом разделе пока нет монет.") : "Монеты не найдены.")
                            if model.library.cursor == nil && !model.syncing { Button("Синхронизировать") { Task { await model.sync() } } }
                        }.frame(maxWidth: .infinity).padding(.vertical, 60)
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 14, alignment: .top), GridItem(.flexible(), spacing: 14, alignment: .top)], spacing: 20) {
                            ForEach(filtered) { coin in
                                NavigationLink(destination: CoinDetailView(model: model, coinID: coin.id)) {
                                    AlbumCoinTile(model: model, coin: coin)
                                }.buttonStyle(.plain).accessibilityIdentifier("coin.\(coin.id)")
                            }
                        }
                    }
                }.padding(.horizontal, 20).padding(.bottom, 32)
            }.background(Cabinet.background.ignoresSafeArea())
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .navigationBarLeading) { Button { profile = true } label: { Image(systemName: "person.crop.circle") }.accessibilityLabel("Аккаунт") }
                    ToolbarItem(placement: .principal) { Text("Нуми").font(.system(size: 23, design: .serif)) }
                    ToolbarItemGroup(placement: .navigationBarTrailing) {
                        Button { overview = true } label: { Image(systemName: "chart.bar.xaxis") }.accessibilityLabel("Обзор коллекции")
                        Button { Task { await model.sync() } } label: { Image(systemName: "arrow.triangle.2.circlepath") }.disabled(model.syncing).accessibilityLabel("Синхронизировать")
                    }
                }
        }.navigationViewStyle(.stack)
            .sheet(isPresented: $overview) { OverviewView(model: model) }
            .sheet(isPresented: $profile) { ProfileView(model: model) }
            .sheet(isPresented: $adding) { AddCoinView(model: model) }
            .sheet(isPresented: $model.needsLogin) { LoginView(model: model) }
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
            if let valuation = coin.valuation, let amount = valuation.amount {
                Text((valuation.isFloor ? "≥ " : "≈ ") + money(amount, currency: valuation.currency ?? "RUB"))
                    .font(.subheadline.weight(.semibold)).foregroundColor(valuation.isFloor ? Cabinet.copper : Cabinet.green)
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }
}
struct OverviewView: View {
    @ObservedObject var model: NumiModel
    @Environment(\.dismiss) private var dismiss
    private var active: [Coin] { model.coins.filter { $0.isInCollection } }
    private var covered: [Coin] { active.filter { $0.valuation?.amount != nil && ($0.valuation?.currency ?? "RUB") == "RUB" } }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Обзор коллекции").font(.system(size: 32, design: .serif))
                    HStack(spacing: 24) { metric("Монет", active.count); metric("Стран", Set(active.compactMap { $0.catalog?.country?.nonempty }).count) }
                        .frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
                    if !covered.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Оценены \(covered.count) из \(active.count) монет").foregroundColor(Cabinet.muted)
                            Text(money(covered.reduce(0) { $0 + ($1.valuation?.amount ?? 0) })).font(.system(size: 32, design: .serif))
                            let floors = covered.filter { $0.valuation?.isFloor == true }.count
                            if floors > 0 { Text("По стоимости металла учтено \(floors) монет.").font(.callout).foregroundColor(Cabinet.copper) }
                        }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
                    }
                    distribution("Металлы", values: active.map { collectionMetalGroup($0.catalog?.metal) ?? "Не указан" })
                    distribution("Страны", values: active.map { $0.catalog?.country?.nonempty ?? "Не указана" })
                }.padding(22)
            }.background(Cabinet.background.ignoresSafeArea())
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
    private func metric(_ title: String, _ count: Int) -> some View {
        VStack(alignment: .leading) { Text(String(count)).font(.system(size: 36, design: .serif)); Text(title).foregroundColor(Cabinet.muted) }
    }
    private func distribution(_ title: String, values: [String]) -> some View {
        let grouped = Dictionary(grouping: values, by: { $0 }).mapValues(\.count).sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
        return VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.title3.weight(.medium))
            ForEach(grouped, id: \.key) { entry in
                VStack(spacing: 6) {
                    HStack { Text(entry.key); Spacer(); Text(String(entry.value)).foregroundColor(Cabinet.muted) }
                    GeometryReader { geometry in Capsule().fill(Cabinet.copper.opacity(0.55)).frame(width: geometry.size.width * CGFloat(entry.value) / CGFloat(max(values.count, 1))) }.frame(height: 3)
                }
            }
        }.cabinetPanel()
    }
}
struct ProfileView: View {
    @ObservedObject var model: NumiModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingLogout = false
    var body: some View {
        NavigationView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Аккаунт").font(.system(size: 34, design: .serif))
                Text(model.user?.email ?? "").textSelection(.enabled)
                if let date = model.library.syncedAt { Text("Синхронизировано \(date.formatted(date: .abbreviated, time: .shortened))").foregroundColor(Cabinet.muted) }
                Button("Синхронизировать") { Task { await model.sync() } }.disabled(model.syncing)
                Button("Выйти", role: .destructive) { confirmingLogout = true }
                Spacer()
            }.padding(24).frame(maxWidth: .infinity, alignment: .leading).background(Cabinet.background.ignoresSafeArea())
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } } }
                .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmingLogout, titleVisibility: .visible) {
                    Button("Выйти", role: .destructive) { dismiss(); Task { await model.signOut() } }
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
}
