import Foundation
import SwiftUI

enum CollectionSort: String, Codable, CaseIterable, Identifiable {
    case recent, oldest, year, yearAscending, value, valueAscending, title
    var id: String { rawValue }
    var title: String {
        switch self {
        case .recent: return "Недавно добавленные"
        case .oldest: return "Раньше добавленные"
        case .year: return "Сначала новые годы"
        case .yearAscending: return "Сначала старые годы"
        case .value: return "Сначала дорогие"
        case .valueAscending: return "Сначала недорогие"
        case .title: return "По названию"
        }
    }
}

struct CollectionBrowserState: Codable, Equatable {
    var query = ""
    var countries: Set<String> = []
    var metals: Set<String> = []
    var yearFrom = ""
    var yearTo = ""
    var denomination = ""
    var grade = ""
    var unlinked = false
    var showSold = false
    var sort: CollectionSort = .recent
    var listMode = false
    var anchorID: String?
    var filterCount: Int {
        countries.count + metals.count + [!yearFrom.isEmpty || !yearTo.isEmpty,
            !denomination.isEmpty, !grade.isEmpty, unlinked].filter { $0 }.count
    }
    mutating func clearFilters() {
        countries = []; metals = []; yearFrom = ""; yearTo = ""; denomination = ""; grade = ""; unlinked = false
        anchorID = nil
    }
    mutating func selectOverview(_ filter: CollectionQuickFilter) {
        clearFilters(); query = ""; showSold = false
        switch filter.kind {
        case .country: countries = [collectionCountry(filter.value) ?? filter.value]
        case .metal: metals = [filter.value]
        }
    }
}

func collectionSearchText(_ text: String) -> String {
    text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "ru_RU"))
        .replacingOccurrences(of: "ё", with: "е").trimmingCharacters(in: .whitespacesAndNewlines)
}
private let collectionCountryAliases: [String: String] = {
    var result: [String: String] = [:]
    let russian = Locale(identifier: "ru_RU"), english = Locale(identifier: "en_US")
    for code in Locale.isoRegionCodes {
        guard let name = russian.localizedString(forRegionCode: code) else { continue }
        for alias in [code, name, english.localizedString(forRegionCode: code) ?? ""] where !alias.isEmpty {
            result[collectionSearchText(alias)] = name
        }
    }
    for alias in ["СССР", "USSR", "Soviet Union"] { result[collectionSearchText(alias)] = "СССР" }
    for alias in ["Россия", "Russia", "Russian Federation"] { result[collectionSearchText(alias)] = "Россия" }
    for alias in ["Кот-д-Ивуар", "Кот д Ивуар", "Côte d’Ivoire", "Cote d'Ivoire", "Ivory Coast"] {
        result[collectionSearchText(alias)] = "Кот-д-Ивуар"
    }
    return result
}()
func collectionCountry(_ raw: String?) -> String? {
    guard let text = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
    return collectionCountryAliases[collectionSearchText(text)] ?? text
}
private let collectionCountrySearchWords = Dictionary(grouping: collectionCountryAliases, by: { $0.value })
    .mapValues { $0.map(\.key).joined(separator: " ") }
func collectionCountLabel(_ count: Int, accusative: Bool = false) -> String {
    let ending = (11...14).contains(count % 100) ? "монет" : count % 10 == 1 ? (accusative ? "монету" : "монета") : (2...4).contains(count % 10) ? "монеты" : "монет"
    return "\(count) \(ending)"
}
func collectionMatchesDenomination(_ coin: Coin, _ raw: String) -> Bool {
    let wanted = collectionSearchText(raw).replacingOccurrences(of: ",", with: ".")
    if wanted.isEmpty { return true }
    if let number = Decimal(string: wanted, locale: Locale(identifier: "en_US_POSIX")),
       wanted.range(of: #"^[0-9]+(?:\.[0-9]+)?$"#, options: .regularExpression) != nil {
        let leading = coin.title.range(of: #"^\s*[0-9]+(?:[.,][0-9]+)?"#, options: .regularExpression).map { String(coin.title[$0]) }
        let value = coin.properties?.value("denominationValue", fallback: leading)
        return value.flatMap { Decimal(string: $0.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces), locale: Locale(identifier: "en_US_POSIX")) } == number
    }
    let text = collectionSearchText([coin.properties?.value("denominationValue"), coin.properties?.value("denominationUnit"),
        coin.catalog?.denomination, coin.title].compactMap { $0 }.joined(separator: " "))
    return wanted.split(whereSeparator: { $0.isWhitespace }).allSatisfy { text.contains($0) }
}
func filterCollection(_ coins: [Coin], state: CollectionBrowserState) -> [Coin] {
    let tokens = collectionSearchText(state.query).components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
    let result = coins.filter { coin in
        guard state.showSold ? coin.status == "sold" : coin.isInCollection else { return false }
        let country = collectionCountry(coin.country), metal = collectionMetalGroup(coin.metal)
        if !state.countries.isEmpty && !state.countries.contains(country ?? "") { return false }
        if !state.metals.isEmpty && !state.metals.contains(metal ?? "") { return false }
        if !state.yearFrom.isEmpty && (coin.year == nil || coin.year! < (Int(state.yearFrom) ?? Int.max)) { return false }
        if !state.yearTo.isEmpty && (coin.year == nil || coin.year! > (Int(state.yearTo) ?? Int.min)) { return false }
        if !state.grade.isEmpty && collectionSearchText(coin.gradeCode ?? "") != collectionSearchText(state.grade) { return false }
        if state.unlinked && coin.typeId != nil { return false }
        guard collectionMatchesDenomination(coin, state.denomination) else { return false }
        let countryWords = country.flatMap { collectionCountrySearchWords[$0] }
        let text = collectionSearchText([coin.title, coin.userLabel, coin.country, country, countryWords, coin.metal, metal,
            coin.year.map(String.init), coin.notes, coin.gradeCode, coin.properties?.value("subject"),
            coin.properties?.value("denominationValue"), coin.properties?.value("denominationUnit"),
            coin.properties?.value("finish"), coin.catalog?.cbrNumber, coin.catalog?.bitkinNumber].compactMap { $0 }.joined(separator: " "))
        return tokens.allSatisfy { token in
            [token, collectionCountry(token), collectionMetalGroup(token)].compactMap { $0 }
                .contains { text.contains(collectionSearchText($0)) }
        }
    }
    return result.sorted { left, right in
        switch state.sort {
        case .recent: return (left.createdAt ?? "", left.id) > (right.createdAt ?? "", right.id)
        case .oldest: return (left.createdAt ?? "", left.id) < (right.createdAt ?? "", right.id)
        case .year: return (left.year ?? Int.min, left.id) > (right.year ?? Int.min, right.id)
        case .yearAscending: return (left.year ?? Int.max, left.id) < (right.year ?? Int.max, right.id)
        case .value: return (left.valuation?.amount ?? -1, left.id) > (right.valuation?.amount ?? -1, right.id)
        case .valueAscending: return (left.valuation?.amount ?? Int64.max, left.id) < (right.valuation?.amount ?? Int64.max, right.id)
        case .title:
            let comparison = left.title.localizedCaseInsensitiveCompare(right.title)
            return comparison == .orderedSame ? left.id < right.id : comparison == .orderedAscending
        }
    }
}

struct CollectionFilterSheet: View {
    let coins: [Coin]
    let apply: (CollectionBrowserState) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var draft: CollectionBrowserState
    init(coins: [Coin], state: CollectionBrowserState, apply: @escaping (CollectionBrowserState) -> Void) {
        self.coins = coins; self.apply = apply; _draft = State(initialValue: state)
    }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Picker("Монеты", selection: $draft.showSold) { Text("Коллекция").tag(false); Text("Проданные").tag(true) }.pickerStyle(.segmented)
                    choices("Страны", values: Set(coins.compactMap { collectionCountry($0.country) }).sorted(), selected: $draft.countries)
                    choices("Металлы", values: Set(coins.compactMap { collectionMetalGroup($0.metal) }).sorted(), selected: $draft.metals)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Год").font(.title3)
                        HStack {
                            TextField("С", text: $draft.yearFrom).keyboardType(.numberPad).accessibilityIdentifier("filters.yearFrom")
                            TextField("По", text: $draft.yearTo).keyboardType(.numberPad).accessibilityIdentifier("filters.yearTo")
                        }
                        Divider()
                        TextField("Номинал", text: $draft.denomination).accessibilityIdentifier("filters.denomination")
                        Divider()
                        TextField("Состояние или грейд", text: $draft.grade).accessibilityIdentifier("filters.grade")
                            .textInputAutocapitalization(.characters)
                        Divider()
                        Toggle("Без каталожного определения", isOn: $draft.unlinked).accessibilityIdentifier("filters.unlinked")
                    }.cabinetPanel()
                }.padding(20).frame(maxWidth: 760).frame(maxWidth: .infinity)
            }.background(Cabinet.background.ignoresSafeArea())
                .navigationTitle("Фильтры").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.accessibilityIdentifier("filters.cancel") }
                    ToolbarItem(placement: .primaryAction) { Button("Сбросить") { draft.clearFilters() }.accessibilityIdentifier("filters.reset") }
                }
                .safeAreaInset(edge: .bottom) {
                    Button {
                        draft.anchorID = nil; apply(draft); dismiss()
                    } label: { Text("Показать \(collectionCountLabel(filterCollection(coins, state: draft).count, accusative: true))").frame(maxWidth: .infinity).padding(18) }
                        .background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                        .accessibilityIdentifier("filters.apply").padding(16).background(Cabinet.background)
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
    private func choices(_ title: String, values: [String], selected: Binding<Set<String>>) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3)
            ForEach(values, id: \.self) { value in
                Button {
                    if selected.wrappedValue.contains(value) { selected.wrappedValue.remove(value) }
                    else { selected.wrappedValue.insert(value) }
                } label: {
                    HStack { Text(value); Spacer(); Image(systemName: selected.wrappedValue.contains(value) ? "checkmark.circle.fill" : "circle") }
                        .foregroundColor(selected.wrappedValue.contains(value) ? Cabinet.copper : Cabinet.ivory)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("filters.choice.\(value)")
            }
        }.cabinetPanel()
    }
}
