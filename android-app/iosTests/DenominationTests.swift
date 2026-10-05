import XCTest
@testable import Numi

final class DenominationTests: XCTestCase {
    func testFullDenominationAndFractions() {
        for (raw,value,unit) in [("1 копейка серебром","1","копейка серебром"),
            ("1 КОПѢЙКА СЕРЕБРОМЪ","1","КОПѢЙКА СЕРЕБРОМЪ"),
            ("1,5 рубля","1.5","рубля"),("1/2 доллара","0.5","доллара"),
            ("1 1/2 рубля","1.5","рубля"),("1½ рубля","1.5","рубля"),
            ("100 shillings","100","shillings"),("1 бу","1","бу")] {
            let parsed=parseCoinDenomination(raw)
            XCTAssertTrue(parsed.valid,raw);XCTAssertEqual(parsed.value,value);XCTAssertEqual(parsed.unit,unit)
        }
    }
    func testManualTextAndClearingSurviveEncoding() throws {
        let raw=" 1  КОПѢЙКА СЕРЕБРОМЪ "
        let properties=CoinProperties().editingDenomination(raw)
        let restored=try JSONDecoder().decode(CoinProperties.self,from:JSONEncoder().encode(properties))
        XCTAssertEqual(restored.denominationText(),raw);XCTAssertNil(restored.value("metal"))
        XCTAssertEqual(restored.editingDenomination("").denominationText(fallback:"1 рубль"),"")
    }
    func testLegacyCompleteUnitHasOneNumber() {
        let p=CoinProperties(values:["denominationValue":"1","denominationUnit":"1 копейка серебром"])
        XCTAssertEqual(p.denominationText(),"1 копейка серебром")
    }
    func testInvalidNumbersCannotBeSaved() {
        for raw in ["1/0 рубля","-1 рубль","0 бу","1 2 монеты"] { XCTAssertFalse(parseCoinDenomination(raw).valid,raw) }
    }
}
