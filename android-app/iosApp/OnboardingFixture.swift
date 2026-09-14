#if DEBUG
import Foundation

// Transport fixture: tests exercise the shipping views, model and API client.
final class OnboardingFixtureProtocol: URLProtocol {
    static var savedCoin: [String: Any]?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        var status = 200
        var body: Any = [:]
        var headers = ["Content-Type": "application/json"]
        let fields = Self.fields(request)
        if path.hasSuffix("password-reset/request") { status = 202; body = ["accepted": true] }
        else if path.hasSuffix("password-reset/confirm") && fields["code"] as? String != "TEST-CODE-1234" {
            status = 400; body = ["error": ["code": "invalid_reset_code"]]
        } else if path.contains("/auth/") {
            body = ["user": ["id": "onboarding-user", "email": "new@example.invalid"]]
            headers["Set-Cookie"] = "__Host-wolmar_session=fixture; Path=/; Secure; HttpOnly, __Host-wolmar_csrf=csrf-fixture; Path=/; Secure"
        } else if path == "/api/coincat/types" {
            body = [["id": 42, "name_full": "25 рублей. Камчатская экспедиция", "year": 2004, "country": "Россия", "metal": "silver", "mintage": 1000]]
        } else if path == "/api/v1/collection/items" && request.httpMethod == "POST" {
            if request.value(forHTTPHeaderField: "X-CSRF-Token") != "csrf-fixture" || request.value(forHTTPHeaderField: "Idempotency-Key") == nil {
                status = 403; body = ["error": ["code": "csrf_failed"]]
            } else {
                let coin: [String: Any] = ["id": "saved-first-coin", "version": 1, "status": "active", "typeId": 42,
                    "typeName": "25 рублей. Камчатская экспедиция", "gradeCode": fields["gradeCode"] ?? "PF", "catalog": ["year": 2004, "country": "Россия", "metal": "silver", "mintage": 1000]]
                Self.savedCoin = coin; status = 201; body = ["item": coin]
            }
        } else if path.hasSuffix("/sync") {
            var changes: [[String: Any]] = []
            if let coin = Self.savedCoin { changes = [["seq": "1", "entityKind": "item", "entityId": "saved-first-coin", "itemId": "saved-first-coin", "operation": "upsert", "item": coin]] }
            body = ["changes": changes, "nextCursor": "fixture-cursor", "hasMore": false]
        } else if path.hasSuffix("/market") {
            body = ["market": ["activity": ["confirmedSalesCount": 2], "gradeBuckets": [], "events": []]]
        } else { status = 404; body = ["error": ["code": "fixture_endpoint_missing"]] }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: (try? JSONSerialization.data(withJSONObject: body)) ?? Data())
        client?.urlProtocolDidFinishLoading(self)
    }
    static func fields(_ request: URLRequest) -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count))
            }
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
    override func stopLoading() { }
}
#endif
