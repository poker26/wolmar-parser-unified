import XCTest
import CryptoKit
import UIKit
@testable import Numi

final class PhotoUploadRecoveryTests: XCTestCase {
    let bytes = Data("original-photo".utf8)
    func photo() -> CoinPhoto {
        let sha = SHA256.hash(data: bytes).map { String(format:"%02x",$0) }.joined()
        return CoinPhoto(id:"photo",itemId:"item",side:"obverse",byteSize:Int64(bytes.count),status:"ready",sortOrder:0,sha256:sha)
    }
    func testAtomicResponseDecodesSavedPhotosAndKeepsLegacyResponsesCompatible() throws {
        let response=try JSONDecoder().decode(SavedCoinResponse.self,from:Data(#"{"item":{"id":"item","version":1,"status":"active","photos":[{"id":"photo","itemId":"item","side":"obverse","byteSize":14,"status":"ready","sortOrder":0}]}}"#.utf8))
        XCTAssertEqual(response.item.id,"item");XCTAssertEqual(response.photos?.first?.id,"photo")
        let old=try JSONDecoder().decode(SavedCoinResponse.self,from:Data(#"{"item":{"id":"item","version":1,"status":"active"}}"#.utf8))
        XCTAssertNil(old.photos)
    }
    func testReadyOriginalMatchesOnlyExactOwnedSlotAndBytes() {
        let original=photo()
        XCTAssertEqual(recoveredUpload([original],itemID:"item",data:bytes,index:0)?.id,"photo")
        XCTAssertNil(recoveredUpload([original],itemID:"other",data:bytes,index:0))
        XCTAssertNil(recoveredUpload([original],itemID:"item",data:Data("different-data".utf8),index:0))
        XCTAssertNil(recoveredUpload([original],itemID:"item",data:bytes,index:1))
        var pending=original;pending.status="pending"
        XCTAssertNil(recoveredUpload([pending],itemID:"item",data:bytes,index:0))
        var noHash=original;noHash.sha256=nil
        XCTAssertNil(recoveredUpload([noHash],itemID:"item",data:bytes,index:0))
        XCTAssertNil(recoveredUpload([original,original],itemID:"item",data:bytes,index:0))
    }
    func testLostCompletionResponseCanBeRecoveredThroughPhotoList() async throws {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[LostPhotoResponseProtocol.self]
        let vault=SessionVault(service:"photo-recovery-"+UUID().uuidString)
        defer { try? vault.clear() }
        let api=NumiAPI(session:URLSession(configuration:config),vault:vault)
        let recovered=try await api.uploadPhoto(itemID:"item",data:bytes,index:0)
        XCTAssertEqual(recovered.id,"photo");XCTAssertEqual(recovered.status,"ready")
    }
    func testDifferentPhotoDoesNotTurnAnUploadFailureIntoSuccess() async throws {
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[LostPhotoResponseProtocol.self]
        let api=NumiAPI(session:URLSession(configuration:config),vault:SessionVault(service:"photo-mismatch-"+UUID().uuidString))
        do { _ = try await api.uploadPhoto(itemID:"item",data:Data("different-data".utf8),index:0);XCTFail("Different bytes were accepted") }
        catch { XCTAssertNotNil(error as? NumiError) }
    }
    @MainActor func testRestartFinishesPendingCoinWithBothAlreadyUploadedOriginals() async throws {
        try await restartPending(usingAtomicMetadata: false)
    }
    @MainActor func testAtomicPhotoMetadataSurvivesRestartWithoutAnotherPhotoRequest() async throws {
        try await restartPending(usingAtomicMetadata: true)
    }
    @MainActor func testRestartRepairsLegacyRecompressedCacheUsingVerifiedPreparedOriginal() async throws {
        try await restartPending(usingAtomicMetadata:true,legacyCache:true)
    }
    @MainActor private func restartPending(usingAtomicMetadata: Bool, legacyCache: Bool = false) async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let vault=SessionVault(service:"photo-restart-"+UUID().uuidString)
        defer { try? vault.clear();try? FileManager.default.removeItem(at:root) }
        try vault.write(SavedSession(user:NumiUser(id:"account",email:"qa@example.invalid"),cookies:[]))
        let image=UIGraphicsImageRenderer(size:CGSize(width:8,height:8)).image { context in
            UIColor.orange.setFill();context.fill(CGRect(x:0,y:0,width:8,height:8))
        }.jpegData(compressionQuality:0.9)!
        let disk=LibraryDisk(root:root)
        try await disk.storeImage(image,account:"account",key:"one")
        try await disk.storeImage(image,account:"account",key:"two")
        let original: Data
        var retainedOriginal: Data?
        if legacyCache {
            let raw=try XCTUnwrap(UIImage(named:"MarketStoryCoin")?.jpegData(compressionQuality:1))
            retainedOriginal=raw
            original=try prepareCoinImage(raw)
            for key in ["one","two"] {
                try await disk.storeOriginal(raw,account:"account",key:"original:"+key)
                try await disk.storeImage(original,account:"account",key:key)
            }
            let cached=await disk.image(account:"account",key:"one")
            XCTAssertNotEqual(cached,original,"The fixture must exercise the old recompression defect")
        } else { original=await disk.image(account:"account",key:"one")! }
        ReadyPairProtocol.bytes=original
        ReadyPairProtocol.rejectPhotoListing=usingAtomicMetadata
        defer { ReadyPairProtocol.rejectPhotoListing=false }
        var snapshot=LibrarySnapshot();snapshot.cursor="cursor-existing"
        try await disk.save(snapshot,account:"account")
        let remote=Coin(id:"item",version:3,userLabel:"Coin",status:"active")
        let hash=SHA256.hash(data:original).map { String(format:"%02x",$0) }.joined()
        let transferred=(0...1).map { i in CoinPhoto(id:"photo-\(i)",itemId:"item",side:i==0 ? "obverse":"reverse",
            byteSize:Int64(original.count),status:"ready",sortOrder:i,sha256:hash) }
        let pending=PendingCoin(id:"local",input:CreateCoinInput(userLabel:"Coin"),coin:Coin(id:"local",version:0,userLabel:"Coin",status:"active"),
            sessionID:usingAtomicMetadata ? "saved-session":nil,photoKeys:["one","two"],remoteCoin:remote,
            remotePhotos:usingAtomicMetadata ? transferred:nil)
        try await disk.savePending([pending],account:"account")
        let config=URLSessionConfiguration.ephemeral;config.protocolClasses=[ReadyPairProtocol.self]
        let model=NumiModel(api:NumiAPI(session:URLSession(configuration:config),vault:vault),disk:disk,telemetryEnabled:false)
        await model.bootstrap()
        for _ in 0..<200 { if model.pendingCoins.isEmpty && !model.syncing { break };try await Task.sleep(nanoseconds:20_000_000) }
        XCTAssertNil(model.error);XCTAssertTrue(model.pendingCoins.isEmpty)
        XCTAssertEqual(model.coins.count,1);XCTAssertEqual(model.library.photos.count,2)
        let reopened=LibraryDisk(root:root)
        let queue=try await reopened.loadPending(account:"account")
        XCTAssertTrue(queue.isEmpty)
        for photo in model.library.photos.values {
            let data=await reopened.image(account:"account",key:photo.cacheKey)
            XCTAssertEqual(data,original)
            if let retainedOriginal {
                let raw=await reopened.image(account:"account",key:"original:"+photo.cacheKey)
                XCTAssertEqual(raw,retainedOriginal)
            }
        }
        await model.sync()
        XCTAssertNil(model.error);XCTAssertEqual(model.coins.count,1)
    }
}
final class ReadyPairProtocol: URLProtocol {
    static var bytes=Data()
    static var rejectPhotoListing=false
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        let path=request.url!.path
        XCTAssertFalse(Self.rejectPhotoListing && path.hasSuffix("/photos"), "Atomic metadata must acknowledge photos without listing them again")
        XCTAssertTrue(path.hasSuffix("/photos") || path.hasSuffix("/sync") || path.hasSuffix("/value-history"),"Unexpected request: \(path)")
        let hash=SHA256.hash(data:Self.bytes).map { String(format:"%02x",$0) }.joined()
        let pair=(0...1).map { index in
            "{\"id\":\"photo-\(index)\",\"itemId\":\"item\",\"side\":\"\(index==0 ? "obverse":"reverse")\",\"sortOrder\":\(index),\"status\":\"ready\",\"byteSize\":\(Self.bytes.count),\"sha256\":\"\(hash)\"}"
        }.joined(separator:",")
        let body: String
        if path.hasSuffix("/photos") { body = "{\"photos\":[\(pair)]}" }
        else if path.hasSuffix("/value-history") { body = #"{"currency":"RUB","points":[]}"# }
        else { body = "{\"changes\":[],\"nextCursor\":\"cursor-existing\",\"hasMore\":false}" }
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:200,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
final class LostPhotoResponseProtocol: URLProtocol {
    override class func canInit(with request:URLRequest)->Bool { true }
    override class func canonicalRequest(for request:URLRequest)->URLRequest { request }
    override func startLoading() {
        let listed=request.url!.path.hasSuffix("/photos")
        let hash=SHA256.hash(data:Data("original-photo".utf8)).map { String(format:"%02x",$0) }.joined()
        let body=listed ? "{\"photos\":[{\"id\":\"photo\",\"itemId\":\"item\",\"side\":\"obverse\",\"sortOrder\":0,\"status\":\"ready\",\"byteSize\":14,\"sha256\":\"\(hash)\"}]}" : "{\"error\":{\"code\":\"photo_side_exists\",\"message\":\"Already uploaded\"}}"
        client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:listed ? 200:409,httpVersion:nil,headerFields:["Content-Type":"application/json"])!,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(body.utf8));client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() { }
}
