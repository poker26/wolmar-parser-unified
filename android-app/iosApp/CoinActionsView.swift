import SwiftUI

struct EditCoinView: View {
    @ObservedObject var model: NumiModel
    let coin: Coin
    @Environment(\.dismiss) private var dismiss
    @State private var label: String
    @State private var year: String
    @State private var country: String
    @State private var denominationValue: String
    @State private var denominationUnit: String
    @State private var subject: String
    @State private var metal: String
    @State private var fineness: String
    @State private var mass: String
    @State private var massUnit: String
    @State private var finish: String
    @State private var grade: String
    @State private var purchasePrice: String
    @State private var purchaseDate: String
    @State private var purchaseSource: String
    @State private var notes: String
    @State private var saving = false
    @State private var error: String?
    init(model: NumiModel, coin: Coin) {
        self.model = model; self.coin = coin
        let p = coin.properties
        _label = State(initialValue: coin.userLabel ?? coin.typeName ?? "")
        _year = State(initialValue: p?.value("year") ?? coin.year.map(String.init) ?? "")
        _country = State(initialValue: p?.value("country", fallback: coin.catalog?.country) ?? "")
        _denominationValue = State(initialValue: p?.value("denominationValue") ?? "")
        _denominationUnit = State(initialValue: p?.value("denominationUnit") ?? "")
        _subject = State(initialValue: p?.value("subject", fallback: coin.catalog?.subject) ?? "")
        _metal = State(initialValue: p?.value("metal", fallback: coin.catalog?.metal) ?? "")
        _fineness = State(initialValue: p?.value("fineness") ?? "")
        _mass = State(initialValue: p?.value("mass", fallback: coin.catalog?.mass) ?? "")
        _massUnit = State(initialValue: p?.value("massUnit") ?? "g")
        _finish = State(initialValue: p?.value("finish", fallback: coin.catalog?.quality) ?? "")
        _grade = State(initialValue: coin.gradeCode ?? "")
        _purchasePrice = State(initialValue: coin.purchasePriceMinor.map { String(format: "%.2f", Double($0) / 100).replacingOccurrences(of: ".00", with: "") } ?? "")
        _purchaseDate = State(initialValue: coin.purchaseDate.map { String($0.prefix(10)) } ?? "")
        _purchaseSource = State(initialValue: coin.purchaseSource ?? "")
        _notes = State(initialValue: coin.notes ?? "")
    }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    section("Монета") {
                        field("Название", $label)
                        HStack { field("Страна", $country); field("Год", $year, .numberPad) }
                        HStack { field("Номинал", $denominationValue, .decimalPad); field("Валюта", $denominationUnit) }
                        field("Сюжет", $subject)
                    }
                    section("Характеристики") {
                        field("Металл", $metal)
                        HStack { field("Проба", $fineness, .decimalPad); field("Масса", $mass, .decimalPad) }
                        Picker("Единица массы", selection: $massUnit) { Text("г").tag("g"); Text("тр. унц.").tag("troy_oz") }.pickerStyle(.segmented)
                        field("Исполнение", $finish); field("Состояние или грейд", $grade)
                    }
                    section("Покупка") {
                        field("Цена, ₽", $purchasePrice, .decimalPad); field("Дата", $purchaseDate); field("Место", $purchaseSource)
                    }
                    section("Заметки") { field("Заметка", $notes) }
                    if let error { Text(error).foregroundColor(.orange) }
                }.padding(20).frame(maxWidth: 680)
            }.background(Cabinet.background.ignoresSafeArea()).navigationTitle("Изменить монету")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() }.disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button("Сохранить") { Task { await save() } }.disabled(saving) }
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 13) { Text(title).font(.title3.weight(.medium)); content() }.cabinetPanel()
    }
    private func field(_ title: String, _ value: Binding<String>, _ keyboard: UIKeyboardType = .default) -> some View {
        TextField(title, text: value).keyboardType(keyboard).padding(.vertical, 7)
    }
    private func save() async {
        error = nil
        let parsedYear = year.nonempty.flatMap { Int($0) }
        guard year.nonempty == nil || parsedYear.map({ (1...9999).contains($0) }) == true else { error = "Проверьте год."; return }
        let price: Int64?
        if let raw = purchasePrice.nonempty {
            guard let amount = Decimal(string: raw.replacingOccurrences(of: ",", with: ".")), amount >= 0 else { error = "Проверьте цену покупки."; return }
            price = NSDecimalNumber(decimal: amount * 100).int64Value
        } else { price = nil }
        var values = ["country": country, "year": year, "denominationValue": denominationValue,
            "denominationUnit": denominationUnit, "subject": subject, "metal": metal,
            "fineness": fineness, "mass": mass, "massUnit": massUnit, "finish": finish]
        values = values.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.value.isEmpty }
        let properties = CoinProperties(values: values, manualFields: Array(values.keys))
        let input = UpdateCoinInput(identifiedYear: parsedYear, userLabel: coin.typeId == nil ? label.nonempty : coin.userLabel,
            gradeCode: grade.nonempty?.uppercased(), purchasePriceMinor: price, purchaseCurrency: price == nil ? nil : "RUB",
            purchaseDate: purchaseDate.nonempty, purchaseSource: purchaseSource.nonempty, notes: notes.nonempty, properties: properties)
        saving = true; defer { saving = false }
        do { try await model.updateCoin(coin.id, input: input); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}

struct SaleCoinView: View {
    @ObservedObject var model: NumiModel
    let coin: Coin
    @Environment(\.dismiss) private var dismiss
    @State private var price = ""
    @State private var date = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        NavigationView {
            Form {
                Section("Продажа") {
                    TextField("Цена, ₽", text: $price).keyboardType(.decimalPad)
                    TextField("Дата", text: $date)
                }
                if let error { Text(error).foregroundColor(.orange) }
            }.navigationTitle("Отметить проданной")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Сохранить") { Task { await save() } }.disabled(busy) }
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
    private func save() async {
        let minor: Int64?
        if let raw = price.nonempty {
            guard let amount = Decimal(string: raw.replacingOccurrences(of: ",", with: ".")), amount >= 0 else { error = "Проверьте цену продажи."; return }
            minor = NSDecimalNumber(decimal: amount * 100).int64Value
        } else { minor = nil }
        busy = true; defer { busy = false }
        do { try await model.markSold(coin.id, price: minor, date: date.nonempty); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}

struct LinkedCatalogView: View {
    @ObservedObject var model: NumiModel
    let coin: Coin
    @Environment(\.dismiss) private var dismiss
    @State private var detail: CatalogDetail?
    @State private var error: String?
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let detail {
                        let images = [detail.type.thumb, detail.type.reverseImage].compactMap { $0?.nonempty }
                        if !images.isEmpty { TabView { ForEach(images, id: \.self) { AuthenticatedRemoteImage(api: model.api, address: $0).cornerRadius(18).padding(.bottom, 20) } }.tabViewStyle(.page).frame(height: 310) }
                        Text(detail.type.name).font(.system(size: 31, design: .serif))
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Выпуск").font(.title3.weight(.medium))
                            NumiFact(label: "Страна", value: detail.type.country)
                            NumiFact(label: "Год", value: detail.type.year.map(String.init))
                            NumiFact(label: "Номинал", value: detail.type.denomination)
                            NumiFact(label: "Монетный двор", value: detail.mint)
                            NumiFact(label: "Тираж", value: detail.type.mintage.map { $0.formatted() })
                            Text("Характеристики").font(.title3.weight(.medium)).padding(.top, 8)
                            NumiFact(label: "Металл", value: collectionMetalGroup(detail.type.metal))
                            NumiFact(label: "Состав", value: detail.type.composition)
                            NumiFact(label: "Масса, г", value: detail.type.mass)
                            NumiFact(label: "Диаметр, мм", value: detail.diameter)
                            NumiFact(label: "Гурт", value: detail.edge)
                            NumiFact(label: "Краузе (KM)", value: detail.kmNumber)
                        }.cabinetPanel()
                    } else if let error { Text(error).foregroundColor(.orange) }
                    else if coin.typeId == nil { Text("Монета пока не связана с каталогом.").foregroundColor(Cabinet.muted) }
                    else { ProgressView().frame(maxWidth: .infinity) }
                }.padding(20).frame(maxWidth: 760)
            }.background(Cabinet.background.ignoresSafeArea()).navigationTitle("Каталог")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() } } }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
            .task { guard let id = coin.typeId else { return }; do { detail = try await model.api.catalogDetail(id) } catch { self.error = "Не удалось загрузить карточку." } }
    }
}
