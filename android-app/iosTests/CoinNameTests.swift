import XCTest
@testable import Numi

final class CoinNameTests: XCTestCase {
    func testCatalogReplacesAutomaticRecognitionButKeepsOwnName() {
        let next = CoinName(label: "Воронеж", source: CoinName.automatic).selecting("Боровск")
        XCTAssertEqual(next.label, "Боровск"); XCTAssertEqual(next.source, CoinName.automatic)
        let own = CoinName(label: "Подарок от дедушки", source: CoinName.user)
        XCTAssertEqual(own.selecting("Боровск"), own)
        XCTAssertEqual(own.recognizing("Воронеж"), own)
        XCTAssertEqual(own.title(catalogName: "Боровск"), own.label)
    }
    func testMissingOrFutureLegacySourceDoesNotEstablishAuthorship() {
        for source in [nil, "unknown", "future-source"] as [String?] {
            let legacy = CoinName(label: "Собственное название", source: source)
            XCTAssertEqual(legacy.selecting("Боровск"), legacy)
            XCTAssertEqual(legacy.recognizing("Воронеж"), legacy)
            XCTAssertEqual(legacy.title(catalogName: "Боровск"), "Боровск")
        }
    }
    func testActualEditMarksOwnNameAndClearingRestoresCatalogName() {
        let initial = CoinName(label: "Боровск", source: CoinName.automatic)
        XCTAssertEqual(initial.editing(" Боровск "), initial)
        let own = initial.editing("Моя монета")
        XCTAssertEqual(own.source, CoinName.user)
        let cleared = own.editing("  ")
        XCTAssertNil(cleared.label); XCTAssertEqual(cleared.source, CoinName.automatic)
        XCTAssertEqual(cleared.title(catalogName: "Боровск"), "Боровск")
    }
    func testOnlyGeneratedPlaceholdersAreReplaceable() {
        XCTAssertEqual(CoinName(label: "Нераспознанная монета", source: nil).selecting("Боровск").label, "Боровск")
        let own = CoinName(label: "Нераспознанная монета", source: CoinName.user)
        XCTAssertEqual(own.selecting("Боровск"), own)
    }
    func testLateRecognitionCannotReplaceSelectedCatalogName() {
        XCTAssertEqual(CoinName(label: "Боровск", source: CoinName.automatic)
            .recognizing("Воронеж", catalogName: "Боровск").label, "Боровск")
    }
    func testNameSourceSurvivesCoinEncodingAndLegacyDecoding() throws {
        var coin = Coin(id: "coin", version: 1, typeId: 618, typeName: "Боровск",
            userLabel: "Подарок от дедушки", status: "active")
        coin.userLabelSource = CoinName.user
        let reopened = try JSONDecoder().decode(Coin.self, from: JSONEncoder().encode(coin))
        XCTAssertEqual(reopened.userLabelSource, CoinName.user)
        XCTAssertEqual(reopened.title, "Подарок от дедушки")
        let legacy = try JSONDecoder().decode(Coin.self, from: Data(#"{"id":"coin","version":1,"userLabel":"Моё имя","status":"active"}"#.utf8))
        XCTAssertNil(legacy.userLabelSource); XCTAssertEqual(legacy.title, "Моё имя")
    }
    func testLinkAndEditPayloadCarrySourceAndExplicitNameReset() throws {
        let link = LinkCatalogInput(typeId: 618, issueId: nil, identifiedYear: nil, properties: CoinProperties(),
            userLabel: "Боровск", userLabelSource: CoinName.automatic)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(link)) as? [String: Any])
        XCTAssertEqual(json["userLabel"] as? String, "Боровск")
        XCTAssertEqual(json["userLabelSource"] as? String, CoinName.automatic)
        let edit = UpdateCoinInput(properties: CoinProperties(), userLabelSource: CoinName.automatic)
        let reset = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(edit)) as? [String: Any])
        XCTAssertTrue(reset["userLabel"] is NSNull)
        XCTAssertEqual(reset["userLabelSource"] as? String, CoinName.automatic)
    }
    func testLongCatalogNameKeepsFullTitleWithoutExceedingLabelContract() {
        let full = String(repeating: "А", count: 240)
        let name = CoinName(label: nil, source: nil).selecting(full)
        XCTAssertEqual(name.label?.count, 200)
        XCTAssertEqual(name.title(catalogName: full), full)
        XCTAssertEqual(CoinName(label: nil, source: nil).recognizing(full).label?.count, 200)
        XCTAssertEqual(CoinName(label: nil, source: nil).editing(full).label, full)
    }
}
