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
        app.buttons["Уже есть аккаунт? Войти"].tap()
        XCTAssertTrue(app.buttons["auth.register"].waitForExistence(timeout: 10))
        app.buttons["auth.register"].tap()
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("new@example.invalid")
        app.swipeUp(); app.buttons["login.submit"].tap()
        XCTAssertTrue(app.buttons["album.add"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["album.add"].tap()
        app.buttons["add.find"].tap()
        app.textFields["match.country"].tap(); app.textFields["match.country"].typeText("Россия")
        app.buttons["match.search"].tap()
        let catalogResult = app.buttons["match.result.type:42"]
        XCTAssertTrue(catalogResult.waitForExistence(timeout: 10), app.debugDescription)
        app.swipeUp()
        XCTAssertTrue(waitUntilHittable(catalogResult), app.debugDescription)
        catalogResult.tap()
        app.swipeUp()
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "First coin"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["match.confirm"].tap()
        XCTAssertTrue(app.buttons["coin.saved-first-coin"].waitForExistence(timeout: 10))
        app.buttons["coin.saved-first-coin"].tap()
        XCTAssertTrue(app.staticTexts["Тираж"].waitForExistence(timeout: 5))
    }
    func testRecognitionSearchBackKeepsSelectionAndConfirmationSavesCoin() {
        let app = XCUIApplication()
        app.launchArguments = ["-numi-onboarding-fixture", "-numi-journey-fixture"]; app.launch()
        app.buttons["Добавить монету"].tap()
        let candidate = app.buttons["add.candidate.42"]
        XCTAssertTrue(candidate.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.buttons["add.save"].exists)
        XCTAssertFalse(app.buttons["Отметить проданной"].exists)
        XCTAssertFalse(app.buttons["coin.market"].exists)
        candidate.tap()
        XCTAssertTrue(app.buttons["add.confirm"].isEnabled)
        app.buttons["add.find"].tap()
        XCTAssertTrue(app.buttons["match.back"].waitForExistence(timeout: 5))
        app.buttons["match.back"].tap()
        XCTAssertTrue(candidate.waitForExistence(timeout: 5))
        XCTAssertEqual(candidate.value as? String, "selected")
        XCTAssertFalse(app.textFields["add.label"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Recognition choice after search back"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["add.confirm"].tap()
        XCTAssertTrue(app.buttons["coin.saved-first-coin"].waitForExistence(timeout: 10), app.debugDescription)
    }
    func testManualPropertiesAreSeparateAndBackReturnsToChoices() {
        let app = XCUIApplication()
        app.launchArguments = ["-numi-onboarding-fixture", "-numi-journey-fixture"]; app.launch()
        app.buttons["Добавить монету"].tap()
        XCTAssertTrue(app.buttons["add.manual"].waitForExistence(timeout: 10))
        app.buttons["add.manual"].tap()
        XCTAssertTrue(app.textFields["add.label"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["add.country"].value as? String, "Россия")
        XCTAssertFalse(app.buttons["add.confirm"].exists)
        app.buttons["add.back"].tap()
        XCTAssertTrue(app.buttons["add.candidate.42"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["add.label"].exists)
    }
    func testRecoveryRejectsWrongCodeAndOpensAlbumAfterValidCode() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-onboarding-fixture"]; app.launch()
        app.buttons["Уже есть аккаунт? Войти"].tap()
        XCTAssertTrue(app.buttons["auth.forgot"].waitForExistence(timeout: 10))
        app.buttons["auth.forgot"].tap()
        app.textFields["login.email"].tap(); app.textFields["login.email"].typeText("new@example.invalid")
        app.buttons["login.submit"].tap()
        XCTAssertTrue(app.textFields["auth.code"].waitForExistence(timeout: 5))
        app.textFields["auth.code"].tap(); app.textFields["auth.code"].typeText("WRONG")
        app.swipeUp(); app.buttons["login.submit"].tap()
        XCTAssertTrue(app.staticTexts["Код не подошёл или истёк. Запросите новый код."].waitForExistence(timeout: 5), app.debugDescription)
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
        app.buttons["tab.overview"].tap()
        XCTAssertTrue(app.staticTexts["Оценены 1 из 2 монет"].waitForExistence(timeout: 5))
        let overview = XCTAttachment(screenshot: app.screenshot()); overview.name = "Overview"; overview.lifetime = .keepAlways; add(overview)
        app.buttons["tab.collection"].tap()
        let search = app.textFields["album.search"]
        search.tap(); search.typeText("no-match")
        XCTAssertTrue(app.staticTexts["Монеты не найдены."].waitForExistence(timeout: 5))
    }
    func testWholeCollectionRevaluationFromOverview() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["tab.overview"].waitForExistence(timeout: 10))
        app.buttons["tab.overview"].tap()
        let button = app.buttons["recalculate-collection"]
        XCTAssertTrue(waitUntilHittable(button), app.debugDescription)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: button)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 10), .completed)
        button.tap()
        XCTAssertTrue(app.staticTexts["Пересчёт завершён. Обработано монет: 2."].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.staticTexts["Недостаточно данных для оценки 1 монет."].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Whole collection revaluation"; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testStoreScreenshots() {
        let app = XCUIApplication()
        app.launchArguments = ["-numi-store-fixture"]
        app.launch()
        XCTAssertTrue(app.buttons["coin.demo-1"].waitForExistence(timeout: 15), app.debugDescription)
        let photo = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Фото монеты")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10), "Фото должны загрузиться до съёмки витрины.")
        let album = XCTAttachment(screenshot: app.screenshot())
        album.name = "Store album"
        album.lifetime = .keepAlways
        add(album)

        app.buttons["coin.demo-1"].tap()
        XCTAssertTrue(app.staticTexts["Металл"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(photo.waitForExistence(timeout: 10), "На карточке должно быть фото монеты.")
        let card = XCTAttachment(screenshot: app.screenshot())
        card.name = "Store coin"
        card.lifetime = .keepAlways
        add(card)

        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["coin.demo-2"].tap()
        XCTAssertTrue(app.staticTexts["1000 шиллингов. Леопард"].waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(photo.waitForExistence(timeout: 10), "На карточке должно быть фото золотой монеты.")
        let gold = XCTAttachment(screenshot: app.screenshot())
        gold.name = "Store gold coin"
        gold.lifetime = .keepAlways
        add(gold)
    }
    func testGuestCanOpenCatalog() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-onboarding-fixture"]; app.launch()
        app.buttons["Открыть каталог"].tap()
        XCTAssertTrue(app.staticTexts["Россия"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.buttons["tab.catalog"].exists)
    }
    func testCatalogStaysAtTopAcrossDirectoryResultsAndDetail() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-ui-fixture"]; app.launch()
        app.buttons["tab.catalog"].tap()
        let header = app.staticTexts["catalog.header"]
        XCTAssertTrue(header.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(header.frame.minY, app.frame.height * 0.2)

        let country = app.staticTexts["Россия"]
        XCTAssertTrue(country.waitForExistence(timeout: 10), app.debugDescription)
        country.tap()
        let result = app.buttons["catalog.result.42"]
        XCTAssertTrue(result.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(header.frame.minY, app.frame.height * 0.2)

        result.tap()
        let detailHeader = app.staticTexts["catalog.detail.header"]
        XCTAssertTrue(detailHeader.waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertLessThan(detailHeader.frame.minY, app.frame.height * 0.2)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Catalog detail layout"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
