import SwiftUI

enum Cabinet {
    static let background = Color(red: 0.055, green: 0.059, blue: 0.071)
    static let panel = Color(red: 0.105, green: 0.110, blue: 0.127)
    static let ivory = Color(red: 0.96, green: 0.94, blue: 0.90)
    static let muted = Color(red: 0.67, green: 0.67, blue: 0.64)
    static let copper = Color(red: 0.88, green: 0.57, blue: 0.34)
    static let green = Color(red: 0.53, green: 0.72, blue: 0.60)
}
extension View {
    func cabinetPanel() -> some View { padding(18).background(Cabinet.panel).cornerRadius(20) }
}
struct ContentView: View {
    @StateObject private var model = NumiModel()
    var body: some View {
        Group {
            if model.loading { ProgressView("Открываем коллекцию…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if model.user == nil { LoginView(model: model) }
            else { AlbumView(model: model) }
        }
        .background(Cabinet.background.ignoresSafeArea())
        .foregroundColor(Cabinet.ivory).tint(Cabinet.copper).preferredColorScheme(.dark)
        .task { await model.bootstrap() }
    }
}
struct LoginView: View {
    @ObservedObject var model: NumiModel
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Нуми").font(.system(size: 54, design: .serif)).padding(.top, 72)
                Text("Ваша коллекция").font(.title3).foregroundColor(Cabinet.muted)
                VStack(spacing: 16) {
                    TextField("Электронная почта", text: $email)
                        .keyboardType(.emailAddress).textContentType(.username)
                        .autocapitalization(.none).disableAutocorrection(true)
                        .accessibilityIdentifier("login.email")
                    Divider()
                    SecureField("Пароль", text: $password).textContentType(.password)
                        .accessibilityIdentifier("login.password").onSubmit { submit() }
                }.cabinetPanel()
                if let error = model.error { Text(error).foregroundColor(.orange).font(.callout) }
                Button(action: submit) {
                    HStack {
                        Spacer()
                        if model.signingIn { ProgressView() } else { Text("Войти").fontWeight(.semibold) }
                        Spacer()
                    }.padding(18)
                }.background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                    .disabled(model.signingIn || email.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty)
                    .accessibilityIdentifier("login.submit")
            }.padding(28)
        }.background(Cabinet.background.ignoresSafeArea())
    }
    private func submit() {
        guard !email.isEmpty, !password.isEmpty else { return }
        Task { await model.signIn(email: email, password: password); if model.user != nil && !model.needsLogin { password = "" } }
    }
}

struct AlbumView: View {
    @ObservedObject var model: NumiModel
    @State private var query = ""
    @State private var shelf = "active"
    @State private var overview = false
    @State private var profile = false
    private var filtered: [Coin] {
        model.coins.filter { coin in
            coin.status == shelf && (query.isEmpty || (coin.title + " " + coin.caption).localizedCaseInsensitiveContains(query))
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
                    Picker("Раздел коллекции", selection: $shelf) {
                        Text("Альбом").tag("active"); Text("Продано").tag("sold"); Text("Архив").tag("archived")
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
    private var active: [Coin] { model.coins.filter { $0.status == "active" } }
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
                    distribution("Металлы", values: active.map { $0.catalog?.metal.map(metalName) ?? "Не указан" })
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
