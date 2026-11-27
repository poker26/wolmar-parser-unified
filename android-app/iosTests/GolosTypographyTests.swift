import XCTest
import UIKit
@testable import Numi

final class GolosTypographyTests: XCTestCase {
    func testBundledFacesAndAmountBoundaries() {
        for face in ["GolosText-Regular", "GolosText-Medium", "GolosText-SemiBold"] {
            XCTAssertNotNil(UIFont(name: face, size: 16))
        }
        XCTAssertEqual(Golos.wrappedAmount("12\u{00a0}345\u{202f}678,25\u{00a0}₽"),
                       "12 345 678\u{2060},\u{2060}25 ₽")
    }
}
