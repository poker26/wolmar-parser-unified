import XCTest

final class NumiUITests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    func testLinkedCoinOwnNameAppearsInCardAndCollectionAndCanBeCleared() {
        let app = beginCapture()
        acceptPhoto(app); acceptPhoto(app)
        XCTAssertTrue(app.buttons["add.candidate.42"].waitForExistence(timeout: 10))
        app.buttons["add.candidate.42"].tap(); app.buttons["add.confirm"].tap()
        let coin = app.buttons["coin.saved-first-coin"]
        XCTAssertTrue(coin.waitForExistence(timeout: 10)); coin.tap()
        XCTAssertTrue(app.buttons["coin.edit"].waitForExistence(timeout: 5)); app.buttons["coin.edit"].tap()
        let name = app.textFields["edit.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        let previous = name.value as? String ?? ""
        name.tap(); name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count) + "Подарок от дедушки")
        app.buttons["edit.save"].tap()
        XCTAssertTrue(app.staticTexts["coin.title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["coin.title"].label, "Подарок от дедушки")
        attach(app, "Linked coin custom name")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(coin.waitForExistence(timeout: 5)); XCTAssertTrue(coin.label.contains("Подарок от дедушки"))
        coin.tap(); app.buttons["coin.edit"].tap()
        XCTAssertTrue(name.waitForExistence(timeout: 5)); name.tap()
        name.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Подарок от дедушки".count))
        app.buttons["edit.save"].tap()
        XCTAssertTrue(app.staticTexts["coin.title"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.staticTexts["coin.title"].label, "25 рублей. Камчатская экспедиция")
        attach(app, "Linked coin restored catalog name")
    }
    func testCollectionFiltersStaySelectedAfterDetailAndOverviewReturn() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["album.filters"].waitForExistence(timeout: 10))
        app.buttons["album.filters"].tap()
        let country = app.buttons["filters.choice.Россия"]
        XCTAssertTrue(country.waitForExistence(timeout: 5)); country.tap()
        XCTAssertEqual(app.buttons["filters.apply"].label, "Показать 1 монету")
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Collection filters"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["filters.apply"].tap()
        XCTAssertTrue(app.buttons["coin.demo-1"].waitForExistence(timeout: 5)); XCTAssertFalse(app.buttons["coin.demo-2"].exists)
        app.buttons["coin.demo-1"].tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["coin.demo-1"].waitForExistence(timeout: 5)); XCTAssertFalse(app.buttons["coin.demo-2"].exists)
        app.buttons["tab.overview"].tap(); app.buttons["tab.collection"].tap()
        XCTAssertTrue(app.buttons["coin.demo-1"].waitForExistence(timeout: 5)); XCTAssertFalse(app.buttons["coin.demo-2"].exists)
        app.swipeDown()
        app.buttons["album.filters"].tap(); app.buttons["filters.reset"].tap(); app.buttons["filters.apply"].tap()
        XCTAssertTrue(app.buttons["coin.demo-2"].waitForExistence(timeout: 5))
    }
    func testCancelFiltersDoesNotChangeCollectionAndSearchMatchesAnyWordOrder() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["album.filters"].waitForExistence(timeout: 10))
        app.buttons["album.filters"].tap(); app.buttons["filters.choice.Россия"].tap(); app.buttons["filters.cancel"].tap()
        XCTAssertTrue(app.buttons["coin.demo-2"].waitForExistence(timeout: 5))
        let search = app.textFields["album.search"]; search.tap(); search.typeText("2004 Russia экспедиция")
        XCTAssertTrue(app.buttons["coin.demo-1"].waitForExistence(timeout: 5)); XCTAssertFalse(app.buttons["coin.demo-2"].exists)
    }
    func testOverviewShowsDailyHistoryAndReturnsToCollection() {
        let app = XCUIApplication(); app.launchArguments = ["-numi-ui-fixture"]; app.launch()
        XCTAssertTrue(app.buttons["tab.overview"].waitForExistence(timeout: 10)); app.buttons["tab.overview"].tap()
        for _ in 0..<3 {
            if app.staticTexts["overview.history.title"].isHittable { break }
            app.swipeUp()
        }
        XCTAssertTrue(app.staticTexts["overview.history.title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["overview.history.total"].exists)
        XCTAssertTrue(app.staticTexts["overview.history.change"].label.contains("25%"))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Collection daily value history"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["tab.collection"].tap(); XCTAssertTrue(app.buttons["album.filters"].waitForExistence(timeout: 5))
    }
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
        let app = beginCapture()
        acceptPhoto(app)
        acceptPhoto(app)
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
        app.buttons["coin.saved-first-coin"].tap()
        app.buttons["coin.actions"].tap()
        app.buttons["coin.delete"].tap()
        let deleteAlert = app.alerts["Удалить монету?"]
        XCTAssertTrue(deleteAlert.waitForExistence(timeout: 5), app.debugDescription)
        // SwiftUI exposes nested accessibility nodes for this single control.
        let confirmDelete = deleteAlert.buttons.matching(identifier: "coin.confirmDelete").firstMatch
        XCTAssertTrue(waitUntilHittable(confirmDelete), app.debugDescription)
        confirmDelete.tap()
        XCTAssertTrue(app.buttons["album.add"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertFalse(app.buttons["coin.saved-first-coin"].exists)
        app.buttons["tab.overview"].tap(); app.buttons["tab.collection"].tap()
        XCTAssertFalse(app.buttons["coin.saved-first-coin"].exists)
    }
    func testManualPropertiesAreSeparateAndBackReturnsToChoices() {
        let app = beginCapture()
        acceptPhoto(app); acceptPhoto(app)
        XCTAssertTrue(app.buttons["add.candidate.42"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["add.manual"].waitForExistence(timeout: 10))
        app.buttons["add.manual"].tap()
        XCTAssertTrue(app.textFields["add.label"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.textFields["add.country"].value as? String, "Россия")
        let country = app.textFields["add.country"]
        country.tap(); country.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6) + "SU")
        app.buttons["country.suggestion.СССР"].tap()
        XCTAssertEqual(country.value as? String, "СССР")
        attach(app, "Soviet country name")
        XCTAssertFalse(app.buttons["add.confirm"].exists)
        app.buttons["add.back"].tap()
        XCTAssertTrue(app.buttons["add.candidate.42"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["add.label"].exists)
    }
    func testCaptureGuidesBothSidesAndRetakeCancellationKeepsFirstPhoto() {
        let app = beginCapture()
        XCTAssertFalse(app.buttons["add.save"].exists)
        XCTAssertEqual(app.buttons["add.camera"].label, "Снять одну сторону")
        attach(app, "Capture empty")
        XCTAssertLessThan(app.staticTexts["add.captureHeading"].frame.minY, app.frame.height * 0.3)
        XCTAssertTrue(app.buttons["add.camera"].isHittable)
        acceptPhoto(app)
        XCTAssertTrue(app.buttons["add.camera"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["add.camera"].label, "Снять другую сторону")
        XCTAssertFalse(app.buttons["add.save"].exists)
        XCTAssertTrue(app.images["add.photo.0"].exists)
        XCTAssertFalse(app.images["add.photo.1"].exists)
        attach(app, "Capture first side")
        app.buttons["add.back"].tap()
        XCTAssertTrue(app.buttons["album.add"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'coin.'")).firstMatch.exists)
        app.buttons["album.add"].tap()
        XCTAssertTrue(app.images["add.photo.0"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["add.camera"].label, "Снять другую сторону")
        attach(app, "Capture restored first side")
        XCTAssertLessThan(app.staticTexts["add.captureHeading"].frame.minY, app.frame.height * 0.3)
        XCTAssertTrue(app.buttons["add.camera"].isHittable)
        app.buttons["add.retake.0"].tap()
        XCTAssertTrue(app.buttons["fixture.cancel"].waitForExistence(timeout: 5))
        app.buttons["fixture.cancel"].tap()
        XCTAssertTrue(app.images["add.photo.0"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons["add.camera"].label, "Снять другую сторону")
        acceptPhoto(app)
        XCTAssertTrue(app.buttons["add.candidate.42"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertTrue(app.images["add.photo.0"].exists); XCTAssertTrue(app.images["add.photo.1"].exists)
        XCTAssertFalse(app.buttons["add.camera"].exists)
        XCTAssertFalse(app.buttons["add.identify"].exists)
        attach(app, "Capture automatic identification")
    }
    func testIdentificationFailureKeepsBothPhotosAndAllowsManualSave() {
        let app = beginCapture(extra: ["-numi-identification-failure"])
        acceptPhoto(app); acceptPhoto(app)
        XCTAssertTrue(app.buttons["add.identify"].waitForExistence(timeout: 10), app.debugDescription)
        XCTAssertEqual(app.buttons["add.identify"].label, "Повторить определение")
        XCTAssertTrue(app.images["add.photo.0"].exists); XCTAssertTrue(app.images["add.photo.1"].exists)
        attach(app, "Capture identification failed")
        app.buttons["add.manual"].tap()
        XCTAssertTrue(app.textFields["add.label"].waitForExistence(timeout: 5))
        app.textFields["add.label"].tap(); app.textFields["add.label"].typeText("Моя монета")
        app.buttons["add.save"].tap()
        XCTAssertTrue(app.buttons["coin.saved-first-coin"].waitForExistence(timeout: 10), app.debugDescription)
        app.buttons["coin.saved-first-coin"].tap()
        XCTAssertTrue(app.staticTexts["Моя монета"].waitForExistence(timeout: 5))
        let photo = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Фото монеты")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 5), app.debugDescription)
    }
    private func beginCapture(extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-numi-onboarding-fixture", "-numi-capture-fixture"] + extra
        app.launch(); app.buttons["Добавить монету"].tap()
        XCTAssertTrue(app.buttons["add.camera"].waitForExistence(timeout: 10), app.debugDescription)
        return app
    }
    private func acceptPhoto(_ app: XCUIApplication) {
        XCTAssertTrue(waitUntilHittable(app.buttons["add.camera"]))
        app.buttons["add.camera"].tap()
        XCTAssertTrue(app.buttons["fixture.shutter"].waitForExistence(timeout: 5), app.debugDescription)
        app.buttons["fixture.shutter"].tap()
        XCTAssertTrue(waitUntilHittable(app.buttons["capture.accept"]), app.debugDescription)
        app.buttons["capture.accept"].tap()
    }
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
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
