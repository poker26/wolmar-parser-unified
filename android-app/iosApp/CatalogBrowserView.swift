import SwiftUI

@MainActor final class CatalogBrowserModel: ObservableObject {
    @Published var countries: [CatalogCountry] = []
    @Published var country: CatalogCountry?
    @Published var countryQuery = ""
    @Published var query = ""
    @Published var year = ""
    @Published var denomination = ""
    @Published var page: CatalogPage?
    @Published var selectedID: Int64?
    @Published var details: [Int64: CatalogDetail] = [:]
    @Published var markets: [Int64: MarketEvidence] = [:]
    @Published var loading = false
    @Published var error: String?
    let app: NumiModel
    init(app: NumiModel) { self.app = app }
    func loadCountries() async {
        guard countries.isEmpty, !loading else { return }
        loading = true; error = nil; defer { loading = false }
        do { countries = try await app.api.catalogCountries() }
        catch { self.error = "Не удалось загрузить страны." }
    }
    func search(reset: Bool = true) async {
        guard !loading else { return }
        if !year.isEmpty, Int(year).map({ (1...9999).contains($0) }) != true { error = "Проверьте год."; return }
        if !denomination.isEmpty, Double(denomination.replacingOccurrences(of: ",", with: ".")).map({ $0 > 0 }) != true { error = "Проверьте номинал."; return }
        loading = true; error = nil; defer { loading = false }
        do {
            let offset = reset ? 0 : (page?.items.count ?? 0)
            let result = try await app.api.browseCatalog(country: country?.value ?? "", year: year,
                denomination: denomination, query: query, offset: offset)
            if reset { page = result }
            else { page = CatalogPage(total: result.total, items: (page?.items ?? []) + result.items.filter { next in !(page?.items.contains { $0.id == next.id } ?? false) }) }
        } catch { self.error = "Не удалось загрузить каталог. Повторите запрос." }
    }
    func open(_ id: Int64) async {
        selectedID = id; error = nil
        guard details[id] == nil else { return }
        loading = true; defer { loading = false }
        do { details[id] = try await app.api.catalogDetail(id) }
        catch { self.error = "Не удалось загрузить карточку." }
    }
    func loadMarket(_ id: Int64) async {
        guard markets[id] == nil, !loading else { return }
        loading = true; error = nil; defer { loading = false }
        do { markets[id] = try await app.api.catalogMarket(id) }
        catch { self.error = "Не удалось загрузить проходы." }
    }
    func resetToCountries() {
        country = nil; page = nil; year = ""; denomination = ""; error = nil
    }
}

struct CatalogBrowserView: View {
    @StateObject private var browser: CatalogBrowserModel
    init(model: NumiModel) { _browser = StateObject(wrappedValue: CatalogBrowserModel(app: model)) }
    var body: some View {
        NavigationView {
            Group {
                if let id = browser.selectedID { CatalogBrowseDetailView(browser: browser, id: id) }
                else { directory }
            }.background(Cabinet.background.ignoresSafeArea())
        }.navigationViewStyle(.stack).task { await browser.loadCountries() }
    }
    private var directory: some View {
        VStack(spacing: 0) {
            HStack {
                if browser.country != nil || browser.page != nil { Button { browser.resetToCountries() } label: { Image(systemName: "chevron.left") } }
                Spacer(); Text("Каталог").font(.system(size: 25, weight: .medium, design: .serif)); Spacer()
                if browser.country != nil || browser.page != nil { Color.clear.frame(width: 20) }
            }.padding(.horizontal, 20).padding(.vertical, 14)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    HStack {
                        TextField("Название или сюжет", text: $browser.query).submitLabel(.search)
                            .onSubmit { Task { await browser.search() } }
                        Button { Task { await browser.search() } } label: { Image(systemName: "magnifyingglass").font(.title2) }
                            .accessibilityIdentifier("catalog.find")
                    }.padding(15).overlay(RoundedRectangle(cornerRadius: 16).stroke(Cabinet.muted.opacity(0.35)))
                    if let country = browser.country { Text(country.name).font(.system(size: 31, design: .serif)) }
                    DisclosureGroup("Год и номинал") {
                        HStack {
                            TextField("Год", text: $browser.year).keyboardType(.numberPad)
                            Divider(); TextField("Номинал", text: $browser.denomination).keyboardType(.decimalPad)
                        }.padding(14).background(Cabinet.panel).cornerRadius(14)
                        Button("Найти") { Task { await browser.search() } }.padding(.top, 8)
                    }.tint(Cabinet.copper)
                    if browser.loading { ProgressView().frame(maxWidth: .infinity) }
                    if let error = browser.error { ErrorBanner(text: error) { browser.error = nil } }
                    if let page = browser.page {
                        Text("Найдено монет: \(page.total)").font(.headline)
                        ForEach(page.items) { type in
                            Button { Task { await browser.open(type.id) } } label: {
                                HStack(spacing: 13) {
                                    if let thumb = type.thumb?.nonempty {
                                        AuthenticatedRemoteImage(api: browser.app.api, address: thumb).frame(width: 88, height: 88).cornerRadius(12)
                                    }
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(type.name).foregroundColor(Cabinet.ivory).multilineTextAlignment(.leading)
                                        Text([type.year.map(String.init) ?? type.yearStart.map { "\($0)–\(type.yearEnd ?? $0)" }, collectionMetalGroup(type.metal)].compactMap { $0 }.joined(separator: " · "))
                                            .font(.caption).foregroundColor(Cabinet.muted)
                                        let count = owned(type)
                                        if count > 0 { Text("В коллекции: \(count)").font(.caption).foregroundColor(Cabinet.copper) }
                                    }
                                    Spacer(); Image(systemName: "chevron.right").foregroundColor(Cabinet.muted)
                                }.padding(12).background(Cabinet.panel).cornerRadius(16)
                            }.buttonStyle(.plain).accessibilityIdentifier("catalog.result.\(type.id)")
                        }
                        if page.items.count < page.total { Button("Показать ещё") { Task { await browser.search(reset: false) } }.frame(maxWidth: .infinity).padding(12) }
                    } else if browser.country == nil {
                        TextField("Страна", text: $browser.countryQuery).padding(15).overlay(RoundedRectangle(cornerRadius: 16).stroke(Cabinet.muted.opacity(0.35)))
                        ForEach(filteredCountries) { country in
                            NumiActionRow(title: country.name, detail: String(country.count)) {
                                browser.country = country; Task { await browser.search() }
                            }
                            Divider()
                        }
                    }
                }.padding(20).padding(.bottom, 18).frame(maxWidth: 760)
            }
        }.navigationBarHidden(true)
    }
    private var filteredCountries: [CatalogCountry] {
        guard !browser.countryQuery.isEmpty else { return browser.countries }
        return browser.countries.filter { country in
            country.name.localizedCaseInsensitiveContains(browser.countryQuery)
                || country.value.localizedCaseInsensitiveContains(browser.countryQuery)
                || (country.aliases ?? []).contains { $0.localizedCaseInsensitiveContains(browser.countryQuery) }
        }
    }
    private func owned(_ type: CatalogChoice) -> Int {
        let identities = Set((type.identityIds ?? []) + [type.id])
        return browser.app.coins.filter { $0.isInCollection && $0.typeId.map(identities.contains) == true }.count
    }
}

struct CatalogBrowseDetailView: View {
    @ObservedObject var browser: CatalogBrowserModel
    let id: Int64
    @State private var showMarket = false
    @State private var selectedIssue: Int64?
    @State private var showIssues = false
    @State private var saving = false
    @State private var saved = false
    private var detail: CatalogDetail? { browser.details[id] }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { if showMarket { showMarket = false } else { browser.selectedID = nil } } label: { Image(systemName: "chevron.left") }
                Spacer(); Text(showMarket ? "Оценка и проходы" : "Монета").font(.headline); Spacer(); Color.clear.frame(width: 20)
            }.padding(.horizontal, 20).padding(.vertical, 15)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let error = browser.error { ErrorBanner(text: error) { browser.error = nil } }
                    if showMarket {
                        if let market = browser.markets[id] { MarketCard(market: market) }
                        else { ProgressView().frame(maxWidth: .infinity).task { await browser.loadMarket(id) } }
                    } else if let detail {
                        let images = [detail.type.thumb, detail.type.reverseImage].compactMap { $0?.nonempty }
                        if !images.isEmpty {
                            TabView { ForEach(images, id: \.self) { address in AuthenticatedRemoteImage(api: browser.app.api, address: address).cornerRadius(18).padding(.bottom, 20) } }
                                .tabViewStyle(.page).frame(height: 310)
                        }
                        Text(detail.type.name).font(.system(size: 31, design: .serif))
                        let count = owned(detail.type)
                        if count > 0 { Text("В коллекции: \(count)").foregroundColor(Cabinet.copper) }
                        Button(saved ? "Добавлено" : count == 0 ? "Добавить в коллекцию" : "Добавить ещё экземпляр") {
                            saving = true
                            Task {
                                do { try await browser.app.addCatalog(detail, issue: issue); saved = true }
                                catch { browser.error = error.localizedDescription }
                                saving = false
                            }
                        }.disabled(saving || saved).frame(maxWidth: .infinity).padding(16).background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(16)
                        NumiActionRow(title: "Оценка и проходы") { showMarket = true; Task { await browser.loadMarket(id) } }
                        facts(detail)
                        if !detail.issues.isEmpty {
                            NumiActionRow(title: "Выпуски и разновидности", detail: issueCaption) { showIssues.toggle() }
                            if showIssues { ForEach(detail.issues) { option in
                                Button { selectedIssue = selectedIssue == option.id ? nil : option.id } label: {
                                    HStack { Image(systemName: selectedIssue == option.id ? "largecircle.fill.circle" : "circle"); VStack(alignment: .leading) { Text(issueName(option)); if let n = option.mintage { Text("Тираж: \(n.formatted())").font(.caption).foregroundColor(Cabinet.muted) } }; Spacer() }.padding(.vertical, 8)
                                }.buttonStyle(.plain)
                            } }
                        }
                    } else { ProgressView().frame(maxWidth: .infinity) }
                }.padding(20).padding(.bottom, 20).frame(maxWidth: 760)
            }
        }.navigationBarHidden(true).task { if detail == nil { await browser.open(id) } }
    }
    private var issue: CatalogIssue? { detail?.issues.first { $0.id == selectedIssue } }
    private var issueCaption: String { issue.map(issueName) ?? String(detail?.issues.count ?? 0) }
    private func issueName(_ issue: CatalogIssue) -> String { [issue.yearLabel ?? issue.year.map(String.init), issue.mint, issue.variety].compactMap { $0?.nonempty }.joined(separator: " · ") }
    private func owned(_ type: CatalogChoice) -> Int {
        let identities = Set((type.identityIds ?? []) + [type.id])
        return browser.app.coins.filter { $0.isInCollection && $0.typeId.map(identities.contains) == true }.count
    }
    private func facts(_ detail: CatalogDetail) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Выпуск").font(.title3.weight(.medium))
            NumiFact(label: "Страна", value: detail.type.country)
            NumiFact(label: "Год", value: issue?.yearLabel ?? (issue?.year ?? detail.type.year).map(String.init))
            NumiFact(label: "Период", value: detail.era)
            NumiFact(label: "Номинал", value: detail.type.denomination)
            NumiFact(label: "Монетный двор", value: issue?.mint ?? detail.mint)
            NumiFact(label: "Тираж", value: (issue?.mintage ?? detail.type.mintage).map { $0.formatted() })
            Text("Характеристики").font(.title3.weight(.medium)).padding(.top, 6)
            NumiFact(label: "Металл", value: collectionMetalGroup(detail.type.metal))
            NumiFact(label: "Состав", value: detail.type.composition)
            NumiFact(label: "Масса, г", value: detail.type.mass)
            NumiFact(label: "Диаметр, мм", value: detail.diameter)
            NumiFact(label: "Гурт", value: detail.edge)
            NumiFact(label: "Исполнение", value: detail.type.quality)
            Text("Каталожные номера").font(.title3.weight(.medium)).padding(.top, 6)
            NumiFact(label: "Банк России", value: detail.type.cbrNumber)
            NumiFact(label: "Биткин", value: detail.type.bitkinNumber)
            NumiFact(label: "Краузе (KM)", value: detail.kmNumber)
            if let subject = detail.type.subject?.nonempty, subject != detail.type.name { Text(subject) }
            if let design = detail.design?.nonempty { Text(design).foregroundColor(Cabinet.muted) }
        }.cabinetPanel()
    }
}
