import XCTest

final class GolosPreviewUITests: XCTestCase {
    func testScreensAtBothTextSizes() {
        let app = XCUIApplication()
        var ordinaryPriceHeight: CGFloat = 0
        for large in [false, true] {
            let size = large ? "large" : "regular"
            app.launchArguments = ["-numi-ui-fixture", "-numi-golos-preview"] + (large ? ["-numi-golos-large"] : [])
            app.launch()
            let coin = app.buttons["coin.demo-1"]
            XCTAssertTrue(coin.waitForExistence(timeout: 15))
            capture(app, "collection-" + size)
            coin.tap()
            let title = app.staticTexts["coin.title"]
            XCTAssertTrue(title.waitForExistence(timeout: 10))
            XCTAssertTrue(title.label.contains("Памятная монета Банка России"))
            if !title.isHittable { app.swipeUp(velocity: .slow) }
            capture(app, "coin-" + size)
            let amount = app.staticTexts["coin.amount"].firstMatch
            let price = amount.exists ? amount : app.buttons["coin.market"]
            for _ in 0..<3 where !price.isHittable { app.swipeUp(velocity: .slow) }
            XCTAssertTrue(price.isHittable)
            XCTAssertEqual(price.label.filter { $0.isNumber }, "1234567890125")
            XCTAssertTrue(price.label.contains("₽"))
            XCTAssertLessThanOrEqual(price.frame.maxX, app.frame.maxX)
            if large { XCTAssertGreaterThan(price.frame.height, ordinaryPriceHeight) }
            else { ordinaryPriceHeight = price.frame.height }
            capture(app, "price-" + size)
            app.navigationBars.buttons.element(boundBy: 0).tap()
            app.buttons["tab.catalog"].tap()
            let country = app.staticTexts["Россия"]
            XCTAssertTrue(country.waitForExistence(timeout: 10))
            country.tap()
            let catalogCoin = app.buttons["catalog.result.42"]
            XCTAssertTrue(catalogCoin.waitForExistence(timeout: 10))
            if !catalogCoin.isHittable { app.swipeUp(velocity: .slow) }
            capture(app, "catalog-" + size)
            app.terminate()
        }
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "golos-ios-" + name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
