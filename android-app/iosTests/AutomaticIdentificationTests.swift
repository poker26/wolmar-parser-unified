import XCTest
import UIKit
@testable import Numi

final class AutomaticIdentificationTests: XCTestCase {
    @MainActor private func environment() async throws -> (NumiModel, SessionVault, URL) {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault=SessionVault(service:"auto-exact-"+UUID().uuidString)
        try vault.write(SavedSession(user:NumiUser(id:"auto-owner",email:"fixture@example.invalid"),cookies:[]))
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[AutoExactProtocol.self]
        let model=NumiModel(api:NumiAPI(session:URLSession(configuration:config),vault:vault),disk:LibraryDisk(root:root),telemetryEnabled:false)
        model.setCaptureActive(true);await model.bootstrap()
        return(model,vault,root)
    }
    @MainActor private func makeDraft(_ model:NumiModel) async throws -> AddCoinModel {
        let draft=AddCoinModel(model:model);await draft.restore()
        let image=try XCTUnwrap(UIImage(named:"MarketStoryCoin")?.jpegData(compressionQuality:1))
        await draft.addImages([image,image]);return draft
    }
    func testPublicServerResponsesKeepForeignExactAndAmbiguousTypesSeparate() throws {
        let cases: [(String, Int64?, Int)] = [("Australia",360133,1989),("Finland",350183,1996),
            ("UK-2p",nil,1996),("South-Africa",nil,2009)]
        for (name, expectedID, year) in cases {
            let url=try XCTUnwrap(Bundle(for: Self.self).url(forResource:name,withExtension:"json",subdirectory:"Fixtures/foreign-auto"))
            let response=try JSONDecoder().decode(IdentificationResult.self,from:Data(contentsOf:url))
            XCTAssertEqual(response.automaticExactCandidate?.id,expectedID,name)
            XCTAssertEqual(response.extracted.year,year)
            XCTAssertNil(response.automaticExactCandidate?.issueId)
            XCTAssertEqual(response.catalogDecision?.version,"foreign-type-v1")
            let restored=try JSONDecoder().decode(IdentificationResult.self,from:JSONEncoder().encode(response))
            XCTAssertEqual(restored.catalogDecision?.reason,response.catalogDecision?.reason)
        }
    }
    @MainActor func testExactResultSavesBothPhotosAndTypeWithoutConfirmationAndSurvivesReopening() async throws {
        AutoExactProtocol.reset(gated:false)
        let(model,vault,root)=try await environment()
        defer {try? vault.clear();try? FileManager.default.removeItem(at:root)}
        let draft=try await makeDraft(model)
        await draft.identify()
        XCTAssertTrue(draft.automaticallySaved)
        XCTAssertEqual(model.pendingCoins.count,1)
        let stored=try await LibraryDisk(root:root).loadPending(account:"auto-owner")
        let coin=try XCTUnwrap(stored.first)
        XCTAssertEqual(coin.input.typeId,370287);XCTAssertNil(coin.input.issueId)
        XCTAssertEqual(coin.input.identifiedYear,1972);XCTAssertEqual(coin.photoKeys.count,2)
        XCTAssertNil(coin.input.identificationEvidence)
        XCTAssertEqual(coin.coin.catalog?.year,1967)
        XCTAssertEqual(coin.input.properties?.value("year"),"1972")
        await draft.identify();XCTAssertEqual(model.pendingCoins.count,1)
    }
    @MainActor func testLateExactResultKeepsChangedYearAndDoesNotSaveAWrongType() async throws {
        AutoExactProtocol.reset(gated:true)
        let(model,vault,root)=try await environment()
        defer {try? vault.clear();try? FileManager.default.removeItem(at:root)}
        let draft=try await makeDraft(model)
        let request=Task {await draft.identify()}
        for _ in 0..<200 {if AutoExactProtocol.waiting {break};try await Task.sleep(nanoseconds:10_000_000)}
        XCTAssertTrue(AutoExactProtocol.waiting)
        draft.year="1973";draft.notes="Human note"
        AutoExactProtocol.respond();await request.value
        XCTAssertFalse(draft.automaticallySaved);XCTAssertTrue(model.pendingCoins.isEmpty)
        XCTAssertEqual(draft.year,"1973");XCTAssertEqual(draft.notes,"Human note")
        XCTAssertNil(try draft.makePending().input.typeId)
    }
    @MainActor func testLateExactResultKeepsAManuallySelectedType() async throws {
        AutoExactProtocol.reset(gated:true)
        let(model,vault,root)=try await environment()
        defer {try? vault.clear();try? FileManager.default.removeItem(at:root)}
        let draft=try await makeDraft(model)
        let request=Task {await draft.identify()}
        for _ in 0..<200 {if AutoExactProtocol.waiting {break};try await Task.sleep(nanoseconds:10_000_000)}
        XCTAssertTrue(AutoExactProtocol.waiting)
        draft.choose(CatalogChoice(id:999,name:"My selected type",year:1973))
        AutoExactProtocol.respond();await request.value
        XCTAssertFalse(draft.automaticallySaved)
        XCTAssertEqual(try draft.makePending().input.typeId,999)
        XCTAssertEqual(draft.year,"1973")
    }
}

private final class AutoExactProtocol: URLProtocol {
    private static let lock=NSLock()
    private static var gated=false
    private static var pending:(()->Void)?
    static var waiting:Bool {lock.lock();defer {lock.unlock()};return pending != nil}
    static func reset(gated:Bool) {lock.lock();Self.gated=gated;pending=nil;lock.unlock()}
    static func respond() {lock.lock();let callback=pending;pending=nil;lock.unlock();callback?()}
    override class func canInit(with request:URLRequest)->Bool {true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
    override func startLoading() {
        let callback = { [self] in
            let body = #"{"identificationSessionId":"exact-session","requestId":"exact-request","recognizedName":"1 gulden","catalogMatch":"exact","extracted":{"year":1972,"objectKind":"coin"},"candidates":[{"id":370287,"name":"1 gulden","year":1967,"issueId":null,"issueYear":1972,"issueMatch":"ambiguous"}]}"#
            client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
            client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
        }
        Self.lock.lock()
        if Self.gated {Self.pending=callback;Self.lock.unlock()} else {Self.lock.unlock();callback()}
    }
    override func stopLoading() {}
}
