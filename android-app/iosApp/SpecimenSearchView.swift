import SwiftUI

struct SpecimenSearchView: View {
    let api: NumiAPI
    let confirm: (SpecimenChoice) async throws -> Void
    var onSaved: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var query: String
    @State private var country: String
    @State private var year: String
    @State private var denomination: String
    @State private var metal: String
    @State private var results: [SpecimenChoice] = []
    @State private var selected: String?
    @State private var total = 0
    @State private var busy = false
    @State private var saving = false
    @State private var searched = false
    @State private var error: String?
    @State private var denominations: [SpecimenSearchFacet] = []
    @State private var choosingDenomination = false
    @State private var lastCriteria: [String]?
    private var criteria: [String] { [query, country, year, denomination, metal] }
    private var resultsAreCurrent: Bool { lastCriteria == criteria }

    init(api: NumiAPI, query: String = "", country: String = "", year: String = "",
         denomination: String = "", metal: String = "",
         confirm: @escaping (SpecimenChoice) async throws -> Void, onSaved: @escaping () -> Void = {}) {
        self.api = api; self.confirm = confirm; self.onSaved = onSaved
        _query = State(initialValue: query); _country = State(initialValue: collectionCountry(country) ?? country)
        _year = State(initialValue: year); _denomination = State(initialValue: denomination)
        _metal = State(initialValue: metal)
    }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    TextField("Название или сюжет", text: $query).cabinetPanel()
                        .submitLabel(.search).onSubmit { Task { await search() } }.accessibilityIdentifier("match.query")
                    CoinCountryField(text: $country, fieldID: "match.country").cabinetPanel()
                    HStack {
                        TextField("Год", text: $year).keyboardType(.numberPad).accessibilityIdentifier("match.year")
                        Divider()
                        TextField("Номинал", text: $denomination).accessibilityIdentifier("match.denomination")
                    }.cabinetPanel()
                    if resultsAreCurrent && !denominations.isEmpty {
                        Button("Выбрать номинал") { choosingDenomination = true }
                            .disabled(busy).accessibilityIdentifier("match.chooseDenomination")
                    }
                    DisclosureGroup("Металл") { TextField("Металл", text: $metal).padding(.top, 12) }.cabinetPanel()
                    Button("Найти") { Task { await search() } }.accessibilityIdentifier("match.search")
                    if busy { ProgressView().frame(maxWidth: .infinity) }
                    ForEach(resultsAreCurrent ? results : [], id: \.key) { choice in
                        Button { selected = choice.key } label: {
                            HStack(alignment: .top, spacing: 14) {
                                Image(systemName: selected == choice.key ? "checkmark.circle.fill" : "circle")
                                    .foregroundColor(Cabinet.copper)
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(choice.name)
                                    Text([collectionCountry(choice.country), choice.year.map(String.init), choice.denomination]
                                        .compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundColor(Cabinet.muted)
                                }
                                Spacer(minLength: 0)
                            }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
                        }.buttonStyle(.plain).accessibilityIdentifier("match.result.\(choice.key)")
                    }
                    if resultsAreCurrent && searched && !busy && results.isEmpty {
                        Text("Монеты не найдены.").foregroundColor(Cabinet.muted)
                        if !year.isEmpty {
                            Button("Показать другие годы") {
                                year = ""
                                Task { await search(yearOverride: "") }
                            }.accessibilityIdentifier("match.otherYears")
                        }
                    }
                    if resultsAreCurrent && results.count < total { Button("Показать ещё") { Task { await search(more: true) } } }
                    if let error { Text(error).foregroundColor(.orange).accessibilityIdentifier("match.error") }
                }.padding(20).frame(maxWidth: 760).frame(maxWidth: .infinity).disabled(saving)
            }.background(Cabinet.background.ignoresSafeArea())
                .navigationTitle("Найти монету").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) {
                    Button("Назад") { dismiss() }.disabled(saving).accessibilityIdentifier("match.back")
                } }
                .safeAreaInset(edge: .bottom) {
                    Button { Task { await saveSelection() } } label: {
                        Text(saving ? "Сохранение…" : "Это моя монета").fontWeight(.semibold)
                            .frame(maxWidth: .infinity).padding(18)
                    }.background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                        .disabled(selected == nil || busy || saving || !resultsAreCurrent).accessibilityIdentifier("match.confirm")
                        .padding(16).background(Cabinet.background)
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
            .interactiveDismissDisabled(saving).task { await search() }
            .sheet(isPresented: $choosingDenomination) {
                SpecimenDenominationPicker(options: denominations) { value in
                    denomination = value; choosingDenomination = false
                    Task { await search(denominationOverride: value) }
                }
            }
    }
    private func search(more: Bool = false, yearOverride: String? = nil, denominationOverride: String? = nil) async {
        let requested = [query, country, yearOverride ?? year, denominationOverride ?? denomination, metal]
        guard !busy, !saving, requested.contains(where: { $0.nonempty != nil }) else { return }
        guard requested[2].isEmpty || Int(requested[2]).map({ (1...9999).contains($0) }) == true else { error = "Проверьте год."; return }
        guard parseCoinDenomination(requested[3]).valid else { error = "Проверьте номинал."; return }
        busy = true; error = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        if !more { results = []; selected = nil; total = 0 }
        defer { busy = false }
        do {
            let page = try await api.searchSpecimens(query: requested[0], country: requested[1], year: requested[2],
                denomination: requested[3], metal: requested[4], offset: more ? results.count : 0)
            results = more ? results + page.items : page.items; total = page.total; searched = true
            denominations = page.denominations ?? []; lastCriteria = requested
        } catch { self.error = error.localizedDescription }
    }
    private func saveSelection() async {
        guard !saving, resultsAreCurrent, let choice = results.first(where: { $0.key == selected }) else { return }
        saving = true; error = nil
        defer { saving = false }
        do { try await confirm(choice); dismiss(); onSaved() }
        catch { self.error = error.localizedDescription }
    }
}

private struct SpecimenDenominationPicker: View {
    let options: [SpecimenSearchFacet]
    let select: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    var body: some View {
        NavigationView {
            VStack {
                TextField("Найти номинал", text: $query).padding(16)
                    .accessibilityIdentifier("denomination.search")
                List(options.filter { query.isEmpty || $0.value.localizedCaseInsensitiveContains(query) }) { option in
                    Button { select(option.value) } label: {
                        HStack { Text(option.value); Spacer(); Text(String(option.count)).foregroundColor(Cabinet.muted) }
                    }.accessibilityIdentifier("denomination.option.\(option.value)")
                }
            }.navigationTitle("Номинал").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Назад") { dismiss() } } }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
}
