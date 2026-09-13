import SwiftUI

struct CoinDetailView: View {
    @ObservedObject var model: NumiModel
    let coinID: String
    private var coin: Coin? { model.library.items[coinID] }
    var body: some View {
        ScrollView {
            if let coin {
                VStack(alignment: .leading, spacing: 24) {
                    photos(coin)
                    Text(coin.caption).font(.callout).foregroundColor(Cabinet.muted)
                    Text(coin.title).font(.system(size: 30, design: .serif))
                    characteristics(coin)
                    valuation(coin)
                    if let market = model.library.markets[coinID] { MarketCard(market: market) }
                    HStack {
                        if model.loadingMarket.contains(coinID) { ProgressView() }
                        Button(model.library.markets[coinID] == nil ? "Загрузить проходы" : "Обновить проходы") {
                            Task { await model.loadMarket(coinID, refresh: true) }
                        }.disabled(model.loadingMarket.contains(coinID) || model.syncing)
                    }
                    if let error = model.error { ErrorBanner(text: error) { model.error = nil } }
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
                }.padding(22)
            } else { Text("Монета удалена из коллекции.").padding(32) }
        }.background(Cabinet.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .task(id: model.syncing) { if !model.syncing { await model.loadMarket(coinID) } }
    }
    private func photos(_ coin: Coin) -> some View {
        let images = model.library.photos(for: coin)
        return Group {
            if images.isEmpty {
                CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: model.coverKey(coin), revision: model.mediaRevision)
                    .aspectRatio(1, contentMode: .fit).cornerRadius(20)
            } else {
                TabView {
                    ForEach(images) { photo in
                        VStack(spacing: 8) {
                            CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: photo.cacheKey, revision: model.mediaRevision)
                                .aspectRatio(1, contentMode: .fit).cornerRadius(20)
                            Text(photo.sideName).font(.caption).foregroundColor(Cabinet.muted).padding(.bottom, 24)
                        }
                    }
                }.tabViewStyle(.page).frame(height: 370)
            }
        }
    }
    private func characteristics(_ coin: Coin) -> some View {
        VStack(spacing: 14) {
            if let grade = coin.gradeCode?.nonempty { DetailRow(label: "Состояние", value: grade) }
            if let company = coin.gradingCompanyCode?.nonempty { DetailRow(label: "Грейдинг", value: company) }
            if let mint = coin.catalog?.mint?.nonempty { DetailRow(label: "Монетный двор", value: mint) }
            if let mintage = coin.mintage { DetailRow(label: "Тираж", value: mintage.formatted(.number.locale(Locale(identifier: "ru_RU")))) }
            if let number = coin.catalog?.cbrNumber?.nonempty { DetailRow(label: "Каталог Банка России", value: number) }
            if let number = coin.catalog?.bitkinNumber?.nonempty { DetailRow(label: "Биткин", value: number) }
        }.cabinetPanel()
    }
    private func valuation(_ coin: Coin) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Рыночная оценка").font(.title3)
            if let estimate = coin.valuation, let amount = estimate.amount {
                Text((estimate.isFloor ? "≥ " : "≈ ") + money(amount, currency: estimate.currency ?? "RUB"))
                    .font(.system(size: 34, design: .serif)).foregroundColor(estimate.isFloor ? Cabinet.copper : Cabinet.green)
                if estimate.isFloor { Text("Стоимость содержащегося металла").foregroundColor(Cabinet.muted) }
                else if estimate.rangeAvailable == true, let low = estimate.lowMinor, let high = estimate.highMinor {
                    Text(money(low, currency: estimate.currency ?? "RUB") + " – " + money(high, currency: estimate.currency ?? "RUB")).foregroundColor(Cabinet.muted)
                }
                if let date = estimate.calculatedAt { Text("Расчёт от \(date.prefix(10))").font(.caption).foregroundColor(Cabinet.muted) }
            } else { Text("Оценка не рассчитана.").foregroundColor(Cabinet.muted) }
        }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
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
