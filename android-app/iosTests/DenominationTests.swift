import XCTest
@testable import Numi

final class DenominationTests: XCTestCase {
    func testManualLiteralSurvivesEncodingWithoutLocalNormalization() throws {
        let previous = CoinProperties(values: ["denominationValue":"10","denominationUnit":"копеек"])
        for raw in [" 1  КОПѢЙКА СЕРЕБРОМЪ ", "1½ рубля", "1/2 доллара", "1 бу"] {
            let properties = previous.editingDenomination(raw)
            let restored = try JSONDecoder().decode(CoinProperties.self, from: JSONEncoder().encode(properties))
            XCTAssertEqual(restored.denominationText(), raw)
            XCTAssertNil(restored.value("denominationValue"))
            XCTAssertNil(restored.value("denominationUnit"))
            XCTAssertNil(restored.value("metal"))
            XCTAssertEqual(restored.editingDenomination("").denominationText(fallback: "1 рубль"), "")
        }
    }

    func testLegacyCompleteUnitHasOneNumber() {
        let p = CoinProperties(values: ["denominationValue":"1","denominationUnit":"1 копейка серебром"])
        XCTAssertEqual(p.denominationText(), "1 копейка серебром")
    }
}
