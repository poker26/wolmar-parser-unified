import SwiftUI

struct WelcomeView: View {
    @ObservedObject var model: NumiModel
    @State private var login = false
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Text("Нуми").font(.system(size: 38, weight: .medium, design: .serif)).padding(.top, 26)
                ZStack {
                    Circle().fill(Cabinet.copper.opacity(0.12))
                    Circle().stroke(Cabinet.copper.opacity(0.6), lineWidth: 2).padding(18)
                    Text("Н").font(.system(size: 92, weight: .regular, design: .serif)).foregroundColor(Cabinet.copper)
                }.frame(maxWidth: 280).aspectRatio(1, contentMode: .fit)
                Text("У каждой монеты\nсвоя история").font(.system(size: 34, weight: .medium, design: .serif)).multilineTextAlignment(.center)
                Text("Ваша коллекция, каталог и история продаж").foregroundColor(Cabinet.muted).multilineTextAlignment(.center)
                Button {
                    Task { await model.startGuest(add: true) }
                } label: {
                    Label("Добавить монету", systemImage: "plus").frame(maxWidth: .infinity).padding(17)
                }.background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                Button {
                    Task { await model.startGuest(catalog: true) }
                } label: {
                    Label("Открыть каталог", systemImage: "book.closed").frame(maxWidth: .infinity).padding(17)
                }.overlay(RoundedRectangle(cornerRadius: 18).stroke(Cabinet.copper))
                Button("Уже есть аккаунт? Войти") { login = true }.padding(.top, 2)
                if let error = model.error { Text(error).foregroundColor(.orange).font(.callout) }
            }.padding(.horizontal, 24).padding(.bottom, 32).frame(maxWidth: 520)
        }.frame(maxWidth: .infinity).background(Cabinet.background.ignoresSafeArea())
            .sheet(isPresented: $login) { LoginView(model: model, dismissAfterSuccess: true) }
    }
}

struct NumiHomeView: View {
    @ObservedObject var model: NumiModel
    @State private var section: NumiSection
    @State private var adding: Bool
    @State private var account = false
    @State private var accountMode: AccountAction = .login
    @State private var quickFilter: CollectionQuickFilter?
    init(model: NumiModel) {
        self.model = model
        _section = State(initialValue: model.startInCatalog ? .catalog : .collection)
        _adding = State(initialValue: model.startWithAdd)
    }
    var body: some View {
        Group {
            switch section {
            case .collection: CollectionScreen(model: model, quickFilter: $quickFilter)
            case .catalog: CatalogBrowserView(model: model)
            case .overview: OverviewScreen(model: model) { filter in quickFilter = filter; section = .collection }
            case .profile: ProfileScreen(model: model,
                register: { accountMode = .register; account = true },
                login: { accountMode = .login; account = true })
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { NumiBottomBar(section: $section) { adding = true } }
        .background(Cabinet.background.ignoresSafeArea())
        .sheet(isPresented: $adding) { AddCoinView(model: model) }
        .sheet(isPresented: $account) { LoginView(model: model, initialMode: accountMode, dismissAfterSuccess: true) }
        .sheet(isPresented: $model.needsLogin) { LoginView(model: model, dismissAfterSuccess: true) }
    }
}

struct CollectionQuickFilter: Equatable {
    enum Kind { case country, metal }
    let kind: Kind
    let value: String
}

enum CollectionSort: String, CaseIterable, Identifiable {
    case recent, year, value, title
    var id: String { rawValue }
    var title: String {
        switch self { case .recent: return "Недавно добавленные"; case .year: return "По году"; case .value: return "По оценке"; case .title: return "По названию" }
    }
}

struct CollectionScreen: View {
    @ObservedObject var model: NumiModel
    @Binding var quickFilter: CollectionQuickFilter?
    @State private var query = ""
    @State private var sort: CollectionSort = .recent
    @State private var showSold = false
    @State private var listMode = false
    private var filtered: [Coin] {
        var result = model.coins.filter { showSold ? $0.status == "sold" : $0.isInCollection }
        if let filter = quickFilter {
            result = result.filter { coin in
                switch filter.kind {
                case .country: return coin.country == filter.value
                case .metal: return collectionMetalGroup(coin.metal) == filter.value
                }
            }
        }
        if !query.isEmpty { result = result.filter { ($0.title + " " + $0.caption).localizedCaseInsensitiveContains(query) } }
        switch sort {
        case .recent: result.sort { ($0.createdAt ?? "", $0.id) > ($1.createdAt ?? "", $1.id) }
        case .year: result.sort { ($0.year ?? -9999, $0.title) > ($1.year ?? -9999, $1.title) }
        case .value: result.sort { ($0.valuation?.amount ?? -1, $0.title) > ($1.valuation?.amount ?? -1, $1.title) }
        case .title: result.sort { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
        }
        return result
    }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .firstTextBaseline) {
                        Text("Коллекция").font(.system(size: 38, design: .serif))
                        Spacer(); Text("\(filtered.count) монет").foregroundColor(Cabinet.muted)
                    }
                    HStack(spacing: 12) {
                        Image(systemName: "magnifyingglass").foregroundColor(Cabinet.muted)
                        TextField("Найти в коллекции", text: $query).accessibilityIdentifier("album.search")
                        if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill") } }
                    }.padding(15).overlay(RoundedRectangle(cornerRadius: 18).stroke(Cabinet.muted.opacity(0.35)))
                    HStack {
                        Button { showSold.toggle(); quickFilter = nil } label: { Label(showSold ? "Проданные" : "Фильтры", systemImage: "slider.horizontal.3") }
                        Spacer()
                        Menu {
                            ForEach(CollectionSort.allCases) { option in Button(option.title) { sort = option } }
                            Button(showSold ? "Коллекция" : "Проданные") { showSold.toggle(); quickFilter = nil }
                        } label: { Text(sort.title).lineLimit(1); Image(systemName: "chevron.down") }
                        Button { listMode.toggle() } label: { Image(systemName: listMode ? "square.grid.2x2" : "list.bullet") }
                    }.foregroundColor(Cabinet.copper)
                    if let filter = quickFilter {
                        HStack { Text(filter.value); Spacer(); Button("Сбросить") { quickFilter = nil } }.padding(12).background(Cabinet.panel).cornerRadius(14)
                    }
                    if model.syncing { ProgressView(model.progress).frame(maxWidth: .infinity, alignment: .leading) }
                    if let error = model.error { ErrorBanner(text: error) { model.error = nil } }
                    if filtered.isEmpty {
                        VStack(spacing: 14) {
                            Image(systemName: "square.grid.2x2").font(.largeTitle).foregroundColor(Cabinet.copper)
                            Text(query.isEmpty ? "В этом разделе пока нет монет." : "Монеты не найдены.")
                        }.frame(maxWidth: .infinity).padding(.vertical, 70)
                    } else if listMode {
                        LazyVStack(spacing: 12) { ForEach(filtered) { coin in coinRow(coin) } }
                    } else {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 14, alignment: .top), GridItem(.flexible(), spacing: 14, alignment: .top)], spacing: 20) {
                            ForEach(filtered) { coin in coinTile(coin) }
                        }
                    }
                }.padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 24).frame(maxWidth: 760)
            }.frame(maxWidth: .infinity).background(Cabinet.background.ignoresSafeArea()).navigationBarHidden(true)
        }.navigationViewStyle(.stack)
    }
    private func coinTile(_ coin: Coin) -> some View {
        NavigationLink(destination: CoinDetailView(model: model, coinID: coin.id)) {
            AlbumCoinTile(model: model, coin: coin)
        }.buttonStyle(.plain).accessibilityIdentifier("coin.\(coin.id)")
    }
    private func coinRow(_ coin: Coin) -> some View {
        NavigationLink(destination: CoinDetailView(model: model, coinID: coin.id)) {
            HStack(spacing: 14) {
                CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: model.coverKey(coin), revision: model.mediaRevision)
                    .frame(width: 82, height: 82).cornerRadius(14)
                VStack(alignment: .leading, spacing: 6) {
                    Text(coin.title).foregroundColor(Cabinet.ivory).lineLimit(2)
                    Text(coin.caption).font(.caption).foregroundColor(Cabinet.muted)
                    if let amount = coin.valuation?.amount { Text((coin.valuation?.isFloor == true ? "≥ " : "≈ ") + money(amount)).foregroundColor(Cabinet.copper) }
                }
                Spacer(); Image(systemName: "chevron.right").foregroundColor(Cabinet.muted)
            }.padding(10).background(Cabinet.panel).cornerRadius(16)
        }.buttonStyle(.plain).accessibilityIdentifier("coin.\(coin.id)")
    }
}

struct OverviewScreen: View {
    @ObservedObject var model: NumiModel
    let select: (CollectionQuickFilter) -> Void
    private var active: [Coin] { model.coins.filter(\.isInCollection) }
    private var covered: [Coin] { active.filter { $0.valuation?.amount != nil } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Обзор коллекции").font(.system(size: 36, design: .serif))
                HStack(spacing: 12) {
                    metric("Монет", active.count)
                    metric("Стран", Set(active.compactMap(\.country)).count)
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Оценка").foregroundColor(Cabinet.muted)
                    Text(money(covered.reduce(0) { $0 + ($1.valuation?.amount ?? 0) })).font(.system(size: 32, design: .serif))
                    Text("Оценены \(covered.count) из \(active.count) монет").font(.caption).foregroundColor(Cabinet.muted)
                }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
                distribution("Металлы", values: active.compactMap { collectionMetalGroup($0.metal) }, kind: .metal)
                distribution("Страны", values: active.compactMap(\.country), kind: .country)
            }.padding(20).frame(maxWidth: 760)
        }.frame(maxWidth: .infinity).background(Cabinet.background.ignoresSafeArea())
    }
    private func metric(_ title: String, _ value: Int) -> some View {
        VStack(alignment: .leading) { Text(String(value)).font(.system(size: 32, design: .serif)); Text(title).foregroundColor(Cabinet.muted) }
            .frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
    }
    private func distribution(_ title: String, values: [String], kind: CollectionQuickFilter.Kind) -> some View {
        let rows = Dictionary(grouping: values, by: { $0 }).mapValues(\.count).sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }
        return VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.title3.weight(.medium)).padding(.bottom, 4)
            ForEach(rows, id: \.key) { row in
                NumiActionRow(title: row.key, detail: "\(row.value)") { select(CollectionQuickFilter(kind: kind, value: row.key)) }
                Divider()
            }
        }.cabinetPanel()
    }
}

struct ProfileScreen: View {
    @ObservedObject var model: NumiModel
    let register: () -> Void
    let login: () -> Void
    @State private var action: ProfileDataAction?
    @State private var sharing = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Профиль").font(.system(size: 36, design: .serif))
                HStack(spacing: 12) { Image(systemName: "person"); Text(model.user?.guest == true ? "Коллекция на этом устройстве" : model.user?.email ?? "") }
                if model.user?.guest == true {
                    Text("Создайте аккаунт, чтобы восстановить коллекцию после смены телефона и открывать её на других устройствах.").foregroundColor(Cabinet.muted)
                    Button("Создать аккаунт", action: register).frame(maxWidth: .infinity).padding(15).background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(16)
                    Button("Войти в аккаунт", action: login).frame(maxWidth: .infinity)
                } else {
                    NumiActionRow(title: "Синхронизировать", detail: model.pendingCoins.isEmpty ? nil : "Ожидают отправки: \(model.pendingCoins.count)") { Task { await model.sync() } }
                    if model.syncing { ProgressView().frame(maxWidth: .infinity) }
                    DisclosureGroup("Данные коллекции") {
                        VStack(spacing: 0) {
                            NumiActionRow(title: "Экспорт коллекции", detail: "Таблицы CSV и фотографии") { action = .export }
                            Divider()
                            Button("Удалить аккаунт", role: .destructive) { action = .delete }
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16)
                        }.padding(.top, 8)
                    }.cabinetPanel()
                    Button("Выйти из аккаунта", role: .destructive) { Task { await model.signOut() } }.padding(.top, 10)
                }
                Link(destination: URL(string: "https://coins.begemot26.ru/privacy.html")!) {
                    HStack { Text("Политика конфиденциальности"); Spacer(); Image(systemName: "arrow.up.right") }.padding(.vertical, 14)
                }
                Text("Нуми 1.0.0").font(.caption).foregroundColor(Cabinet.muted)
                if model.dataBusy { ProgressView().frame(maxWidth: .infinity) }
                if let notice = model.notice { Text(notice).foregroundColor(Cabinet.copper) }
                if let error = model.error { Text(error).foregroundColor(.orange) }
            }.padding(20).frame(maxWidth: 680, alignment: .leading)
        }.frame(maxWidth: .infinity).background(Cabinet.background.ignoresSafeArea())
            .sheet(item: $action) { selected in
                ProfilePasswordSheet(action: selected, busy: model.dataBusy) { password in
                    switch selected {
                    case .export:
                        await model.exportCollection(password: password)
                        action = nil
                        if model.exportFile != nil { sharing = true }
                    case .delete:
                        if await model.deleteAccount(password: password) { action = nil }
                    }
                }
            }
            .sheet(isPresented: $sharing) {
                if let file = model.exportFile { ActivityView(items: [file]) }
            }
    }
}

private enum ProfileDataAction: String, Identifiable {
    case export, delete
    var id: String { rawValue }
}

private struct ProfilePasswordSheet: View {
    let action: ProfileDataAction
    let busy: Bool
    let submit: (String) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    var body: some View {
        NavigationView {
            VStack(alignment: .leading, spacing: 20) {
                SecureField("Пароль", text: $password).textContentType(.password).cabinetPanel()
                Button {
                    Task { await submit(password) }
                } label: {
                    Text(action == .export ? "Подготовить архив" : "Удалить аккаунт")
                        .fontWeight(.semibold).frame(maxWidth: .infinity).padding(16)
                }.background(action == .delete ? Color.red.opacity(0.86) : Cabinet.copper)
                    .foregroundColor(Cabinet.background).cornerRadius(16).disabled(password.isEmpty || busy)
                Spacer()
            }.padding(22).background(Cabinet.background.ignoresSafeArea())
                .navigationTitle(action == .export ? "Экспорт коллекции" : "Удаление аккаунта")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() }.disabled(busy) } }
        }.preferredColorScheme(.dark).tint(Cabinet.copper).interactiveDismissDisabled(busy)
    }
}

private struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) { }
}
