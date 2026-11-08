import XCTest
import UIKit
@testable import Numi

final class CoinJourneyTests: XCTestCase {
    @MainActor func testCorrectedSpecimenYearSurvivesChoosingARepresentativeCatalogType() throws {
        let draft=AddCoinModel(model:NumiModel(telemetryEnabled:false))
        draft.year="1870"
        var choice=try JSONDecoder().decode(SpecimenChoice.self,from:Data(#"{"key":"type:400281","kind":"catalog","id":"400281","typeId":400281,"name":"10 öre","year":1961}"#.utf8))
        choice.selectedYear=1970
        draft.choose(choice)
        let pending=try draft.makePending()
        XCTAssertEqual(pending.input.identifiedYear,1970)
        XCTAssertEqual(pending.input.properties?.value("year"),"1970")
        XCTAssertEqual(pending.coin.catalog?.year,1961)
    }

    func testSearchFacetsAreOptionalAndRetainLiteralDenominationAndCounts() throws {
        let old = try JSONDecoder().decode(SpecimenSearchResponse.self, from: Data(#"{"total":0,"items":[]}"#.utf8))
        XCTAssertNil(old.denominations)
        let current = try JSONDecoder().decode(SpecimenSearchResponse.self,
            from: Data(#"{"total":0,"items":[],"denominations":[{"value":"1 гульден","count":8}],"years":[{"value":"1972","count":1}]}"#.utf8))
        XCTAssertEqual(current.denominations?.first?.value, "1 гульден")
        XCTAssertEqual(current.denominations?.first?.count, 8)
        XCTAssertEqual(current.years?.first?.value, "1972")
    }
    @MainActor func testNameEditAfterPartialUploadUpdatesRemoteCoinBeforePhotoRetry() async throws {
        let env = try await environment(partialUpload: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        try await env.model.updateCoin("local", input: UpdateCoinInput(userLabel: "Подарок от дедушки",
            properties: CoinProperties(), userLabelSource: CoinName.user))
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.remoteCoin?.userLabel, "Подарок от дедушки")
        XCTAssertEqual(reopened.first?.remoteCoin?.userLabelSource, CoinName.user)
        XCTAssertEqual(reopened.first?.coin.title, "Подарок от дедушки")
        XCTAssertEqual(reopened.first?.photoKeys, ["pending-photo"])
        await env.model.sync(includePhotos: false)
        XCTAssertEqual(env.model.coins.first(where: { $0.id == "local" })?.title, "Подарок от дедушки")
        await env.model.signOut()
    }
    @MainActor func testCatalogChangeAfterPartialUploadUpdatesRemoteNameAndLocalPhotoQueue() async throws {
        let env = try await environment(partialUpload: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        try await env.model.linkCatalog("local", choice: CatalogChoice(id: 618, name: "Боровск"))
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.remoteCoin?.typeId, 618)
        XCTAssertEqual(reopened.first?.remoteCoin?.userLabel, "Боровск")
        XCTAssertEqual(reopened.first?.remoteCoin?.userLabelSource, CoinName.automatic)
        XCTAssertEqual(reopened.first?.coin.title, "Боровск")
        XCTAssertEqual(reopened.first?.photoKeys, ["pending-photo"])
        await env.model.signOut()
    }
    @MainActor func testCatalogSelectionReplacesAutomaticNameAndPersistsOriginOffline() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        draft.label = "10 рублей. Воронеж"; draft.userLabelSource = CoinName.automatic
        draft.choose(CatalogChoice(id: 618, name: "10 рублей. Боровск"))
        let saved = await draft.save(); XCTAssertTrue(saved)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.input.userLabel, "10 рублей. Боровск")
        XCTAssertEqual(reopened.first?.input.userLabelSource, CoinName.automatic)
        XCTAssertEqual(reopened.first?.coin.title, "10 рублей. Боровск")
        XCTAssertEqual(reopened.first?.coin.userLabelSource, CoinName.automatic)
        await env.model.signOut()
    }
    @MainActor func testOwnNameSurvivesDraftRestoreAndCatalogSelection() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        draft.editName("Подарок от дедушки")
        let kept = await draft.keepDraft(); XCTAssertTrue(kept)
        let restored = AddCoinModel(model: env.model); await restored.restore()
        XCTAssertEqual(restored.userLabelSource, CoinName.user)
        restored.choose(CatalogChoice(id: 618, name: "10 рублей. Боровск"))
        let saved = await restored.save(); XCTAssertTrue(saved)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.input.userLabelSource, CoinName.user)
        XCTAssertEqual(reopened.first?.coin.title, "Подарок от дедушки")
        await env.model.signOut()
    }
    @MainActor func testChangingCatalogOfPendingCoinKeepsNameAndInputTogether() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        draft.choose(CatalogChoice(id: 1, name: "Воронеж"))
        let saved = await draft.save(); XCTAssertTrue(saved)
        let pending = try XCTUnwrap(env.model.pendingCoins.first)
        try await env.model.linkCatalog(pending.id, choice: CatalogChoice(id: 618, name: "Боровск"))
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.input.typeId, 618)
        XCTAssertEqual(reopened.first?.input.userLabel, "Боровск")
        XCTAssertEqual(reopened.first?.input.userLabelSource, CoinName.automatic)
        XCTAssertEqual(reopened.first?.coin.title, "Боровск")
        await env.model.signOut()
    }
    func testMarketEntryRequiresUsefulData() throws {
        var coin = Coin(id: "coin", version: 1, status: "active")
        coin.valuation = CoinValuation(id: "floor", valueFloorMinor: 125000, status: "floor_only")
        XCTAssertNil(coin.currentValuationAvailability)
        coin.valuationAvailability = ValuationAvailability(contract: "numi-collection-valuation-v1",
            itemVersion: 1, state: "metal", reason: nil, canRecalculate: false, currency: "RUB",
            amountMinor: 125000, snapshotId: "metal-snapshot", calculatedAt: "2026-11-08T10:00:00Z")
        XCTAssertEqual(coin.currentValuationAvailability?.showDetails, true)
        coin.version = 2
        XCTAssertNil(coin.currentValuationAvailability)
    }
    func testUnlinkPayloadExplicitlyClearsCatalogIdentity() throws {
        let input = LinkCatalogInput(typeId: nil, issueId: nil, identifiedYear: 2022,
            properties: CoinProperties(values: ["metal": "silver"]), userLabel: "Leopard")
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        XCTAssertTrue(json["typeId"] is NSNull); XCTAssertTrue(json["issueId"] is NSNull)
        XCTAssertEqual(json["userLabel"] as? String, "Leopard")
    }
    @MainActor func testExplicitSaveWithoutAcceptingCandidateSavesUnlinkedCoinAndPhotos() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            UIColor.gray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }.jpegData(compressionQuality: 1)!
        await draft.addImages([image, image])
        let candidate = IdentificationCandidate(id: 42, name: "Coin", year: 2022)
        draft.recognition = IdentificationResult(recognizedName: "Leopard", catalogMatch: "ambiguous",
            extracted: IdentifiedFields(year: 2022), candidates: [candidate])
        draft.choose(candidate)
        let saved = await draft.saveWithoutMatch()
        XCTAssertTrue(saved)
        let pending = try XCTUnwrap(env.model.pendingCoins.first)
        XCTAssertNil(pending.input.typeId); XCTAssertEqual(pending.input.userLabel, "Leopard")
        XCTAssertEqual(pending.photoKeys.count, 2)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.photoKeys, pending.photoKeys)
        for key in pending.photoKeys {
            let photo = await env.disk.previewImage(account: "journey", key: key)
            XCTAssertNotNil(photo)
        }
        await env.model.signOut()
    }
    @MainActor func testConfirmPersistsSelectedCatalogAndSnapshotWithoutSecondSave() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        draft.choose(CatalogChoice(id: 42, name: "Coin", year: 2022, country: "Somalia",
            metal: "silver", denomination: "100 shillings", mass: "31.1", subject: "Leopard"))
        let saved = await draft.save()
        XCTAssertTrue(saved)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(reopened.first?.input.typeId, 42)
        XCTAssertEqual(reopened.first?.coin.catalog?.mass, "31.1")
        XCTAssertEqual(reopened.first?.coin.properties?.values["subject"], "Leopard")
        await env.model.signOut()
    }
    @MainActor func testSourceChoiceSavesPropertiesWithoutInventedCatalogType() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        let choice = try JSONDecoder().decode(SpecimenChoice.self, from: Data(#"{"key":"source:123","kind":"source","id":"123","name":"Leopard","country":"Somalia","year":2022,"metal":"silver","mass":"31.1","denomination":"100 shillings"}"#.utf8))
        draft.choose(choice)
        let saved = await draft.save(); XCTAssertTrue(saved)
        let reopened = try await env.disk.loadPending(account: "journey")
        XCTAssertNil(reopened.first?.input.typeId)
        XCTAssertEqual(reopened.first?.input.userLabel, "Leopard")
        XCTAssertEqual(reopened.first?.coin.properties?.values["mass"], "31.1")
        await env.model.signOut()
    }
    @MainActor func testFailedConfirmationKeepsSelectionForRetry() async throws {
        let draft = AddCoinModel(model: NumiModel(telemetryEnabled: false))
        draft.choose(CatalogChoice(id: 42, name: "Coin"))
        let saved = await draft.save()
        XCTAssertFalse(saved); XCTAssertEqual(draft.selected?.id, 42)
        XCTAssertNotNil(draft.error)
    }
    @MainActor func testDeletionRejectsAlreadyInFlightSyncSnapshot() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let started = expectation(description: "sync requested")
        JourneyProtocol.holdNextSync(started: started)
        let sync = Task { await env.model.sync(includePhotos: false) }
        await fulfillment(of: [started], timeout: 5)
        try await env.model.deleteCoin("coin")
        XCTAssertFalse(env.model.coins.contains(where: { $0.id == "coin" }))
        JourneyProtocol.releaseSync()
        await sync.value
        XCTAssertFalse(env.model.coins.contains(where: { $0.id == "coin" }), "Late sync restored deleted coin")
        let reopened = try await env.disk.load(account: "journey")
        XCTAssertNil(reopened.items["coin"])
        await env.model.signOut()
    }
    @MainActor func testFailedDeletionKeepsCoin() async throws {
        let env = try await environment(failDelete: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        do { try await env.model.deleteCoin("coin"); XCTFail("Expected deletion error") } catch { }
        XCTAssertTrue(env.model.coins.contains(where: { $0.id == "coin" }))
        let reopened = try await env.disk.load(account: "journey")
        XCTAssertNotNil(reopened.items["coin"])
        await env.model.signOut()
    }
    @MainActor func testCatalogPassesLiteralFiltersAndPreservesServerOrder() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let page = try await env.model.api.browseCatalog(country: "@country:RU", year: "1999",
            denomination: "1 копейки", query: "СПМД", offset: 50)
        XCTAssertEqual(page.items.map(\.id), [42, 7])
        await env.model.signOut()
    }
    @MainActor func testEmptyDeltaRefreshesSavedMaterialWithoutReplacingTheCardOrPhotos() async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "materials-contract", withExtension: "json", subdirectory: "Fixtures"))
        let coins = try JSONDecoder().decode([Coin].self, from: Data(contentsOf: url))
        let remote = try XCTUnwrap(coins.first { $0.id == "cleared" })
        let env = try await environment(materialFixture: remote)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        await env.model.sync(includePhotos: false)
        let reopened = try await env.disk.load(account: "journey")
        let coin = try XCTUnwrap(reopened.items[remote.id])
        XCTAssertEqual(coin.currentMaterialNormalization?.materialGroup.id, "metal:gold")
        XCTAssertEqual(coin.notes, "Моя заметка")
        XCTAssertNil(coin.finenessLabel)
        XCTAssertEqual(coin.properties?.manualFields, ["fineness"])
        XCTAssertEqual(reopened.photos(for: coin).map(\.id), ["photo-0", "photo-1"])
        XCTAssertEqual(JourneyProtocol.materialListCount, 1)
        await env.model.signOut()
    }
    @MainActor func testTwoAcceptedSidesTriggerOneIdentificationAfterCameraDismissal() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        XCTAssertEqual(draft.step, .firstSide)
        await draft.stagePhoto(photo(), source: "camera", replacing: nil)
        let first = await draft.acceptPhoto(); XCTAssertTrue(first)
        await draft.continueAfterCapture()
        XCTAssertEqual(draft.step, .secondSide); XCTAssertEqual(JourneyProtocol.identificationCount, 0)
        await draft.stagePhoto(photo(.brown), source: "camera", replacing: nil)
        let second = await draft.acceptPhoto(); XCTAssertTrue(second)
        XCTAssertEqual(draft.step, .readyToIdentify)
        XCTAssertEqual(JourneyProtocol.identificationCount, 0, "Wait for the photo review to dismiss")
        await draft.continueAfterCapture()
        XCTAssertEqual(draft.step, .matching)
        XCTAssertEqual(draft.recognition?.identificationSessionId, "session")
        await draft.continueAfterCapture()
        XCTAssertEqual(JourneyProtocol.identificationCount, 1)
        XCTAssertEqual(draft.images.count, 2)
        let savedDraft = try await env.disk.loadAddDraft(account: "journey")
        let stored = try XCTUnwrap(savedDraft)
        for key in stored.photoKeys {
            let original = await env.disk.image(account: "journey", key: "original:" + key)
            XCTAssertNotNil(original)
        }
        await env.model.signOut()
    }
    @MainActor func testRestoreFirstSideThenSecondSideResumesAutomaticIdentification() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        let firstOriginal = photo(), secondOriginal = photo(.brown)
        await draft.stagePhoto(firstOriginal, source: "camera", replacing: nil)
        let first = await draft.acceptPhoto(); XCTAssertTrue(first)
        let kept = await draft.keepDraft(); XCTAssertTrue(kept)
        XCTAssertTrue(env.model.pendingCoins.isEmpty, "Navigation back must keep a draft, not silently add a coin")
        let firstStored = try await storedPhotos(env)
        XCTAssertEqual(firstStored.originals, [firstOriginal])
        let restored = AddCoinModel(model: env.model); await restored.restore()
        XCTAssertEqual(restored.step, .secondSide)
        XCTAssertEqual(restored.images, firstStored.previews, "Restore must read the saved preview, not re-encode it")
        let firstReopened = try await storedPhotos(env)
        XCTAssertEqual(firstReopened.originals, [firstOriginal], "Restoring must preserve the exact original bytes")
        await restored.stagePhoto(secondOriginal, source: "camera", replacing: nil)
        let second = await restored.acceptPhoto(); XCTAssertTrue(second)
        let bothStored = try await storedPhotos(env)
        XCTAssertEqual(bothStored.originals, [firstOriginal, secondOriginal])
        let interrupted = AddCoinModel(model: env.model); await interrupted.restore()
        XCTAssertEqual(interrupted.step, .readyToIdentify)
        XCTAssertEqual(interrupted.images, bothStored.previews)
        await interrupted.continueAfterCapture()
        XCTAssertEqual(interrupted.step, .matching); XCTAssertEqual(JourneyProtocol.identificationCount, 1)
        let afterIdentification = try await storedPhotos(env)
        XCTAssertEqual(afterIdentification.originals, [firstOriginal, secondOriginal])
        await env.model.signOut()
    }
    @MainActor func testCorrectingMisreadYearPersistsTheSameCoinAndBothPhotos() async throws {
        let env = try await environment(failIdentification: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        await draft.addImages([photo(), photo(.brown)])
        await draft.identify()
        let before = try XCTUnwrap(env.model.pendingCoins.first)
        try await draft.correctYear(1972)
        let reopened = AddCoinModel(model: env.model); await reopened.restore()
        XCTAssertEqual(reopened.year, "1972")
        let stored = try await env.disk.loadPending(account: "journey")
        let after = try XCTUnwrap(stored.first)
        XCTAssertEqual(after.id, before.id); XCTAssertEqual(after.photoKeys, before.photoKeys)
        XCTAssertEqual(after.input.identifiedYear, 1972); XCTAssertNil(after.input.typeId)
        XCTAssertEqual(reopened.images.count, 2)
        await env.model.signOut()
    }
    @MainActor func testPendingDecisionSurvivesReopeningAndCanBeCheckedFromSavedCoin() async throws {
        let env = try await environment(pendingIdentification: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model)
        await draft.restore()
        for data in [photo(), photo(.brown)] {
            await draft.stagePhoto(data, source: "camera", replacing: nil)
            let accepted = await draft.acceptPhoto()
            XCTAssertTrue(accepted)
        }
        await draft.continueAfterCapture()
        XCTAssertEqual(draft.step, .awaitingDecision)
        let restored = AddCoinModel(model: env.model)
        await restored.restore()
        XCTAssertEqual(restored.step, .awaitingDecision)
        await restored.continueAfterCapture()
        XCTAssertEqual(restored.recognition?.decisionState, "executing")
        restored.editName("Моя монета")
        restored.year = "1999"
        let saved = await restored.saveWithoutMatch()
        XCTAssertTrue(saved)
        let itemID = restored.captureAttemptID
        let result = try await env.model.checkRecognitionResult(for: itemID)
        XCTAssertEqual(result?.result.candidates.first?.id, 42)
        XCTAssertEqual(JourneyProtocol.identificationCount, 1)
        XCTAssertEqual(JourneyProtocol.resultCount, 2)
        let pending = try await env.disk.loadPending(account: "journey")
        let coin = try XCTUnwrap(pending.first(where: { $0.id == itemID }))
        XCTAssertEqual(coin.photoKeys.count, 2)
        XCTAssertEqual(coin.input.userLabel, "Моя монета")
        XCTAssertEqual(coin.input.identifiedYear, 1999)
        XCTAssertNil(coin.input.typeId)
        XCTAssertEqual(coin.recognitionHint?.result.decisionState, "completed")
        XCTAssertEqual(coin.recognitionHint?.result.decisionId, "shared-pending")
        XCTAssertEqual(coin.recognitionHint?.result.decisionRevision, 1)
        await env.model.signOut()
    }
    @MainActor func testFailedIdentificationDoesNotLoopAndBothPhotosCanBeSavedManually() async throws {
        let env = try await environment(failIdentification: true)
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        for data in [photo(), photo(.brown)] {
            await draft.stagePhoto(data, source: "camera", replacing: nil)
            let accepted = await draft.acceptPhoto(); XCTAssertTrue(accepted)
        }
        await draft.continueAfterCapture()
        XCTAssertEqual(draft.step, .identificationFailed)
        let restored = AddCoinModel(model: env.model); await restored.restore()
        await restored.continueAfterCapture()
        XCTAssertEqual(JourneyProtocol.identificationCount, 1, "Failure must require an explicit retry")
        await restored.identify()
        XCTAssertEqual(JourneyProtocol.identificationCount, 2)
        restored.label = "Моя монета"; restored.metal = "silver"; restored.mass = "31.1"
        let saved = await restored.saveWithoutMatch(); XCTAssertTrue(saved)
        let pending = try XCTUnwrap(env.model.pendingCoins.first)
        XCTAssertEqual(pending.photoKeys.count, 2); XCTAssertNil(pending.input.typeId)
        XCTAssertEqual(pending.coin.properties?.values["metal"], "silver")
        let persisted = try await env.disk.loadPending(account: "journey")
        XCTAssertEqual(persisted.first?.photoKeys, pending.photoKeys)
        await env.model.signOut()
    }
    @MainActor func testUnacceptedRetakeDoesNotReplaceOriginalOrStartIdentification() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        let original = photo(), replacement = photo(.brown)
        await draft.stagePhoto(original, source: "camera", replacing: nil)
        let accepted = await draft.acceptPhoto(); XCTAssertTrue(accepted)
        let first = draft.images[0]
        let stored = try await storedPhotos(env)
        XCTAssertEqual(stored.originals, [original])
        await draft.stagePhoto(replacement, source: "camera", replacing: 0)
        await draft.continueAfterCapture()
        XCTAssertEqual(draft.images, [first]); XCTAssertEqual(JourneyProtocol.identificationCount, 0)
        let restored = AddCoinModel(model: env.model); await restored.restore()
        XCTAssertEqual(restored.images, stored.previews)
        XCTAssertEqual(restored.pendingPhoto, replacement)
        let beforeAcceptance = try await storedPhotos(env)
        XCTAssertEqual(beforeAcceptance.keys, stored.keys)
        XCTAssertEqual(beforeAcceptance.originals, [original], "An unaccepted retake must not replace the accepted original")
        let retaken = await restored.acceptPhoto(); XCTAssertTrue(retaken)
        XCTAssertEqual(restored.images.count, 1); XCTAssertNotEqual(restored.images[0], first)
        let afterAcceptance = try await storedPhotos(env)
        XCTAssertEqual(afterAcceptance.originals, [replacement])
        XCTAssertNotEqual(afterAcceptance.keys, stored.keys)
        await env.model.signOut()
    }
    @MainActor func testCorruptSecondPhotoLeavesFirstSideAndDraftIntact() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        await draft.stagePhoto(photo(), source: "camera", replacing: nil)
        let accepted = await draft.acceptPhoto(); XCTAssertTrue(accepted)
        let first = draft.images
        await draft.stagePhoto(Data("corrupt".utf8), source: "camera", replacing: nil)
        let second = await draft.acceptPhoto(); XCTAssertFalse(second)
        await draft.continueAfterCapture()
        XCTAssertEqual(draft.images, first); XCTAssertEqual(draft.step, .secondSide)
        XCTAssertEqual(JourneyProtocol.identificationCount, 0)
        await env.model.signOut()
    }
    @MainActor func testDeletePendingOfflineCoinPersistsRemoval() async throws {
        let env = try await environment()
        defer { try? env.vault.clear(); try? FileManager.default.removeItem(at: env.root) }
        let draft = AddCoinModel(model: env.model); await draft.restore()
        draft.label = "Unrecognized"
        let saved = await draft.saveWithoutMatch(); XCTAssertTrue(saved)
        let id = try XCTUnwrap(env.model.pendingCoins.first?.id)
        try await env.model.deleteCoin(id)
        XCTAssertFalse(env.model.coins.contains(where: { $0.id == id }))
        let pending = try await env.disk.loadPending(account: "journey")
        XCTAssertTrue(pending.isEmpty)
        await env.model.signOut()
    }
    @MainActor private func photo(_ color: UIColor = .gray) -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: 40, height: 40)).image { context in
            color.setFill(); context.fill(CGRect(x: 0, y: 0, width: 40, height: 40))
        }.jpegData(compressionQuality: 1)!
    }
    private struct StoredPhotos {
        var keys: [String]; var previews: [Data]; var originals: [Data]
    }
    @MainActor private func storedPhotos(_ env: Environment) async throws -> StoredPhotos {
        let saved = try await env.disk.loadAddDraft(account: "journey")
        let draft = try XCTUnwrap(saved)
        var result = StoredPhotos(keys: draft.photoKeys, previews: [], originals: [])
        for key in draft.photoKeys {
            let previewData = await env.disk.image(account: "journey", key: key)
            let originalData = await env.disk.image(account: "journey", key: "original:" + key)
            let preview = try XCTUnwrap(previewData)
            let original = try XCTUnwrap(originalData)
            XCTAssertNotNil(UIImage(data: preview)); XCTAssertNotNil(UIImage(data: original))
            result.previews.append(preview); result.originals.append(original)
        }
        return result
    }
    private struct Environment {
        let model: NumiModel; let disk: LibraryDisk; let vault: SessionVault; let root: URL
    }
    @MainActor private func environment(failDelete: Bool = false, failIdentification: Bool = false, partialUpload: Bool = false,
                                        pendingIdentification: Bool = false, materialFixture: Coin? = nil) async throws -> Environment {
        JourneyProtocol.reset(failDelete: failDelete, failIdentification: failIdentification, pendingIdentification: pendingIdentification,
                              materialFixture: materialFixture)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault = SessionVault(service: "journey-" + UUID().uuidString)
        try vault.write(SavedSession(user: NumiUser(id: "journey", email: "test@example.invalid"), cookies: []))
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [JourneyProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: config), vault: vault)
        let disk = LibraryDisk(root: root)
        var library = LibrarySnapshot(); library.cursor = "initial"
        library.items["coin"] = Coin(id: "coin", version: 1, userLabel: "Existing", status: "active")
        if var cached = materialFixture {
            library.items = [:]
            cached.materialNormalization = nil; cached.notes = "Моя заметка"
            library.items[cached.id] = cached
            for index in 0..<2 {
                let id = "photo-\(index)"
                let data = try JSONSerialization.data(withJSONObject: ["id": id, "itemId": cached.id,
                    "side": "other", "byteSize": 100, "status": "ready", "sortOrder": index])
                library.photos[id] = try JSONDecoder().decode(CoinPhoto.self, from: data)
            }
        }
        try await disk.save(library, account: "journey")
        if partialUpload {
            var local = Coin(id: "local", version: 0, typeId: 1, typeName: "Воронеж", userLabel: "Воронеж", status: "active")
            local.userLabelSource = CoinName.automatic
            var remote = Coin(id: "remote", version: 1, typeId: 1, typeName: "Воронеж", userLabel: "Воронеж", status: "active")
            remote.userLabelSource = CoinName.automatic
            let input = CreateCoinInput(typeId: 1, userLabel: "Воронеж", userLabelSource: CoinName.automatic)
            try await disk.savePending([PendingCoin(id: "local", input: input, coin: local,
                sessionID: nil, photoKeys: ["pending-photo"], remoteCoin: remote)], account: "journey")
        }
        let model = NumiModel(api: api, disk: disk, telemetryEnabled: false); await model.bootstrap()
        return Environment(model: model, disk: disk, vault: vault, root: root)
    }
}

private final class JourneyProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var syncExpectation: XCTestExpectation?
    private static var waiting: JourneyProtocol?
    private static var failDelete = false
    private static var failIdentification = false
    private static var pendingIdentification = false
    private static var identifications = 0
    private static var resultChecks = 0
    private static var materialFixture: Coin?
    private static var materialLists = 0
    static var materialListCount: Int { lock.lock(); defer { lock.unlock() }; return materialLists }
    static var identificationCount: Int { lock.lock(); defer { lock.unlock() }; return identifications }
    static var resultCount: Int { lock.lock(); defer { lock.unlock() }; return resultChecks }
    static func reset(failDelete: Bool, failIdentification: Bool = false, pendingIdentification: Bool = false, materialFixture: Coin? = nil) {
        lock.lock(); defer { lock.unlock() }; syncExpectation = nil; waiting = nil; self.failDelete = failDelete
        self.failIdentification = failIdentification; identifications = 0
        self.pendingIdentification = pendingIdentification; resultChecks = 0
        self.materialFixture = materialFixture; materialLists = 0
    }
    static func holdNextSync(started: XCTestExpectation) { lock.lock(); defer { lock.unlock() }; syncExpectation = started }
    static func releaseSync() {
        lock.lock(); let pending = waiting; waiting = nil; lock.unlock()
        pending?.respond(200, #"{"changes":[{"seq":"1","entityKind":"item","entityId":"coin","itemId":"coin","operation":"upsert","item":{"id":"coin","version":1,"userLabel":"Stale","status":"active"}}],"nextCursor":"late","hasMore":false}"#)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        Self.lock.lock(); let material = Self.materialFixture; Self.lock.unlock()
        if path.hasSuffix("/sync") {
            Self.lock.lock()
            let started = Self.syncExpectation; Self.syncExpectation = nil
            if started != nil { Self.waiting = self }
            Self.lock.unlock()
            if let started { started.fulfill(); return }
            if let hash = material?.materialNormalization?.directorySha256 {
                respond(200, #"{"changes":[],"nextCursor":"unchanged","hasMore":false,"directorySha256":"\#(hash)","materialNormalizationStatus":"available"}"#)
            } else {
                respond(200, #"{"changes":[],"nextCursor":"unchanged","hasMore":false}"#)
            }
        } else if path == "/api/v1/catalog/search", request.httpMethod == "GET" {
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let expected = ["country": "@country:RU", "year": "1999", "denomination": "1 копейки", "q": "СПМД", "offset": "50"]
            guard query.count == expected.count, query.allSatisfy({ expected[$0.name] == $0.value }) else {
                respond(400, "{}"); return
            }
            respond(200, #"{"total":80,"items":[{"id":42,"name_full":"1 копейка"},{"id":7,"name_full":"1 копейка"}]}"#)
        } else if path.hasSuffix("/items"), request.httpMethod == "GET", let material,
                  let hash = material.materialNormalization?.directorySha256 {
            Self.lock.lock(); Self.materialLists += 1; Self.lock.unlock()
            let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
            guard query?.contains(URLQueryItem(name: "materialDirectorySha256", value: hash)) == true else {
                respond(400, "{}"); return
            }
            let items = String(decoding: try! JSONEncoder().encode([material]), as: UTF8.self)
            respond(200, #"{"items":\#(items),"directorySha256":"\#(hash)","materialNormalizationStatus":"available"}"#)
        } else if path.hasSuffix("/identify") {
            Self.lock.lock()
            Self.identifications += 1
            let fail = Self.failIdentification, pending = Self.pendingIdentification
            Self.lock.unlock()
            if pending {
                respond(200, #"{"identificationSessionId":"session","decisionState":"pending","catalogMatch":"not_found","extracted":{},"candidates":[]}"#)
                return
            }
            respond(fail ? 503 : 200, fail ? #"{"error":{"code":"unavailable"}}"# :
                #"{"identificationSessionId":"session","recognizedName":"Coin","catalogMatch":"ambiguous","extracted":{"country":"Россия","year":2004},"candidates":[{"id":42,"name":"Coin"}]}"#)
        } else if request.httpMethod == "GET", path.hasSuffix("/identifications/session/result") {
            Self.lock.lock(); Self.resultChecks += 1; let executing = Self.resultChecks == 1; Self.lock.unlock()
            respond(200, executing ?
                #"{"identificationSessionId":"session","decisionState":"executing","catalogMatch":"not_found","extracted":{},"candidates":[]}"# :
                #"{"identificationSessionId":"session","decisionState":"completed","decisionId":"shared-pending","decisionRevision":1,"referenceTypeId":42,"exactIdentityAccepted":true,"catalogMatch":"exact","extracted":{},"candidates":[{"id":42,"name":"Coin"}]}"#)
        } else if request.httpMethod == "PATCH", path.hasSuffix("/items/remote") {
            let fields = OnboardingFixtureProtocol.fields(request)
            let item: [String: Any] = ["id": "remote", "version": 2, "status": "active",
                "typeId": fields["typeId"] ?? 1, "typeName": fields["typeId"] != nil ? "Боровск" : "Воронеж",
                "userLabel": fields["userLabel"] ?? NSNull(), "userLabelSource": fields["userLabelSource"] ?? NSNull(),
                "properties": fields["properties"] ?? [:]]
            let data = try! JSONSerialization.data(withJSONObject: ["item": item])
            respond(200, String(decoding: data, as: UTF8.self))
        } else if request.httpMethod == "DELETE" {
            Self.lock.lock(); let fail = Self.failDelete; Self.lock.unlock()
            respond(fail ? 503 : 204, "")
        } else if path.contains("/auth/") {
            respond(200, #"{"user":{"id":"journey","email":"test@example.invalid"}}"#)
        } else {
            // Keep new specimens local to test the durable offline confirmation path.
            respond(503, #"{"error":{"code":"unavailable"}}"#)
        }
    }
    private func respond(_ status: Int, _ body: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
