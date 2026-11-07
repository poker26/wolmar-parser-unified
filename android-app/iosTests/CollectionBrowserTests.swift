import XCTest
@testable import Numi

final class CollectionBrowserTests: XCTestCase {
    private func coin(_ id: String = "coin", country: String = "Ghana", metal: String = "silver 999", year: Int? = 2022) -> Coin {
        Coin(id: id, version: 1, typeId: 42, identifiedYear: year, typeName: "5 cedis. Снежный барс",
            gradeCode: "PF", notes: "Подарок", status: "active", properties: CoinProperties(values: ["denominationValue": "5", "denominationUnit": "cedis", "subject": "Барс"]),
            catalog: CatalogSnapshot(country: country, metal: metal))
    }
    func testServerMaterialGroupsIncludeSavedAndNewCoinsAndKeepManualValues() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "materials-contract", withExtension: "json", subdirectory: "Fixtures"))
        let coins = try JSONDecoder().decode([Coin].self, from: Data(contentsOf: url))
        let byID = Dictionary(uniqueKeysWithValues: coins.map { ($0.id, $0) })
        var filter = CollectionBrowserState(); filter.metals = ["metal:gold"]
        XCTAssertEqual(Set(filterCollection(coins, state: filter).map(\.id)), ["saved", "added", "russian", "cleared", "without-enrichment"])
        filter.metals = ["coated:metal:copper:metal:gold"]
        XCTAssertEqual(filterCollection(coins, state: filter).map(\.id), ["plated"])
        filter.metals = ["unknown"]; XCTAssertEqual(filterCollection(coins, state: filter).map(\.id), ["unknown"])
        var added = try XCTUnwrap(byID["added"])
        XCTAssertEqual(added.finenessLabel, "999 ‰")
        XCTAssertEqual(added.properties?.value("mass"), "10")
        XCTAssertEqual(added.properties?.value("metal"), "золото999")
        let reopened = try JSONDecoder().decode(Coin.self, from: JSONEncoder().encode(added))
        XCTAssertEqual(reopened.currentMaterialNormalization?.materialGroup.id, "metal:gold")
        XCTAssertNil(byID["cleared"]?.finenessLabel)
        XCTAssertEqual(byID["cleared"]?.properties?.manualFields, ["fineness"])
        added.properties?.values["metal"] = "Серебро"; XCTAssertEqual(added.materialLabel, "Серебро")
        XCTAssertEqual(byID["without-enrichment"]?.materialLabel, "Золото")
    }
    func testWordsMayBeEnteredInAnyOrderWithCountryAndMetalAliases() {
        var state = CollectionBrowserState(); state.query = "барс Гана silver 2022 подарок"
        XCTAssertEqual(filterCollection([coin()], state: state).map(\.id), ["coin"])
        state.query = "Ghana 2022 барс"; XCTAssertEqual(filterCollection([coin()], state: state).count, 1)
        state.query = "Ghana 2020"; XCTAssertTrue(filterCollection([coin()], state: state).isEmpty)
    }
    func testCombinedFiltersAndUnknownYears() {
        var state = CollectionBrowserState(); state.countries = [collectionCountry("Ghana")!]; state.metals = ["Серебро"]
        state.yearFrom = "2020"; state.yearTo = "2022"; state.grade = "pf"; state.denomination = "5"
        XCTAssertEqual(filterCollection([coin(), coin("old", year: 2019), coin("no-year", year: nil)], state: state).map(\.id), ["coin"])
        state.yearFrom = "invalid"; XCTAssertTrue(filterCollection([coin()], state: state).isEmpty)
    }
    func testNominalDoesNotMatchYearOrCatalogNumber() {
        let value = coin()
        XCTAssertTrue(collectionMatchesDenomination(value, "5"))
        XCTAssertTrue(collectionMatchesDenomination(value, "5 cedis"))
        XCTAssertFalse(collectionMatchesDenomination(value, "2022"))
        XCTAssertFalse(collectionMatchesDenomination(value, "5 рублей"))
    }
    func testUnlinkedUsesActualCatalogIdentity() {
        var unlinked = coin("unlinked"); unlinked.typeId = nil
        var state = CollectionBrowserState(); state.unlinked = true
        XCTAssertEqual(filterCollection([coin(), unlinked], state: state).map(\.id), ["unlinked"])
    }
    func testSoldShelfIsIndependentFromOtherFilters() {
        var sold = coin("sold"); sold.status = "sold"
        var state = CollectionBrowserState(); state.showSold = true; state.metals = ["Серебро"]
        XCTAssertEqual(filterCollection([coin(), sold], state: state).map(\.id), ["sold"])
        state.clearFilters(); XCTAssertTrue(state.showSold)
    }
    func testManualCountryAndMetalOverrideCatalogProperties() {
        var value = coin(); value.properties?.values["country"] = "Россия"; value.properties?.values["metal"] = "gold 999"
        var state = CollectionBrowserState(); state.countries = ["Россия"]; state.metals = ["Золото"]
        XCTAssertEqual(filterCollection([value], state: state).count, 1)
    }
    func testCountryAliasesAndRussianCountEndings() {
        XCTAssertEqual(collectionCountry("Ghana"), collectionCountry("Гана"))
        XCTAssertEqual(collectionCountry("USSR"), "СССР")
        XCTAssertEqual(collectionCountry("SU"), "СССР")
        XCTAssertNotEqual(collectionCountry("SU"), collectionCountry("RU"))
        XCTAssertEqual(collectionCountry("BI"), "Бурунди")
        XCTAssertTrue(collectionCountrySuggestions("Буру").contains("Бурунди"))
        XCTAssertEqual(collectionCountrySuggestions("SU").first, "СССР")
        XCTAssertEqual(collectionCountry("Côte d’Ivoire"), "Кот-д-Ивуар")
        XCTAssertEqual(collectionCountLabel(1), "1 монета"); XCTAssertEqual(collectionCountLabel(22), "22 монеты")
        XCTAssertEqual(collectionCountLabel(14), "14 монет")
        XCTAssertEqual(collectionCountLabel(1, accusative: true), "1 монету")
        XCTAssertEqual(collectionCountLabel(21, accusative: true), "21 монету")
    }
    func testUnknownValuationSortsLastInBothDirections() {
        var priced = coin("priced"); priced.valuation = CoinValuation(id: "v", medianMinor: 500, status: "ready")
        var state = CollectionBrowserState(); state.sort = .valueAscending
        XCTAssertEqual(filterCollection([coin(), priced], state: state).map(\.id), ["priced", "coin"])
        state.sort = .value; XCTAssertEqual(filterCollection([coin(), priced], state: state).map(\.id), ["priced", "coin"])
    }
    func testOverviewSelectionClearsPreviousConditionsButKeepsLayout() {
        var state = CollectionBrowserState(); state.query = "Россия"; state.showSold = true; state.grade = "VF"; state.listMode = true
        state.selectOverview(CollectionQuickFilter(kind: .country, value: "Ghana"))
        XCTAssertEqual(state.countries, [collectionCountry("Ghana")!]); XCTAssertFalse(state.showSold)
        XCTAssertEqual(state.query, ""); XCTAssertEqual(state.grade, ""); XCTAssertTrue(state.listMode)
    }
    func testBrowserRestoresSearchFiltersAndPositionPerAccount() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = LibraryDisk(root: root)
        var state = CollectionBrowserState(); state.query = "барс"; state.metals = ["Серебро"]; state.anchorID = "coin"; state.listMode = true
        try await disk.saveBrowser(state, account: "first")
        let reopened = try await LibraryDisk(root: root).loadBrowser(account: "first")
        let other = try await disk.loadBrowser(account: "second")
        XCTAssertEqual(reopened, state); XCTAssertEqual(other, CollectionBrowserState())
    }
}
