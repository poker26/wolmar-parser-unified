import XCTest

final class NumiUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    private func waitUntilHittable(_ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        guard element.waitForExistence(timeout: timeout) else { return false }
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hittable == true"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }
    func testNewAccountAddsFirstCatalogCoin() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-onboarding-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["auth.register"].waitForExistence(timeout: 10))
        app.buttons["auth.register"].tap()
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("new@example.invalid")
        app.swipeUp(); app.buttons["login.submit"].tap()
        XCTAssertTrue(app.buttons["album.add"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["album.add"].tap()
        let catalogResult = app.descendants(matching: .any).matching(identifier: "add.catalog.42").firstMatch
        XCTAssertTrue(catalogResult.waitForExistence(timeout: 10), app.debugDescription)
        app.swipeUp()
        XCTAssertTrue(waitUntilHittable(catalogResult), app.debugDescription)
        catalogResult.tap()
        app.swipeUp()
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "First coin"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["add.save"].tap()
        XCTAssertTrue(app.buttons["coin.saved-first-coin"].waitForExistence(timeout: 10))
        app.buttons["coin.saved-first-coin"].tap()
        XCTAssertTrue(app.staticTexts["Тираж"].waitForExistence(timeout: 5))
    }
    func testRecoveryRejectsWrongCodeAndOpensAlbumAfterValidCode() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-onboarding-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["auth.forgot"].waitForExistence(timeout: 10))
        app.buttons["auth.forgot"].tap()
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("new@example.invalid")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.textFields["auth.code"].waitForExistence(timeout: 5))
        app.textFields["auth.code"].tap(); app.textFields["auth.code"].typeText("WRONG")
        app.swipeUp(); app.buttons["login.submit"].tap()
        XCTAssertTrue(app.staticTexts["Код не подошёл или истёк. Запросите новый код."].waitForExistence(timeout: 5), app.debugDescription)
        app.swipeDown()
        let code = app.textFields["auth.code"]; code.tap(); code.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5) + "TEST-CODE-1234")
        app.swipeUp(); app.buttons["login.submit"].tap()
        XCTAssertTrue(app.buttons["album.add"].waitForExistence(timeout: 10), app.debugDescription)
    }
    func testAlbumCardAndOverview() {
        let app = XCUIApplication()
        app.launchArguments = ["-numi-ui-fixture"]
        app.launch()
        XCTAssertTrue(app.textFields["album.search"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.buttons["coin.demo-1"].frame.minY, app.buttons["coin.demo-2"].frame.minY, accuracy: 2)
        let album = XCTAttachment(screenshot: app.screenshot()); album.name = "Album"; album.lifetime = .keepAlways; add(album)
        app.buttons["coin.demo-1"].tap()
        XCTAssertTrue(app.staticTexts["Тираж"].waitForExistence(timeout: 5))
        let card = XCTAttachment(screenshot: app.screenshot()); card.name = "Coin card"; card.lifetime = .keepAlways; add(card)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Обзор коллекции"].tap()
        XCTAssertTrue(app.staticTexts["Оценены 1 из 2 монет"].waitForExistence(timeout: 5))
        let overview = XCTAttachment(screenshot: app.screenshot()); overview.name = "Overview"; overview.lifetime = .keepAlways; add(overview)
        app.buttons["Готово"].tap()
        let search = app.textFields["album.search"]
        search.tap(); search.typeText("no-match")
        XCTAssertTrue(app.staticTexts["Монеты не найдены."].waitForExistence(timeout: 5))
    }
}
