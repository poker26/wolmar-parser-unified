import SwiftUI

struct CoinDetailView: View {
    @ObservedObject var model: NumiModel
    let coinID: String
    @Environment(\.horizontalSizeClass) private var widthClass
    @Environment(\.dismiss) private var dismiss
    @State private var showMarket = false
    @State private var showCatalog = false
    @State private var editing = false
    @State private var selling = false
    @State private var deleting = false
    @State private var busy = false
    @State private var photoIndex: Int?
    @State private var localError: String?
    @State private var recognitionHint: SavedRecognitionHint?
    private var coin: Coin? { model.coins.first(where: { $0.id == model.resolvedCoinID(coinID) }) }
    var body: some View {
        ScrollView {
            if let coin {
                VStack(alignment: .leading, spacing: 24) {
                    photos(coin)
                    Text(coin.title).font(.system(size: 30, design: .serif)).accessibilityIdentifier("coin.title")
                    Text(coin.caption).font(.callout).foregroundColor(Cabinet.muted)
                    if coin.status == "sold" { Text("Продана").foregroundColor(Cabinet.copper) }
                    if coin.typeId == nil, recognitionHint?.result.isAwaitingDecision == true {
                        Text("Определяем монету.").foregroundColor(Cabinet.muted)
                        NumiActionRow(title: "Проверить результат") {
                            Task {
                                busy = true; defer { busy = false }
                                localError = nil
                                do { recognitionHint = try await model.checkRecognitionResult(for: coinID) }
                                catch { localError = "Не удалось проверить результат. Повторите попытку." }
                            }
                        }.disabled(busy).accessibilityIdentifier("coin.checkRecognition")
                    }
                    if coin.typeId == nil, let hint = recognitionHint, !hint.result.isAwaitingDecision, hint.decision != "rejected",
                       hint.result.extracted.year == nil || coin.year == hint.result.extracted.year {
                        ForEach(hint.result.candidates) { candidate in
                            if hint.result.canAssignType(candidate) {
                                NumiActionRow(title: candidate.name) {
                                    Task {
                                        busy = true; defer { busy = false }
                                        var choice = CatalogChoice(id: candidate.id, name: candidate.name)
                                        choice.year = coin.year ?? candidate.issueYear ?? candidate.year
                                        choice.country = candidate.country; choice.metal = candidate.metal
                                        do { try await model.linkCatalog(coin.id, choice: choice) }
                                        catch { localError = error.localizedDescription }
                                    }
                                }
                            } else { RecognitionReferenceView(candidate: candidate) }
                        }
                    }
                    if let estimate = coin.currentValuationAvailability, estimate.showDetails {
                    Button { showMarket = true } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Оценка").foregroundColor(Cabinet.muted)
                                if model.calculatingCoinIDs.contains(coin.id) { ProgressView() }
                                else if let amount = estimate.amountMinor, let currency = estimate.currency {
                                    Text((estimate.isMetal ? "≥ " : "≈ ") + money(amount, currency: currency)).font(.system(size: 27, design: .serif))
                                    Text([estimate.isMetal ? "По стоимости металла" : "По продажам",
                                          estimate.calculatedAt.map { String($0.prefix(10)) }].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundColor(Cabinet.muted)
                                } else { Text(estimate.reason == "grade_required" ? "Уточнить сохранность" : "Узнать стоимость").font(.title3) }
                            }
                            Spacer(); Image(systemName: "chevron.right")
                        }.padding(20).background(Cabinet.panel).cornerRadius(20)
                    }.buttonStyle(.plain).accessibilityIdentifier("coin.market")
                    }
                    forecastPanel(coin)
                    characteristics(coin)
                    if let error = model.error { ErrorBanner(text: error) { model.error = nil } }
                    if let localError { ErrorBanner(text: localError) { self.localError = nil } }
                    if (coin.status != "sold" && coin.purchasePriceMinor != nil) || coin.purchaseSource != nil || coin.notes?.nonempty != nil {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("В моей коллекции").font(.title3)
                            if coin.status != "sold", let amount = coin.purchasePriceMinor { DetailRow(label: "Покупка", value: money(amount, currency: coin.purchaseCurrency ?? "RUB")) }
                            if let source = coin.purchaseSource?.nonempty { DetailRow(label: "Источник", value: source) }
                            if let date = coin.purchaseDate { DetailRow(label: "Дата покупки", value: String(date.prefix(10))) }
                            if let notes = coin.notes?.nonempty { Text(notes).textSelection(.enabled) }
                        }.cabinetPanel()
                    }
                    if coin.status == "sold" {
                        saleResult(coin)
                    }
                    NumiActionRow(title: coin.typeId == nil ? "Найти в каталоге" : "В каталоге") { showCatalog = true }
                        .accessibilityIdentifier("coin.catalog")
                }.padding(22)
            } else { Text("Монета удалена из коллекции.").padding(32) }
        }.background(Cabinet.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .task(id: model.syncing) { if !model.syncing { await model.loadMarket(model.resolvedCoinID(coinID)) } }
            .task(id: model.syncing) { if !model.syncing { await model.refreshCoinValuationAvailability(model.resolvedCoinID(coinID)) } }
            .task(id: coin.map { "\($0.id):\($0.version):\($0.status)" }) {
                if let coin, coin.status == "sold" { await model.loadSaleComparison(coin) }
            }
            .task(id: model.mediaRevision) { recognitionHint = await model.recognitionHint(for: coinID) }
            .toolbar {
                ToolbarItem(placement: .principal) { Text("Монета").font(.headline) }
                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    Button { editing = true } label: { Image(systemName: "pencil") }.disabled(busy)
                        .accessibilityLabel("Изменить").accessibilityIdentifier("coin.edit")
                    Menu {
                        Button(coin?.status == "sold" ? "Вернуть в коллекцию" : "Отметить проданной") {
                            if coin?.status == "sold" { Task { await activate() } } else { selling = true }
                        }
                        Button("Удалить монету", role: .destructive) { deleting = true }
                            .accessibilityIdentifier("coin.delete")
                    } label: { Image(systemName: "ellipsis") }.disabled(busy).accessibilityIdentifier("coin.actions")
                }
            }
            .sheet(isPresented: $editing) { if let coin { EditCoinView(model: model, coin: coin).sessionLoginOverlay(model: model) } }
            .sheet(isPresented: $selling) { if let coin { SaleCoinView(model: model, coin: coin).sessionLoginOverlay(model: model) } }
            .fullScreenCover(isPresented: $showMarket) { MarketEvidenceView(model: model, coinID: coinID).sessionLoginOverlay(model: model) }
            .fullScreenCover(isPresented: $showCatalog) { if let coin { LinkedCatalogView(model: model, coin: coin, yearReview: recognitionHint?.result.catalogDecision?.yearReview).sessionLoginOverlay(model: model) } }
            .fullScreenCover(isPresented: Binding(get: { photoIndex != nil }, set: { if !$0 { photoIndex = nil } })) {
                PhotoPreview(model: model, coinID: coinID, index: photoIndex ?? 0)
            }
            .alert("Удалить монету?", isPresented: $deleting) {
                Button("Удалить", role: .destructive) { Task { await remove() } }.accessibilityIdentifier("coin.confirmDelete")
                Button("Отмена", role: .cancel) { }
            }
            .overlay {
                if busy { ProgressView().padding(24).background(Cabinet.panel).cornerRadius(18) }
            }
    }
    @ViewBuilder private func forecastPanel(_ coin: Coin) -> some View {
        let forecast: CollectionForecast? = coin.currentForecast.flatMap { value in
            coin.currentValuationAvailability?.state == "market" && value.valuationId == coin.valuation?.id
                ? nil : value
        }
        let canCalculateForecast = coin.currentForecastAvailability?.allowsCalculation == true
        if forecast != nil || canCalculateForecast {
            VStack(alignment: .leading, spacing: 6) {
                Text("Прогноз стоимости").foregroundColor(Cabinet.muted)
                if let forecast = forecast {
                    Text(money(forecast.medianMinor, currency: forecast.currency)).font(.system(size: 27, design: .serif))
                    Text(String(forecast.calculatedAt.prefix(10))).font(.caption).foregroundColor(Cabinet.muted)
                }
                if canCalculateForecast {
                    if model.calculatingCoinIDs.contains(coin.id) {
                        ProgressView()
                    } else {
                        Button(forecast == nil ? "Рассчитать прогноз" : "Пересчитать прогноз") {
                            Task {
                                localError = nil
                                do { try await model.recalculateForecast(coin.id) }
                                catch is CancellationError { }
                                catch { localError = error.localizedDescription }
                            }
                        }
                        .disabled(model.syncing)
                        .accessibilityIdentifier("forecast.recalculate")
                    }
                }
            }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
        }
    }

    private func photos(_ coin: Coin) -> some View {
        let images = model.photoKeys(for: coin)
        return Group {
            if images.isEmpty {
                CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: model.coverKey(coin), revision: model.mediaRevision)
                    .aspectRatio(1, contentMode: .fit).cornerRadius(20).onTapGesture { photoIndex = 0 }
            } else if widthClass == .regular && images.count == 2 {
                HStack(spacing: 12) {
                    ForEach(Array(images.enumerated()), id: \.offset) { index, key in
                        CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: key, revision: model.mediaRevision)
                            .aspectRatio(1, contentMode: .fit).cornerRadius(18).accessibilityLabel("Фото монеты")
                            .onTapGesture { photoIndex = index }
                    }
                }.frame(maxHeight: 370)
            } else {
                TabView {
                    ForEach(Array(images.enumerated()), id: \.element) { index, key in
                        CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: key, revision: model.mediaRevision)
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
            if let material = coin.materialLabel { DetailRow(label: "Материал", value: material) }
            if let value = coin.finenessLabel { DetailRow(label: "Проба", value: value) }
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
    private func saleResult(_ coin: Coin) -> some View {
        let comparison = model.saleComparison(for: coin)
        let sale = comparison?.sale ?? coin.soldPriceMinor.flatMap { amount in
            coin.soldCurrency.map { CollectionMoney(currency: $0, amountMinor: amount) }
        }
        let purchase = comparison?.purchase ?? coin.purchasePriceMinor.flatMap { amount in
            coin.purchaseCurrency.map { CollectionMoney(currency: $0, amountMinor: amount) }
        }
        return VStack(alignment: .leading, spacing: 12) {
            Text("Продажа").font(.title3)
            if let sale { DetailRow(label: "Цена продажи", value: money(sale.amountMinor, currency: sale.currency)) }
            if let date = comparison?.soldAt ?? coin.soldAt { DetailRow(label: "Дата продажи", value: String(date.prefix(10))) }
            if let purchase { DetailRow(label: "Цена покупки", value: money(purchase.amountMinor, currency: purchase.currency)) }
            if let sale, let difference = comparison?.differenceFromPurchaseMinor {
                DetailRow(label: "К цене покупки", value: signedMoney(difference, currency: sale.currency))
            }
            if let reference = comparison?.marketReference {
                DetailRow(label: "Оценка на дату продажи", value: money(reference.amountMinor, currency: reference.currency))
                if let difference = comparison?.differenceFromMarketMinor {
                    DetailRow(label: "К оценке", value: signedMoney(difference, currency: reference.currency))
                }
            }
        }.cabinetPanel().accessibilityIdentifier("coin.sale-result")
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
    @State private var original: Data?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let coin = model.coins.first(where: { $0.id == model.resolvedCoinID(coinID) }) {
                let keys = model.photoKeys(for: coin)
                let key = keys.indices.contains(index) ? keys[index] : model.coverKey(coin)
                Group {
                    if let original { CapturePhotoZoom(data: original) }
                    else { CachedCoinImage(disk: model.disk, account: model.user?.id ?? "", cacheKey: key, revision: model.mediaRevision)
                        .scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity).padding(10) }
                }.task(id: key) {
                    let account = model.user?.id ?? ""
                    original = nil
                    original = await model.disk.previewImage(account: account, key: key)
                }
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
    @State private var quality = ""
    private var coin: Coin? { model.coins.first { $0.id == coinID || $0.id == model.resolvedCoinID(coinID) } }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if coin?.currentValuationAvailability?.reason == "grade_required" {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("Уточните сохранность.").font(.title3)
                            TextField("Сохранность", text: $quality)
                                .textInputAutocapitalization(.characters).disableAutocorrection(true)
                                .accessibilityIdentifier("valuation.quality")
                            Text("PF, UNC, XF…").foregroundColor(Cabinet.muted)
                            Button("Сохранить и оценить") {
                                Task {
                                    calculating = true; calculationError = nil
                                    defer { calculating = false }
                                    do { try await model.setValuationQuality(coinID, grade: quality) }
                                    catch { calculationError = error.localizedDescription }
                                }
                            }.disabled(quality.nonempty == nil || calculating)
                                .accessibilityIdentifier("valuation.saveQuality")
                        }.cabinetPanel()
                    }
                    if let coin, let estimate = coin.currentValuationAvailability,
                       let amount = estimate.amountMinor, let currency = estimate.currency {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Оценка").foregroundColor(Cabinet.muted)
                            Text((estimate.isMetal ? "≥ " : "≈ ") + money(amount, currency: currency)).font(.system(size: 34, design: .serif))
                            if let details = coin.valuation, let snapshot = estimate.snapshotId,
                               details.basis?.marketSnapshotId == snapshot, details.rangeAvailable == true, !estimate.isMetal,
                               let low = details.lowMinor, let high = details.highMinor, low > 0, high > low {
                                Text(money(low, currency: currency) + " – " + money(high, currency: currency)).foregroundColor(Cabinet.muted)
                            }
                            Text([estimate.isMetal ? "По стоимости металла" : "По продажам",
                                  estimate.calculatedAt.map { String($0.prefix(10)) }].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).foregroundColor(Cabinet.muted)
                        }.cabinetPanel()
                    }
                    if coin?.currentValuationAvailability?.canRecalculate == true {
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
                    }.disabled(calculating || model.calculatingCoinIDs.contains(coinID))
                        .accessibilityIdentifier("valuation.refresh")
                    }
                    if let calculationError { Text(calculationError).foregroundColor(.orange) }
                    else if let error = model.valuationErrors[coinID] { Text(error).foregroundColor(.orange) }
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
