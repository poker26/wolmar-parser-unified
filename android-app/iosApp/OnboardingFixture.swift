#if DEBUG
import Foundation

// Transport fixture: tests exercise the shipping views, model and API client.
final class OnboardingFixtureProtocol: URLProtocol {
    static var savedCoin: [String: Any]?
    private static var savedPhotos: [[String: Any]] = []
    private static var identifyCalls = 0
    private static var sessionExpiryIssued = false
    private static let lock = NSLock()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); defer { Self.lock.unlock() }
        let path = request.url!.path
        var status = 200
        var body: Any = [:]
        var headers = ["Content-Type": "application/json"]
        let requestData = Self.data(request)
        let fields = (try? JSONSerialization.jsonObject(with: requestData)) as? [String: Any] ?? [:]
        if path.hasSuffix("password-reset/request") { status = 202; body = ["accepted": true] }
        else if path.hasSuffix("password-reset/confirm") && fields["code"] as? String != "TEST-CODE-1234" {
            status = 400; body = ["error": ["code": "invalid_reset_code"]]
        } else if path.contains("/auth/") {
            body = ["user": ["id": "onboarding-user", "email": path.hasSuffix("/guest") ? "" : "new@example.invalid", "isGuest": path.hasSuffix("/guest")]]
            headers["Set-Cookie"] = "__Host-wolmar_session=fixture; Path=/; Secure; HttpOnly, __Host-wolmar_csrf=csrf-fixture; Path=/; Secure"
        } else if path == "/api/v1/notifications/preferences" {
            if ProcessInfo.processInfo.arguments.contains("-numi-notification-preferences-fail") {
                status = 503; body = ["error": ["code": "fixture_unavailable"]]
            } else {
                body = ["preferences": ["emailEnabled": false, "pushEnabled": false,
                    "events": ["new_offer": true, "price_changed": true, "ending_soon": true, "auction_ended": true, "availability_changed": true]],
                    "capabilities": ["email": true, "apns": false, "fcm": false], "emailVerified": true, "devices": [], "revision": 1]
            }
        } else if path == "/api/v1/notifications/events/fixture-event" {
            body = ["event": ["id": "fixture-event", "kind": "new_offer"], "destination": ["path": "/lots/17"],
                "lot": ["id": 17, "label": "Предложение из наблюдения", "priceMinor": 12345, "currency": "RUB", "photos": []]]
        } else if path == "/api/v1/collection/identify" && ProcessInfo.processInfo.arguments.contains("-numi-session-expiry") && !Self.sessionExpiryIssued {
            Self.sessionExpiryIssued = true
            status = 401; body = ["error": ["code": "authentication_required", "message": "Authentication required"]]
            headers["Set-Cookie"] = "__Host-wolmar_session=; Path=/; Secure; Max-Age=0"
        } else if path == "/api/v1/catalog/countries" {
            body = ["countries": [["value": "russia", "name": "Россия", "count": 1, "aliases": ["Russia"]]]]
        } else if path == "/api/v1/catalog/search" {
            body = ["total": 1, "items": [["id": 42, "name_full": "25 рублей. Камчатская экспедиция", "year": 2004, "country": "Россия", "metal": "silver", "mintage": 1000]]]
        } else if path == "/api/v1/catalog/types/42" {
            body = ["type": ["id": 42, "name_full": "25 рублей. Камчатская экспедиция", "year": 2004, "country": "Россия", "metal": "silver", "mintage": 1000], "issues": []]
        } else if path == "/api/v1/catalog/types/42/market" {
            body = ["market": ["activity": ["confirmedSalesCount": 2], "gradeBuckets": [], "events": []]]
        } else if path == "/api/coincat/types" {
            body = [["id": 42, "name_full": "25 рублей. Камчатская экспедиция", "year": 2004, "country": "Россия", "metal": "silver", "mintage": 1000]]
        } else if path == "/api/v1/collection/specimen-search" {
            body = ["total": 1, "items": [["key": "type:42", "kind": "catalog", "id": "42", "typeId": 42,
                "name": "25 рублей. Камчатская экспедиция", "year": 2004, "country": "Россия",
                "metal": "silver", "denomination": "25 рублей"]]]
        } else if path == "/api/v1/collection/identify" {
            Self.identifyCalls += 1
            let multipart = String(decoding: requestData, as: UTF8.self)
            if multipart.components(separatedBy: "filename=").count != 3 {
                status = 400; body = ["error": ["code": "two_photos_required"]]
            } else if ProcessInfo.processInfo.arguments.contains("-numi-identification-failure") {
                status = 503; body = ["error": ["code": "identification_unavailable"]]
            } else if Self.identifyCalls != 1 {
                status = 409; body = ["error": ["code": "unexpected_duplicate_identification"]]
            } else if ProcessInfo.processInfo.arguments.contains("-numi-first-party-reference") {
                body = Self.firstPartyResult("accepted")
            } else if ProcessInfo.processInfo.arguments.contains("-numi-first-party-abstain") {
                body = Self.firstPartyResult("abstained")
            } else if ProcessInfo.processInfo.arguments.contains("-numi-first-party-unavailable") {
                body = Self.firstPartyResult("unavailable")
            } else {
                body = ["identificationSessionId": "fixture-identification", "requestId": "capture-journey",
                    "recognizedName": "25 рублей. Камчатская экспедиция", "catalogMatch": "ambiguous",
                    "extracted": ["country": "Россия", "year": 2004, "metal": "silver"],
                    "candidates": [["id": 42, "name": "25 рублей. Камчатская экспедиция", "country": "Россия", "year": 2004]]]
            }
        } else if (path == "/api/v1/collection/items" || path == "/api/v1/collection/identifications/fixture-identification/save") && request.httpMethod == "POST" {
            if request.value(forHTTPHeaderField: "X-CSRF-Token") != "csrf-fixture" || request.value(forHTTPHeaderField: "Idempotency-Key") == nil {
                status = 403; body = ["error": ["code": "csrf_failed"]]
            } else {
                var coin: [String: Any] = ["id": "saved-first-coin", "version": 1, "status": "active", "typeId": fields["typeId"] ?? NSNull(),
                    "userLabel": fields["userLabel"] ?? NSNull(), "properties": fields["properties"] ?? NSNull(),
                    "userLabelSource": fields["userLabelSource"] ?? NSNull(),
                    "typeName": fields["typeId"] is NSNumber ? "25 рублей. Камчатская экспедиция" : NSNull(), "gradeCode": fields["gradeCode"] ?? "PF", "catalog": ["year": 2004, "country": "Россия", "metal": "silver", "mintage": 1000]]
                if !(fields["typeId"] is NSNumber) {
                    coin.removeValue(forKey: "catalog")
                    if fields["gradeCode"] == nil { coin.removeValue(forKey: "gradeCode") }
                }
                Self.savedCoin = coin; status = 201; body = ["item": coin]
                if path.hasSuffix("/save") { Self.savedPhotos = (0..<2).map(Self.photo) }
            }
        } else if path == "/api/v1/collection/items/saved-first-coin/photos" {
            body = ["photos": Self.savedPhotos]
        } else if path.hasSuffix("/photos/upload-intent") {
            let photo = Self.photo(index: fields["sortOrder"] as? Int ?? 0)
            body = ["photo": photo, "upload": ["method": "PUT", "url": "https://fixture.invalid/photo-upload",
                "headers": [:], "expiresAt": "2099-01-01T00:00:00Z"]]
        } else if path == "/photo-upload" && request.httpMethod == "PUT" { status = 204
        } else if path.hasSuffix("/photos/complete") {
            let photo = Self.photo(index: fields["photoId"] as? String == "captured-1" ? 1 : 0)
            Self.savedPhotos.append(photo); body = ["photo": photo]
        } else if path == "/api/v1/collection/items/saved-first-coin" && request.httpMethod == "PATCH" {
            if request.value(forHTTPHeaderField: "X-CSRF-Token") != "csrf-fixture" {
                status = 403; body = ["error": ["code": "csrf_failed"]]
            } else if var coin = Self.savedCoin {
                let version = coin["version"] as? Int ?? 1
                if request.value(forHTTPHeaderField: "If-Match") != "\"\(version)\"" {
                    status = 409; body = ["error": ["code": "version_conflict"]]
                } else {
                    for (key, value) in fields { coin[key] = value }
                    coin["version"] = version + 1
                    Self.savedCoin = coin; body = ["item": coin]
                }
            } else { status = 404; body = ["error": ["code": "not_found"]] }
        } else if path == "/api/v1/collection/items/saved-first-coin" && request.httpMethod == "DELETE" {
            if request.value(forHTTPHeaderField: "X-CSRF-Token") != "csrf-fixture" {
                status = 403; body = ["error": ["code": "csrf_failed"]]
            } else { Self.savedCoin = nil; Self.savedPhotos = []; status = 204 }
        } else if path.hasSuffix("/sync") {
            var changes: [[String: Any]] = []
            if let coin = Self.savedCoin { changes = [["seq": "1", "entityKind": "item", "entityId": "saved-first-coin", "itemId": "saved-first-coin", "operation": "upsert", "item": coin]] }
            body = ["changes": changes, "nextCursor": "fixture-cursor", "hasMore": false]
        } else if path.hasSuffix("/market") {
            body = ["market": ["activity": ["confirmedSalesCount": 2], "gradeBuckets": [], "events": []]]
        } else if path == "/api/v1/collection/value-history" {
            body = ["currency": "RUB", "points": []]
        } else if path == "/api/v1/collection/valuation/recalculation" {
            body = ["job": NSNull()]
        } else if path == "/api/v1/collection/valuation/recalculate" {
            guard let requestID = fields["requestId"] as? String, UUID(uuidString: requestID) != nil else {
                client?.urlProtocol(self, didFailWithError: NSError(domain: "batch-fixture", code: 1)); return
            }
            body = ["job": ["requestId": requestID, "status": "completed", "total": 2, "processed": 2,
                            "valued": 1, "unvalued": 1, "failed": 0, "skipped": 0]]
        } else if path.hasSuffix("/valuation/recalculate") {
            body = ["valuation": ["id": "fixture-floor", "status": "floor_only", "estimateKind": "metal_floor",
                                   "currency": "RUB", "valueFloorMinor": 125000]]
        } else { status = 404; body = ["error": ["code": "fixture_endpoint_missing"]] }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        let data = status == 204 ? Data() : (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
        let deliver = { [self] in
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
        if path == "/api/v1/collection/identify" && ProcessInfo.processInfo.arguments.contains("-numi-identification-waiting") {
            DispatchQueue.global().asyncAfter(deadline: .now() + 8, execute: deliver)
        } else { deliver() }
    }
    static func fields(_ request: URLRequest) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: data(request))) as? [String: Any] ?? [:]
    }
    // UI transport fixture follows the real node-persistence.json contract. Unit tests decode its original bytes.
    private static func firstPartyResult(_ name: String) -> [String: Any] {
        let accepted = name == "accepted"
        var result: [String: Any] = ["identificationSessionId": "fixture-identification", "requestId": "first-party-" + name,
            "recognizedName": NSNull(), "catalogMatch": accepted ? "ambiguous" : "not_found", "extracted": [:],
            "candidates": [], "designMatch": accepted ? "general_design" : "abstain",
            "catalogSearchStatus": accepted ? "reference_found" : "insufficient_evidence",
            "referenceTypeId": NSNull(), "exactIdentityAccepted": false]
        if accepted {
            result["referenceTypeId"] = 372677
            result["candidates"] = [["id": 372677, "name": "ESCUDO. PORTUGAL — Цветочный дизайн над номиналом",
                "matchLevel": "general_design", "referenceTypeId": 372677, "exactIdentityAccepted": false,
                "catalogReference": ["typeId": 372677, "name": "ESCUDO. PORTUGAL — Цветочный дизайн над номиналом",
                    "country": "Portugal", "year": 2000, "metal": "Никель", "denomination": "ESCUDO",
                    "mintage": 14882000, "source": "scwc"]]]
        }
        if name == "unavailable" { result["recognitionError"] = ["code": "recognition_failed"] }
        return result
    }
    private static func photo(index: Int) -> [String: Any] {
        ["id": "captured-\(index)", "itemId": "saved-first-coin", "side": index == 0 ? "obverse" : "reverse",
         "byteSize": 100, "status": "ready", "sortOrder": index]
    }
    private static func data(_ request: URLRequest) -> Data {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count))
            }
        }
        return data
    }
    override func stopLoading() { }
}
#endif
