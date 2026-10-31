import XCTest
import UIKit
import CryptoKit
@testable import Numi

final class TransferPhotoStorageTests: XCTestCase {
    @MainActor private func verifyCapture(gallery: Bool, restart: Bool) async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault=SessionVault(service:"transfer-bytes-"+UUID().uuidString)
        defer { try? vault.clear();try? FileManager.default.removeItem(at:root) }
        try vault.write(SavedSession(user:NumiUser(id:"owner",email:"qa@example.invalid"),cookies:[]))
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[TransferBytesProtocol.self]
        let disk=LibraryDisk(root:root)
        let model=NumiModel(api:NumiAPI(session:URLSession(configuration:config),vault:vault),disk:disk,telemetryEnabled:false)
        model.setCaptureActive(true);await model.bootstrap()
        var draft=AddCoinModel(model:model);await draft.restore()
        let original=try XCTUnwrap(UIImage(named:"MarketStoryCoin")?.jpegData(compressionQuality:1))
        if gallery { await draft.addImages([original,original]) }
        else {
            for _ in 0..<2 {
                await draft.stagePhoto(original,source:"camera",replacing:nil)
                let accepted=await draft.acceptPhoto();XCTAssertTrue(accepted)
            }
            let first=draft.images[0]
            await draft.stagePhoto(original,source:"camera",replacing:1)
            let accepted=await draft.acceptPhoto();XCTAssertTrue(accepted)
            XCTAssertEqual(draft.images.count,2);XCTAssertEqual(draft.images[0],first)
        }
        let before=draft.images
        if restart { draft=AddCoinModel(model:model);await draft.restore();XCTAssertEqual(draft.images,before) }
        TransferBytesProtocol.reset()
        await draft.identify()
        XCTAssertNil(draft.error)
        let pending=try draft.makePending()
        let sent=TransferBytesProtocol.uploaded
        guard sent.count == 2 else { XCTFail("Expected two actual multipart photos");return }
        for (index,key) in pending.photoKeys.enumerated() {
            let cached=await disk.image(account:"owner",key:key)
            let raw=await disk.image(account:"owner",key:"original:"+key)
            XCTAssertEqual(cached,before[index]);XCTAssertEqual(cached,sent[index])
            XCTAssertEqual(raw,original)
            let bytes=try XCTUnwrap(cached)
            let hash=SHA256.hash(data:bytes).map { String(format:"%02x",$0) }.joined()
            let photo=CoinPhoto(id:"photo-"+String(index),itemId:"remote",side:index==0 ? "obverse":"reverse",
                byteSize:Int64(bytes.count),status:"ready",sortOrder:index,sha256:hash)
            XCTAssertNotNil(recoveredUpload([photo],itemID:"remote",data:bytes,index:index))
        }
        let saved=await draft.save();XCTAssertTrue(saved)
        let reopened=try await LibraryDisk(root:root).loadPending(account:"owner")
        XCTAssertEqual(reopened.count,1);XCTAssertEqual(reopened.first?.photoKeys,pending.photoKeys)
    }
    @MainActor func testNativeCaptureAndRetakeKeepExactlyTheUploadedBytesAndRawOriginals() async throws {
        try await verifyCapture(gallery:false,restart:false)
    }
    @MainActor func testGalleryCaptureKeepsExactlyTheUploadedBytesAndRawOriginals() async throws {
        try await verifyCapture(gallery:true,restart:false)
    }
    @MainActor func testDraftRestartUsesTheSameTransferBytes() async throws {
        try await verifyCapture(gallery:false,restart:true)
    }
    func testLegacyRecoveryRejectsDifferentHashAndPreservesBothLocalFiles() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at:root) }
        let disk=LibraryDisk(root:root)
        let raw=try XCTUnwrap(UIImage(named:"MarketStoryCoin")?.jpegData(compressionQuality:1))
        try await disk.storeOriginal(raw,account:"owner",key:"original:side")
        try await disk.storeImage(raw,account:"owner",key:"side")
        let before=await disk.image(account:"owner",key:"side")
        let wrong=CoinPhoto(id:"wrong",itemId:"remote",side:"obverse",byteSize:1,status:"ready",sortOrder:0,sha256:String(repeating:"0",count:64))
        let result=try await disk.recoverStagedPhoto([wrong],account:"owner",key:"side",itemID:"remote",index:0)
        XCTAssertNil(result)
        let after=await disk.image(account:"owner",key:"side")
        let original=await disk.image(account:"owner",key:"original:side")
        XCTAssertEqual(after,before);XCTAssertEqual(original,raw)
    }
}
private final class TransferBytesProtocol: URLProtocol {
    private static let lock=NSLock()
    private static var bytes=[Data]()
    static func reset() { lock.lock();bytes=[];lock.unlock() }
    static var uploaded:[Data] {lock.lock();defer {lock.unlock()};return bytes}
    override class func canInit(with request:URLRequest)->Bool {true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest {request}
    override func startLoading() {
        XCTAssertTrue(request.url!.path.hasSuffix("/identify"),"Unexpected request")
        let images=OnboardingFixtureProtocol.multipartImages(Self.body(request),
            contentType:request.value(forHTTPHeaderField:"Content-Type") ?? "")
        Self.lock.lock();Self.bytes=images;Self.lock.unlock()
        let body = #"{"identificationSessionId":"byte-session","requestId":"byte-request","catalogMatch":"ambiguous","extracted":{"year":1972},"candidates":[]}"#
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
    }
    private static func body(_ request: URLRequest) -> Data {
        if let data=request.httpBody { return data }
        guard let stream=request.httpBodyStream else { return Data() }
        stream.open();defer {stream.close()}
        var result=Data(), buffer=[UInt8](repeating:0,count:4096)
        while stream.hasBytesAvailable {
            let count=stream.read(&buffer,maxLength:buffer.count)
            if count<=0 {break};result.append(contentsOf:buffer.prefix(count))
        }
        return result
    }
    override func stopLoading() {}
}
