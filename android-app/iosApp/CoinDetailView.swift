import SwiftUI

struct CoinDetailView: View {
    @ObservedObject var model: NumiModel
    let coinID: String
    @Environment(\.dismiss) private var dismiss
    @State private var showMarket = false
    @State private var showCatalog = false
    @State private var editing = false
    @State private var selling = false
    @State private var deleting = false
    @State private var busy = false
    @State private var photoIndex: Int?
    @State private var localError: String?
    private var coin: Coin? { model.coins.first(where: { $0.id == model.resolvedCoinID(coinID) }) }
    var body: some View {
        ScrollView {
            if let coin {
                VStack(alignment: .leading, spacing: 24) {
                    photos(coin)
                    Text(coin.title).font(.system(size: 30, design: .serif))
                    Text(coin.caption).font(.callout).foregroundColor(Cabinet.muted)
                    if coin.status == "sold" { Text("Продана").foregroundColor(Cabinet.copper) }
                    Button { showMarket = true } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Оценка").foregroundColor(Cabinet.muted)
                                if let estimate = coin.valuation, let amount = estimate.amount {
                                    Text((estimate.isFloor ? "≥ " : "≈ ") + money(amount, currency: estimate.currency ?? "RUB")).font(.system(size: 27, design: .serif))
                                } else { Text("Посмотреть данные").font(.title3) }
                            }
                            Spacer(); Image(systemName: "chevron.right")
                        }.padding(20).background(Cabinet.panel).cornerRadius(20)
                    }.buttonStyle(.plain)
                    characteristics(coin)
                    if let error = model.error { ErrorBanner(text: error) { model.error = nil } }
                    if let localError { ErrorBanner(text: localError) { self.localError = nil } }
                    if coin.purchasePriceMinor != nil || coin.purchaseSource != nil || coin.notes?.nonempty != nil {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("В моей коллекции").font(.title3)
                            if let amount = coin.purchasePriceMinor { DetailRow(label: "Покупка", value: money(amount, currency: coin.purchaseCurrency ?? "RUB")) }
                            if let source = coin.purchaseSource?.nonempty { DetailRow(label: "Источник", value: source) }
                            if let date = coin.purchaseDate { DetailRow(label: "Дата покупки", value: String(date.prefix(10))) }
                            if let notes = coin.notes?.nonempty { Text(notes).textSelection(.enabled) }
                        }.cabinetPanel()
                    }
                    if coin.status == "sold" {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Продано").font(.title3)
                            if let amount = coin.soldPriceMinor { Text(money(amount, currency: coin.soldCurrency ?? "RUB")).font(.title2) }
                            if let date = coin.soldAt { Text(String(date.prefix(10))).foregroundColor(Cabinet.muted) }
                        }.cabinetPanel()
                    }
                    NumiActionRow(title: coin.typeId == nil ? "Найти в каталоге" : "В каталоге") { showCatalog = true }
                }.padding(22)
            } else { Text("Монета удалена из коллекции.").padding(32) }
        }.background(Cabinet.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .task(id: model.syncing) { if !model.syncing { await model.loadMarket(model.resolvedCoinID(coinID)) } }
            .toolbar {
                ToolbarItem(placement: .principal) { Text("Монета").font(.headline) }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button { editing = true } label: { Image(systemName: "pencil") }.disabled(busy)
                    Menu {
                        Button(coin?.status == "sold" ? "Вернуть в коллекцию" : "Отметить проданной") {
                            if coin?.status == "sold" { Task { await activate() } } else { selling = true }
                        }
                        Button("Удалить монету", role: .destructive) { deleting = true }
                    } label: { Image(systemName: "ellipsis") }
                }
            }
            .sheet(isPresented: $editing) { if let coin { EditCoinView(model: model, coin: coin) } }
            .sheet(isPresented: $selling) { if let coin { SaleCoinView(model: model, coin: coin) } }
            .fullScreenCover(isPresented: $showMarket) { MarketEvidenceView(model: model, coinID: coinID) }
            .fullScreenCover(isPresented: $showCatalog) { if let coin { LinkedCatalogView(model: model, coin: coin) } }
            .fullScreenCover(isPresented: Binding(get: { photoIndex != nil }, set: { if !$0 { photoIndex = nil } })) {
                PhotoPreview(model: model, coinID: coinID, index: photoIndex ?? 0)
            }
            .confirmationDialog("Удалить монету?", isPresented: $deleting, titleVisibility: .visible) {
                Button("Удалить", role: .destructive) { Task { await remove() } }
                Button("Отмена", role: .cancel) { }
            }
    }
    private func photos(_ coin: Coin) -> some View {
        let images = model.library.photos(for: coin)
        return Group {
            if images.isEmpty {
                CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: model.coverKey(coin), revision: model.mediaRevision)
                    .aspectRatio(1, contentMode: .fit).cornerRadius(20).onTapGesture { photoIndex = 0 }
            } else {
                TabView {
                    ForEach(Array(images.enumerated()), id: \.element.id) { index, photo in
                        CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: photo.cacheKey, revision: model.mediaRevision)
                            .aspectRatio(1, contentMode: .fit).cornerRadius(20)
                            .padding(.bottom, 24)
                            .accessibilityLabel("Фото монеты")
                            .onTapGesture { photoIndex = index }
                    }
                }.tabViewStyle(.page).frame(height: 370)
            }
        }
    }
    private func characteristics(_ coin: Coin) -> some View {
        VStack(spacing: 8) {
            if let metal = collectionMetalGroup(coin.metal) { DetailRow(label: "Металл", value: metal) }
            if let value = coin.properties?.value("fineness") { DetailRow(label: "Проба", value: value + " ‰") }
            if let value = coin.properties?.value("mass") { DetailRow(label: "Масса", value: value + (coin.properties?.value("massUnit") == "troy_oz" ? " тр. унц." : " г")) }
            if let grade = coin.gradeCode?.nonempty { DetailRow(label: "Состояние", value: grade) }
            if let finish = coin.properties?.value("finish") { DetailRow(label: "Исполнение", value: finish) }
            if let company = coin.gradingCompanyCode?.nonempty { DetailRow(label: "Грейдинг", value: company) }
            if let mint = coin.catalog?.mint?.nonempty { DetailRow(label: "Монетный двор", value: mint) }
            if let mintage = coin.mintage { DetailRow(label: "Тираж", value: mintage.formatted(.number.locale(Locale(identifier: "ru_RU")))) }
            if let number = coin.catalog?.cbrNumber?.nonempty { DetailRow(label: "Каталог Банка России", value: number) }
            if let number = coin.catalog?.bitkinNumber?.nonempty { DetailRow(label: "Биткин", value: number) }
        }.cabinetPanel()
    }
    private func activate() async {
        busy = true; defer { busy = false }
        do { try await model.activate(model.resolvedCoinID(coinID)) } catch { localError = error.localizedDescription }
    }
    private func remove() async {
        busy = true; defer { busy = false }
        do { try await model.deleteCoin(model.resolvedCoinID(coinID)); dismiss() } catch { localError = error.localizedDescription }
    }
}

struct PhotoPreview: View {
    @ObservedObject var model: NumiModel
    let coinID: String
    let index: Int
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let coin = model.coins.first(where: { $0.id == coinID }) {
                let photos = model.library.photos(for: coin)
                let key = photos.indices.contains(index) ? photos[index].cacheKey : model.coverKey(coin)
                CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: key, revision: model.mediaRevision)
                    .scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity).padding(10)
            }
            Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.largeTitle).padding(20) }
        }.foregroundColor(.white)
    }
}

struct MarketEvidenceView: View {
    @ObservedObject var model: NumiModel
    let coinID: String
    @Environment(\.dismiss) private var dismiss
    @State private var calculating = false
    @State private var calculationError: String?
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if let coin = model.coins.first(where: { $0.id == model.resolvedCoinID(coinID) }), let estimate = coin.valuation, let amount = estimate.amount {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Оценка").foregroundColor(Cabinet.muted)
                            Text((estimate.isFloor ? "≥ " : "≈ ") + money(amount, currency: estimate.currency ?? "RUB")).font(.system(size: 34, design: .serif))
                            if estimate.rangeAvailable == true, let low = estimate.lowMinor, let high = estimate.highMinor { Text(money(low) + " – " + money(high)).foregroundColor(Cabinet.muted) }
                        }.cabinetPanel()
                    }
                    Button {
                        Task {
                            calculating = true; calculationError = nil
                            do { try await model.recalculateCoin(coinID) }
                            catch { calculationError = error.localizedDescription }
                            calculating = false
                        }
                    } label: {
                        HStack {
                            if calculating { ProgressView() }
                            Text("Обновить оценку")
                        }
                    }.disabled(calculating)
                    if let calculationError { Text(calculationError).foregroundColor(.orange) }
                    if let market = model.library.markets[model.resolvedCoinID(coinID)] { MarketCard(market: market) }
                    if let error = model.marketErrors[model.resolvedCoinID(coinID)] {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(error).foregroundColor(.orange)
                            Button("Повторить") { Task { await model.loadMarket(model.resolvedCoinID(coinID), refresh: true) } }
                                .disabled(model.loadingMarket.contains(model.resolvedCoinID(coinID)))
                        }.cabinetPanel()
                    } else if model.library.markets[model.resolvedCoinID(coinID)] == nil {
                        ProgressView().frame(maxWidth: .infinity).task { await model.loadMarket(model.resolvedCoinID(coinID), refresh: true) }
                    }
                }.padding(20)
            }.background(Cabinet.background.ignoresSafeArea()).navigationTitle("Оценка и проходы")
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() } } }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
}
struct DetailRow: View {
    let label: String; let value: String
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 20) {
            Text(label).foregroundColor(Cabinet.muted); Spacer(minLength: 0)
            Text(value).multilineTextAlignment(.trailing).textSelection(.enabled)
        }.font(.callout)
    }
}
struct MarketCard: View {
    let market: MarketEvidence
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Text("Монета на рынке").font(.system(size: 27, design: .serif))
            VStack(spacing: 12) {
                DetailRow(label: "Подтверждённые продажи", value: String(market.activity.confirmedSalesCount ?? 0))
                DetailRow(label: "Площадки", value: String(market.activity.venuesCount ?? 0))
                if let n = market.activity.activeOffersCount, n > 0 { DetailRow(label: "В продаже", value: String(n)) }
                if let n = market.activity.endedUnsoldCount, n > 0 { DetailRow(label: "Завершились без продажи", value: String(n)) }
            }
            if !market.gradeBuckets.isEmpty {
                Text("Продажи по состоянию").font(.headline)
                ForEach(Array(market.gradeBuckets.enumerated()), id: \.offset) { _, bucket in
                    VStack(alignment: .leading, spacing: 7) {
                        HStack { Text(bucket.title); Spacer(); Text("\(bucket.salesCount ?? 0) продаж").foregroundColor(Cabinet.muted).font(.caption) }
                        if let low = bucket.minPriceMinor, let high = bucket.maxPriceMinor {
                            Text(money(low, currency: bucket.currency ?? "RUB") + " – " + money(high, currency: bucket.currency ?? "RUB")).foregroundColor(Cabinet.copper)
                        }
                    }
                }
            }
            if let floor = market.metalFloor {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Стоимость металла").font(.headline)
                    Text(money(floor.valueMinor, currency: floor.currency ?? "RUB")).font(.title2).foregroundColor(Cabinet.copper)
                    Text("\(metalName(floor.metal)) · \(floor.pureWeightGrams.formatted(.number.precision(.fractionLength(0...3)))) г чистого металла").font(.caption).foregroundColor(Cabinet.muted)
                    if let date = floor.priceDate { Text("Цена от \(date.prefix(10))").font(.caption).foregroundColor(Cabinet.muted) }
                }
            }
            if !market.events.isEmpty {
                Text("Проходы и предложения").font(.headline)
                ForEach(market.events) { event in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(event.sourceName ?? event.source ?? "Площадка"); Spacer()
                            if let date = event.eventDate { Text(String(date.prefix(10))).font(.caption).foregroundColor(Cabinet.muted) }
                        }
                        Text(event.kindName).font(.caption).foregroundColor(event.kind == "confirmed_sale" ? Cabinet.green : Cabinet.muted)
                        if let price = event.priceMinor { Text(money(price, currency: event.currency ?? "RUB")).font(.headline) }
                        if let grade = event.gradeCode { Text(grade).font(.caption).foregroundColor(Cabinet.muted) }
                        if let raw = event.sourceUrl, let url = URL(string: raw), ["http", "https"].contains(url.scheme ?? "") { Link("Открыть лот", destination: url).font(.callout) }
                        Divider()
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
    }
}
