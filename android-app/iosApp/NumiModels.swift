import Foundation

struct NumiUser: Codable, Equatable {
    let id: String; let email: String; var displayName: String? = nil; var isGuest: Bool? = nil
    var guest: Bool { isGuest == true }
}
struct UserResponse: Decodable { let user: NumiUser }
struct CatalogSnapshot: Codable {
    var detailsVersion: Int? = nil
    var denomination: String? = nil; var mass: String? = nil; var composition: String? = nil
    var subject: String? = nil; var quality: String? = nil; var reverseImageUrl: String? = nil
    var year: Int?; var country: String?; var era: String?; var metal: String?
    var mint: String?; var mintage: Int64?; var imageUrl: String?
    var cbrNumber: String?; var bitkinNumber: String?
}
struct CoinProperties: Codable, Equatable {
    var values: [String: String] = [:]
    var manualFields: [String] = []
    func value(_ key: String, fallback: String? = nil) -> String? {
        if manualFields.contains(key) || values[key] != nil { return values[key]?.nonempty }
        return fallback?.nonempty
    }
}
struct KrauseReference: Codable {
    var year: Int?; var yearLabel: String?; var mint: String?; var variety: String?
    var mintage: Int64?; var currency: String?; var publicationYear: Int?
    var basisGradeCode: String?; var basisAmountMinor: Int64?
}
struct CoinValuation: Codable {
    let id: String
    var currency: String?; var lowMinor: Int64?; var medianMinor: Int64?; var highMinor: Int64?
    var valueFloorMinor: Int64?; var floorBasis: String?; var gradeCode: String?
    var comparableCount: Int?; var confidence: Double?; var status: String
    var method: String?; var estimateKind: String?; var rangeAvailable: Bool?; var calculatedAt: String?
    var abstainReason: String? = nil
    var requiresQuality: Bool { abstainReason == "grade_required" }
    var isFloor: Bool { status == "floor_only" || estimateKind == "metal_floor" }
    var summaryBasis: String? {
        guard amount != nil else { return nil }
        if isFloor { return "По стоимости металла" }
        guard let count = comparableCount, count > 0 else { return "По продажам" }
        let word = count % 10 == 1 && count % 100 != 11 ? "продаже" : "продажам"
        return "По \(count) \(word)"
    }
    var summaryDate: String? {
        guard let raw = calculatedAt else { return nil }
        let date = DateFormatter(); date.locale = Locale(identifier: "en_US_POSIX")
        date.dateFormat = "yyyy-MM-dd"; date.isLenient = false
        guard let value = date.date(from: String(raw.prefix(10))) else { return nil }
        date.dateFormat = "dd.MM.yyyy"
        return date.string(from: value)
    }
    var amount: Int64? {
        guard !requiresQuality, status == "ready" || status == "floor_only" else { return nil }
        let value = isFloor ? (valueFloorMinor ?? medianMinor) : (status == "ready" ? medianMinor : nil)
        return value.flatMap { $0 > 0 ? $0 : nil }
    }
}
struct MaterialGroup: Codable, Hashable {
    let id: String
    let label: String
    func matches(_ selection: Set<String>) -> Bool { selection.contains(id) || selection.contains(label) }
}
struct MaterialFineness: Codable {
    let numerator: String
    let denominator: String
    let partsPerThousand: String?
    let display: String?
    var label: String {
        if let display, display.hasSuffix("K") { return display }
        if let partsPerThousand { return "\(partsPerThousand) ‰" }
        return "\(numerator)/\(denominator)"
    }
}
struct MaterialOriginal: Codable {
    let catalogMetal: String?
    let catalogComposition: String?
    let propertyMetal: String?
    let propertyFineness: String?
    let finish: String?
}
struct MaterialNormalization: Codable {
    let materialGroup: MaterialGroup
    let original: MaterialOriginal
    let fineness: MaterialFineness?
    let directoryVersion: String?
    let directorySha256: String?
    let sourceHash: String?
}
struct Coin: Codable, Identifiable {
    let id: String
    var version: Int64
    var typeId: Int64?; var issueId: Int64?; var identifiedYear: Int?
    var typeName: String?; var userLabel: String?; var identificationStatus: String?
    var gradeCode: String?; var slabStatus: String?; var gradingCompanyCode: String?
    var slabCertificateNumber: String?; var purchasePriceMinor: Int64?; var purchaseCurrency: String?
    var purchaseDate: String?; var purchaseSource: String?; var notes: String?
    var status: String; var soldPriceMinor: Int64?; var soldCurrency: String?; var soldAt: String?
    var createdAt: String?; var updatedAt: String?
    var properties: CoinProperties? = nil
    var catalog: CatalogSnapshot?; var krauseReference: KrauseReference?; var valuation: CoinValuation?
    var userLabelSource: String? = nil
    var materialNormalization: MaterialNormalization? = nil
    var title: String { CoinName(label: userLabel, source: userLabelSource).title(catalogName: typeName) }
    var isInCollection: Bool { status == "active" || status == "archived" }
    var needsMassForMetalEstimate: Bool {
        guard typeId == nil, properties?.value("mass") == nil else { return false }
        return hasPreciousMetalAndFineness
    }
    private var hasPreciousMetalAndFineness: Bool {
        let metals = ["gold", "au", "золото", "silver", "ag", "серебро", "platinum", "pt", "платина", "palladium", "pd", "палладий"]
        guard let metal = properties?.value("metal")?.lowercased(), metals.contains(metal),
              let raw = properties?.value("fineness"), let value = Double(raw.replacingOccurrences(of: ",", with: ".")) else { return false }
        return value.isFinite && value > 0 && value <= 1000
    }
    var hasMetalValuationInputs: Bool {
        guard hasPreciousMetalAndFineness, let raw = properties?.value("mass"),
              let mass = Double(raw.replacingOccurrences(of: ",", with: ".")), mass.isFinite, mass > 0 else { return false }
        return ["g", "troy_oz"].contains(properties?.value("massUnit") ?? "")
    }
    var canRecalculateValuation: Bool {
        (typeId != nil || hasMetalValuationInputs) && valuation?.requiresQuality != true
    }
    var needsInitialValuation: Bool { isInCollection && valuation == nil && (typeId != nil || hasMetalValuationInputs) }
    func sameValuationInputs(as other: Coin) -> Bool {
        typeId == other.typeId && issueId == other.issueId && identifiedYear == other.identifiedYear &&
            (properties?.values ?? [:]) == (other.properties?.values ?? [:]) && gradeCode == other.gradeCode &&
            slabStatus == other.slabStatus && gradingCompanyCode == other.gradingCompanyCode
    }
    var year: Int? { properties.flatMap { $0.value("year") }.flatMap { Int($0) } ?? identifiedYear ?? catalog?.year }
    var country: String? {
        if let properties { return properties.value("country", fallback: catalog?.country) }
        return catalog?.country?.nonempty
    }
    var metal: String? {
        if let properties { return properties.value("metal", fallback: catalog?.metal) }
        return catalog?.metal?.nonempty
    }
    var currentMaterialNormalization: MaterialNormalization? {
        guard let result = materialNormalization else { return nil }
        let original = result.original
        guard original.catalogMetal == catalog?.metal, original.catalogComposition == catalog?.composition,
              original.propertyMetal == properties?.values["metal"], original.propertyFineness == properties?.values["fineness"],
              original.finish == properties?.values["finish"], result.materialGroup.id.nonempty != nil,
              result.materialGroup.label.nonempty != nil else { return nil }
        if properties?.manualFields.contains("metal") == true, metal == nil, result.materialGroup.id != "unknown" { return nil }
        return result
    }
    var materialLabel: String? { currentMaterialNormalization?.materialGroup.label ?? collectionMetalGroup(metal) }
    var finenessLabel: String? {
        if let result = currentMaterialNormalization, properties?.manualFields.contains("fineness") != true {
            return result.fineness?.label
        }
        return properties?.value("fineness").map { $0 + " ‰" }
    }
    var mintage: Int64? { krauseReference?.mintage ?? catalog?.mintage }
    func hasMarketEntry(_ market: MarketEvidence?) -> Bool {
        typeId != nil || hasMetalValuationInputs ||
            valuation?.amount != nil || (market?.metalFloor?.valueMinor ?? 0) > 0
    }
    var caption: String {
        [year.map(String.init), country, materialLabel].compactMap { $0?.nonempty }.joined(separator: " · ")
    }
}
struct CoinPhoto: Codable, Identifiable {
    let id: String; let itemId: String
    var side: String; var byteSize: Int64; var status: String; var sortOrder: Int
    var sha256: String?; var originalUrl: String?; var displayUrl: String?
    var originalUrlExpiresAt: String?; var updatedAt: String?
    var cacheKey: String { "photo:\(id):\(sha256 ?? updatedAt ?? "")" }
}
struct SyncPage: Decodable {
    let changes: [SyncChange]; let nextCursor: String; let hasMore: Bool
    var directorySha256: String?
    var materialNormalizationStatus: String?
}
struct CollectionMaterialPage: Decodable {
    let items: [Coin]
    let nextCursor: String?
    let directorySha256: String?
    let materialNormalizationStatus: String?
}
struct SyncChange: Decodable {
    let seq: String; let entityKind: String; let entityId: String; let itemId: String; let operation: String
    var item: Coin?; var photo: CoinPhoto?; var valuation: CoinValuation?
}
struct MarketActivity: Codable {
    var confirmedSalesCount: Int?; var venuesCount: Int?; var salesLast12Months: Int?
    var activeOffersCount: Int?; var endedUnsoldCount: Int?; var closedUnconfirmedCount: Int?
}
struct GradeBucket: Codable {
    var gradeCode: String?; var slabStatus: String?; var gradingCompanyCode: String?; var currency: String?
    var salesCount: Int?; var minPriceMinor: Int64?; var medianPriceMinor: Int64?; var maxPriceMinor: Int64?
    var title: String { [gradeCode ?? "Состояние не указано", gradingCompanyCode].compactMap { $0?.nonempty }.joined(separator: " · ") }
}
struct MarketEvent: Codable, Identifiable {
    let id: Int64; var kind: String; var source: String?; var sourceName: String?
    var auctionNumber: String?; var lotNumber: String?; var priceMinor: Int64?; var currency: String?
    var gradeCode: String?; var eventDate: String?; var sourceUrl: String?
    var kindName: String {
        ["confirmed_sale": "Продано", "active_offer": "В продаже", "ended_unsold": "Не продано",
         "closed_unconfirmed": "Цена продажи не подтверждена"][kind] ?? "Наблюдение рынка"
    }
}
struct MetalFloor: Codable {
    var currency: String?; var valueMinor: Int64; var metal: String; var pureWeightGrams: Double
    var pricePerGramMinor: Int64?; var priceDate: String?
}
struct MarketEvidence: Codable {
    var activity: MarketActivity
    var gradeBuckets: [GradeBucket]; var events: [MarketEvent]; var metalFloor: MetalFloor?
}
struct MarketResponse: Decodable { var market: MarketEvidence? }
struct PhotoURLResponse: Decodable { let url: String }

struct LibrarySnapshot: Codable {
    var items: [String: Coin] = [:]
    var photos: [String: CoinPhoto] = [:]
    var markets: [String: MarketEvidence] = [:]
    var cursor: String?
    var syncedAt: Date?

    func removing(_ ids: Set<String>) -> LibrarySnapshot {
        var result = self
        result.items = items.filter { !ids.contains($0.key) }
        result.photos = photos.filter { !ids.contains($0.value.itemId) }
        result.markets = markets.filter { !ids.contains($0.key) }
        return result
    }

    func applying(_ page: SyncPage) throws -> LibrarySnapshot {
        guard !page.nextCursor.isEmpty, !page.hasMore || page.nextCursor != cursor else { throw NumiError.invalidSync }
        var previousSequence: Int64?
        for change in page.changes {
            guard let seq = Int64(change.seq), seq >= 0,
                  previousSequence.map({ seq > $0 }) ?? true,
                  !change.entityId.isEmpty, !change.itemId.isEmpty,
                  ["item", "photo", "valuation"].contains(change.entityKind),
                  ["upsert", "delete"].contains(change.operation) else { throw NumiError.invalidSync }
            previousSequence = seq
            if change.operation == "upsert" {
                switch change.entityKind {
                case "item": guard change.item?.id == change.entityId, change.item?.id == change.itemId else { throw NumiError.invalidSync }
                case "photo": guard change.photo?.id == change.entityId, change.photo?.itemId == change.itemId else { throw NumiError.invalidSync }
                case "valuation": guard change.valuation?.id == change.entityId else { throw NumiError.invalidSync }
                default: throw NumiError.invalidSync
                }
            }
        }
        var result = self
        for change in page.changes {
            if change.operation == "delete" {
                switch change.entityKind {
                case "item":
                    result.items.removeValue(forKey: change.itemId)
                    result.photos = result.photos.filter { $0.value.itemId != change.itemId }
                    result.markets.removeValue(forKey: change.itemId)
                case "photo": result.photos.removeValue(forKey: change.entityId)
                case "valuation": result.items[change.itemId]?.valuation = nil
                default: break
                }
            } else {
                switch change.entityKind {
                case "item":
                    if var coin = change.item, coin.version >= (result.items[coin.id]?.version ?? 0) {
                        if coin.materialNormalization == nil, let cached = result.items[coin.id],
                           Set(coin.properties?.manualFields ?? []) == Set(cached.properties?.manualFields ?? []) {
                            coin.materialNormalization = cached.currentMaterialNormalization
                            coin.materialNormalization = coin.currentMaterialNormalization
                        }
                        result.items[coin.id] = coin
                        result.markets.removeValue(forKey: coin.id)
                    }
                case "photo": result.photos[change.entityId] = change.photo
                case "valuation": result.items[change.itemId]?.valuation = change.valuation
                default: break
                }
            }
        }
        result.cursor = page.nextCursor
        return result
    }

    mutating func cacheMaterials(_ remoteItems: [Coin], directory: String) {
        for remote in remoteItems {
            guard let projection = remote.materialNormalization, projection.directorySha256 == directory,
                  var coin = items[remote.id], coin.version == remote.version else { continue }
            coin.materialNormalization = projection
            items[coin.id] = coin
        }
    }
    func photos(for coin: Coin) -> [CoinPhoto] {
        photos.values.filter { $0.itemId == coin.id && $0.status == "ready" }
            .sorted { ($0.sortOrder, $0.id) < ($1.sortOrder, $1.id) }
    }
}

enum NumiError: LocalizedError {
    case keychain(Int32)
    case invalidSync, invalidResponse, sessionExpired, invalidCredentials, unavailable, corruptPhoto, storage
    case server(String)
    var errorDescription: String? {
        switch self {
        case .keychain: return "Не удалось сохранить сессию на устройстве."
        case .invalidSync: return "Не удалось прочитать изменения коллекции. Повторите синхронизацию."
        case .invalidResponse: return "Сервер вернул неожиданный ответ."
        case .sessionExpired: return "Для синхронизации войдите в аккаунт ещё раз."
        case .invalidCredentials: return "Неверная почта или пароль."
        case .unavailable: return "Не удалось связаться с сервером. Проверьте подключение к интернету."
        case .corruptPhoto: return "Не удалось проверить загруженную фотографию. Повторите синхронизацию."
        case .storage: return "Не удалось сохранить данные на устройстве."
        case .server(let message): return message
        }
    }
}
extension String { var nonempty: String? { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self } }
func metalName(_ value: String) -> String {
    ["gold": "Золото", "silver": "Серебро", "copper": "Медь", "platinum": "Платина",
     "palladium": "Палладий", "bronze": "Бронза", "nickel": "Никель", "bimetal": "Биметалл"][value.lowercased()] ?? value
}
// Group the overview without changing the catalog composition or detail captions.
func collectionMetalGroup(_ raw: String?) -> String? {
    guard let raw = raw else { return nil }
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .lowercased().replacingOccurrences(of: "ё", with: "е")
    if ["", "unknown", "неизвестно", "не указан", "неизвестный", "-"].contains(value) { return nil }
    let key = value.replacingOccurrences(of: #"[0-9.,/()%‰°]+"#, with: " ", options: .regularExpression)
        .replacingOccurrences(of: #"\b(fine|pure|sterling|fineness|purity|karat|karats|carat|carats|kt|k|проба|пробы)\b"#, with: " ", options: .regularExpression)
        .replacingOccurrences(of: #"[\s\-–—]+"#, with: "", options: .regularExpression)
    let groups: [(String, [String])] = [
        ("Золото", ["золото", "gold", "au"]), ("Серебро", ["серебро", "silver", "ag"]),
        ("Платина", ["платина", "platinum", "pt"]), ("Палладий", ["палладий", "palladium", "pd"]),
        ("Медь", ["медь", "copper", "cu"]), ("Никель", ["никель", "nickel", "ni"]),
        ("Алюминий", ["алюминий", "aluminium", "aluminum", "al"]), ("Цинк", ["цинк", "zinc", "zn"]),
        ("Олово", ["олово", "tin", "sn"]), ("Железо", ["железо", "iron", "fe"]),
        ("Сталь", ["сталь", "steel"]), ("Бронза", ["бронза", "bronze"]),
        ("Латунь", ["латунь", "brass", "медноцинковыйсплав", "copperzinc", "cuzn"]),
        ("Медно-никелевый сплав", ["медьникель", "медноникелевыйсплав", "cuni", "cupronickel", "coppernickel"]),
        ("Алюминиевая бронза", ["алюминиеваябронза", "aluminiumbronze", "aluminumbronze"]),
        ("Биллон", ["биллон", "billon"]), ("Биметалл", ["биметалл", "биметаллическая", "bimetal", "bimetallic"])
    ]
    return groups.first { $0.1.contains(key) }?.0 ?? value.prefix(1).uppercased() + String(value.dropFirst())
}
func money(_ minor: Int64, currency: String = "RUB") -> String {
    let formatter = NumberFormatter()
    formatter.locale = Locale(identifier: "ru_RU")
    formatter.numberStyle = .currency
    formatter.currencyCode = currency
    formatter.maximumFractionDigits = minor % 100 == 0 ? 0 : 2
    return formatter.string(from: NSDecimalNumber(value: minor).dividing(by: 100)) ?? "\(minor / 100) \(currency)"
}
