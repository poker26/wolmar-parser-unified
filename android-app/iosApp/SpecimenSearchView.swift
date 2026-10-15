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
                    DisclosureGroup("Металл") { TextField("Металл", text: $metal).padding(.top, 12) }.cabinetPanel()
                    Button("Найти") { Task { await search() } }.accessibilityIdentifier("match.search")
                    if busy { ProgressView().frame(maxWidth: .infinity) }
                    ForEach(results, id: \.key) { choice in
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
                    if searched && !busy && results.isEmpty { Text("Монеты не найдены.").foregroundColor(Cabinet.muted) }
                    if results.count < total { Button("Показать ещё") { Task { await search(more: true) } } }
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
                        .disabled(selected == nil || busy || saving).accessibilityIdentifier("match.confirm")
                        .padding(16).background(Cabinet.background)
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
            .interactiveDismissDisabled(saving).task { await search() }
    }
    private func search(more: Bool = false) async {
        guard !busy, !saving, [query, country, year, denomination, metal].contains(where: { $0.nonempty != nil }) else { return }
        guard year.isEmpty || Int(year).map({ (1...9999).contains($0) }) == true else { error = "Проверьте год."; return }
        guard parseCoinDenomination(denomination).valid else { error = "Проверьте номинал."; return }
        busy = true; error = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        if !more { results = []; selected = nil; total = 0 }
        defer { busy = false }
        do {
            let page = try await api.searchSpecimens(query: query, country: country, year: year,
                denomination: denomination, metal: metal, offset: more ? results.count : 0)
            results = more ? results + page.items : page.items; total = page.total; searched = true
        } catch { self.error = error.localizedDescription }
    }
    private func saveSelection() async {
        guard !saving, let choice = results.first(where: { $0.key == selected }) else { return }
        saving = true; error = nil
        defer { saving = false }
        do { try await confirm(choice); dismiss(); onSaved() }
        catch { self.error = error.localizedDescription }
    }
}
