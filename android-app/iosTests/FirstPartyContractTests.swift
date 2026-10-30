import XCTest
import UIKit
@testable import Numi

final class FirstPartyContractTests: XCTestCase {
    private func result(_ name: String) throws -> IdentificationResult {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json", subdirectory: "Fixtures/first-party"))
        return try JSONDecoder().decode(IdentificationResult.self, from: Data(contentsOf: url))
    }

    func testActualWireKeepsCatalogReferenceSeparateAndNeverAcceptsExactType() throws {
        let response = try result("accepted")
        let candidate = try XCTUnwrap(response.candidates.first)
        XCTAssertTrue(response.hasDesignContract)
        XCTAssertTrue(candidate.isReference)
        XCTAssertFalse(response.canAssignType(candidate))
        XCTAssertEqual(candidate.catalogReference?.year, 2000)
        XCTAssertEqual(candidate.catalogReference?.metal, "Никель")
        XCTAssertNil(response.extracted.year)
        XCTAssertNil(response.extracted.metal)
        XCTAssertNil(response.extracted.gradeCode)
        let restored = try JSONDecoder().decode(IdentificationResult.self, from: JSONEncoder().encode(response))
        XCTAssertEqual(restored.referenceTypeId, 372677)
        XCTAssertEqual(restored.recognitionEvidence?.strategy, "first_party_pair_v4")
    }

    @MainActor func testChoosingAReferenceDoesNotPrefillAnyCoinProperty() throws {
        let draft = AddCoinModel(model: NumiModel(telemetryEnabled: false))
        var response = try result("accepted"); response.catalogMatch = "exact"
        draft.recognition = response
        var candidate = try XCTUnwrap(response.candidates.first)
        candidate.year = 2000; candidate.country = "Portugal"
        draft.choose(candidate)
        XCTAssertNil(draft.selected); XCTAssertNil(draft.candidate)
        XCTAssertEqual(draft.referenceDecision, "accepted")
        XCTAssertTrue(draft.year.isEmpty); XCTAssertTrue(draft.country.isEmpty)
        XCTAssertTrue(draft.metal.isEmpty); XCTAssertTrue(draft.grade.isEmpty)
        XCTAssertTrue(draft.finish.isEmpty); XCTAssertTrue(draft.label.isEmpty)
        // A restored or stale selection is checked again at the persistence boundary.
        draft.candidate = candidate
        let pending = try draft.makePending()
        XCTAssertNil(pending.input.typeId); XCTAssertNil(pending.input.issueId)
        XCTAssertNil(pending.input.identifiedYear); XCTAssertNil(pending.input.gradeCode)
        XCTAssertNil(pending.coin.catalog); XCTAssertNil(pending.coin.typeName)
        XCTAssertNil(pending.input.identificationEvidence)
    }

    func testActualAbstentionAndUnavailableKeepThePhotoSessionAndNeutralStatus() throws {
        for name in ["abstained", "unavailable"] {
            let response = try result(name)
            XCTAssertTrue(response.hasDesignContract)
            XCTAssertEqual(response.catalogSearchStatus, "insufficient_evidence")
            XCTAssertNotNil(response.identificationSessionId)
            XCTAssertTrue(response.candidates.isEmpty)
            XCTAssertNil(response.extracted.year)
        }
        XCTAssertEqual(try result("unavailable").recognitionError?.code, "recognition_failed")
    }

    @MainActor func testAcceptRejectAbstainAndUnavailablePreserveTwoPhotosAndManualDataAcrossReopening() async throws {
        for name in ["accepted", "rejected", "abstained", "unavailable"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            let vault = SessionVault(service: "first-party-" + UUID().uuidString)
            defer { try? vault.clear(); try? FileManager.default.removeItem(at: root) }
            try vault.write(SavedSession(user: NumiUser(id: "contract-owner", email: "test@example.invalid"), cookies: []))
            let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [OfflineProtocol.self]
            let disk = LibraryDisk(root: root)
            var library = LibrarySnapshot(); library.cursor = "existing"
            try await disk.save(library, account: "contract-owner")
            let model = NumiModel(api: NumiAPI(session: URLSession(configuration: config), vault: vault), disk: disk, telemetryEnabled: false)
            await model.bootstrap(); model.setCaptureActive(true)
            let draft = AddCoinModel(model: model); await draft.restore()
            let image = try XCTUnwrap(UIImage(named: "MarketStoryCoin")?.jpegData(compressionQuality: 1))
            await draft.addImages([image, image])
            let response = try result(name == "rejected" ? "accepted" : name)
            draft.recognition = response
            if let candidate = response.candidates.first { draft.choose(candidate) }
            if name == "rejected" { draft.referenceDecision = "rejected" }
            draft.editName("Моя монета"); draft.year = "1999"; draft.country = "Бурунди"
            draft.metal = "Серебро"; draft.mass = "31.1"; draft.grade = "PF"; draft.notes = "Ручная правка"
            let kept = await draft.keepDraft(); XCTAssertTrue(kept)
            let restoredDraft = AddCoinModel(model: model); await restoredDraft.restore()
            XCTAssertEqual(restoredDraft.images.count, 2)
            XCTAssertEqual(restoredDraft.recognition?.requestId, response.requestId)
            let saved = await restoredDraft.save(); XCTAssertTrue(saved)
            let reopened = try await LibraryDisk(root: root).loadPending(account: "contract-owner")
            let pending = try XCTUnwrap(reopened.first)
            XCTAssertNil(pending.input.typeId); XCTAssertNil(pending.input.issueId)
            XCTAssertEqual(pending.input.identifiedYear, 1999)
            XCTAssertEqual(pending.input.gradeCode, "PF")
            XCTAssertEqual(pending.input.properties?.value("metal"), "Серебро")
            XCTAssertEqual(pending.input.properties?.value("mass"), "31.1")
            XCTAssertEqual(pending.input.userLabel, "Моя монета")
            XCTAssertEqual(pending.input.notes, "Ручная правка")
            XCTAssertEqual(pending.sessionID, response.identificationSessionId)
            XCTAssertEqual(pending.photoKeys.count, 2)
            XCTAssertEqual(pending.recognitionHint?.decision, name == "rejected" ? "rejected" : response.candidates.isEmpty ? "skipped" : "accepted")
            for key in pending.photoKeys {
                let original = await disk.previewImage(account: "contract-owner", key: key)
                XCTAssertNotNil(original)
            }
            let hint = try XCTUnwrap(pending.recognitionHint)
            try await disk.saveRecognitionHint(hint, account: "contract-owner", coinID: "remote-coin")
            let remoteHint = try await LibraryDisk(root: root).loadRecognitionHint(account: "contract-owner", coinID: "remote-coin")
            XCTAssertEqual(remoteHint?.result.referenceTypeId, response.referenceTypeId)
            let anotherAccount = try await disk.loadRecognitionHint(account: "other-owner", coinID: "remote-coin")
            XCTAssertNil(anotherAccount)
        }
    }

    func testNonCoinObservationsCannotAssignAStaleExactCandidate() throws {
        let candidate = IdentificationCandidate(id: 42, name: "Coin")
        for kind in ["medal", "token", "souvenir"] {
            var fields = IdentifiedFields(); fields.objectKind = kind
            let response = IdentificationResult(catalogMatch: "exact", extracted: fields, candidates: [candidate])
            XCTAssertFalse(response.canAssignType(candidate))
        }
    }
    func testCandidatePhysicalPropertiesDecodeForComparison() throws {
        let candidate = try JSONDecoder().decode(IdentificationCandidate.self,
            from: Data(#"{"id":849,"name":"Threepence","kmNumber":"849","metal":"brass","composition":"nickel brass","mass":6.8,"diameter":21.2}"#.utf8))
        XCTAssertEqual(candidate.kmNumber,"849"); XCTAssertEqual(candidate.composition,"nickel brass")
        XCTAssertEqual(candidate.mass,6.8); XCTAssertEqual(candidate.diameter,21.2)
        XCTAssertTrue(candidate.physicalDetails.contains("KM 849"))
    }

    func testLegacyTypeConfirmationRemainsCompatible() {
        let candidate = IdentificationCandidate(id: 42, name: "Legacy", year: 2004)
        let response = IdentificationResult(catalogMatch: "exact", extracted: IdentifiedFields(), candidates: [candidate])
        XCTAssertFalse(response.hasDesignContract)
        XCTAssertTrue(response.canAssignType(candidate))
    }

    func testOnlyIdentificationRequestsDeclareGeneralDesignSupport() async throws {
        ContractHeaderProtocol.reset()
        let vault = SessionVault(service: "contract-header-" + UUID().uuidString)
        defer { ContractHeaderProtocol.reset(); try? vault.clear() }
        try vault.write(SavedSession(user: NumiUser(id: "header-owner", email: "fixture@example.invalid"), cookies: []))
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContractHeaderProtocol.self]
        let api = NumiAPI(session: URLSession(configuration: configuration), vault: vault)
        _ = try await api.restore()
        let image = try XCTUnwrap(UIImage(named: "MarketStoryCoin")?.jpegData(compressionQuality: 1))
        for _ in 0..<2 {
            let response = try await api.identify([image, image])
            XCTAssertTrue(response.hasDesignContract)
        }
        _ = try await api.catalogCountries()
        let requests = ContractHeaderProtocol.requests
        XCTAssertEqual(requests.count, 3)
        for request in requests.prefix(2) {
            XCTAssertEqual(request.url?.path, "/api/v1/collection/identify")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Numi-Identification-Contract"), "general-design-v1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Numi-Platform"), "ios")
            XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Numi-App-Version"))
            XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") == true)
        }
        XCTAssertEqual(requests.last?.url?.path, "/api/v1/catalog/countries")
        XCTAssertNil(requests.last?.value(forHTTPHeaderField: "X-Numi-Identification-Contract"))
    }
}

private final class ContractHeaderProtocol: URLProtocol {
    private static let lock = NSLock()
    private static var recorded: [URLRequest] = []
    static var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return recorded }
    static func reset() { lock.lock(); recorded = []; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.recorded.append(request); Self.lock.unlock()
        let body = request.url?.path == "/api/v1/collection/identify"
            ? #"{"identificationSessionId":"contract-session","catalogMatch":"not_found","extracted":{},"candidates":[],"designMatch":"abstain","catalogSearchStatus":"insufficient_evidence","exactIdentityAccepted":false}"#
            : #"{"countries":[]}"#
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil,
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
