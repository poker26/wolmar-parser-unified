import Foundation
import Security

struct SavedCookie: Codable {
    var name: String; var value: String; var expires: Date?
}
struct SavedSession: Codable {
    var user: NumiUser; var cookies: [SavedCookie]
}
struct SessionVault {
    var service = "ru.begemot26.numismat.session"
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: "active-session"]
    }
    func read() throws -> SavedSession? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let result = SecItemCopyMatching(request as CFDictionary, &value)
        if result == errSecItemNotFound { return nil }
        guard result == errSecSuccess else { throw NumiError.keychain(result) }
        guard let data = value as? Data else { throw NumiError.storage }
        return try JSONDecoder().decode(SavedSession.self, from: data)
    }
    func write(_ session: SavedSession) throws {
        let data = try JSONEncoder().encode(session)
        let updates: [String: Any] = [kSecValueData as String: data]
        let result = SecItemUpdate(query as CFDictionary, updates as CFDictionary)
        if result == errSecItemNotFound {
            var insert = query
            insert[kSecValueData as String] = data
            insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(insert as CFDictionary, nil)
            guard added == errSecSuccess else { throw NumiError.keychain(added) }
        } else if result != errSecSuccess { throw NumiError.keychain(result) }
    }
    func clear() throws {
        let result = SecItemDelete(query as CFDictionary)
        guard result == errSecSuccess || result == errSecItemNotFound else { throw NumiError.keychain(result) }
    }
}

private final class OriginRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        let original = task.originalRequest?.url
        completionHandler(request.url?.scheme == original?.scheme && request.url?.host == original?.host && request.url?.port == original?.port ? request : nil)
    }
}
actor NumiAPI {
    let baseURL: URL
    private let session: URLSession
    private let vault: SessionVault
    private var cookies: [SavedCookie] = []
    private var user: NumiUser?
    private var generation = 0

    init(baseURL: URL = URL(string: "https://coins.begemot26.ru/")!, session: URLSession? = nil,
         vault: SessionVault = SessionVault()) {
        self.baseURL = baseURL
        self.vault = vault
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        self.session = session ?? URLSession(configuration: configuration, delegate: OriginRedirectDelegate(), delegateQueue: nil)
    }
    func restore() throws -> NumiUser? {
        if let saved = try vault.read() { user = saved.user; cookies = saved.cookies }
        return user
    }
    func login(email: String, password: String) async throws -> NumiUser {
        try await authenticate("login", fields: ["email": email.trimmingCharacters(in: .whitespacesAndNewlines), "password": password])
    }
    func register(email: String, password: String) async throws -> NumiUser {
        try await authenticate("register", fields: ["email": email.trimmingCharacters(in: .whitespacesAndNewlines), "password": password])
    }
    func requestPasswordReset(email: String) async throws {
        let body = try JSONEncoder().encode(["email": email.trimmingCharacters(in: .whitespacesAndNewlines)])
        let response: AcceptedResponse = try await request("api/v1/auth/password-reset/request", method: "POST", body: body)
        guard response.accepted else { throw NumiError.invalidResponse }
    }
    func resetPassword(email: String, code: String, password: String) async throws -> NumiUser {
        try await authenticate("password-reset/confirm", fields: ["email": email.trimmingCharacters(in: .whitespacesAndNewlines), "code": code.trimmingCharacters(in: .whitespacesAndNewlines), "password": password])
    }
    private func authenticate(_ path: String, fields: [String: String]) async throws -> NumiUser {
        generation += 1
        let revision = generation
        cookies = []
        user = nil
        let body = try JSONEncoder().encode(fields)
        let response: UserResponse = try await request("api/v1/auth/" + path, method: "POST", body: body)
        guard revision == generation else { throw CancellationError() }
        guard cookies.contains(where: { $0.name.hasSuffix("wolmar_session") && !$0.value.isEmpty }) else { throw NumiError.invalidResponse }
        try vault.write(SavedSession(user: response.user, cookies: cookies))
        user = response.user
        return response.user
    }
    func logout() throws {
        let request = makeRequest("api/v1/auth/logout", method: "POST", body: Data("{}".utf8))
        try vault.clear()
        generation += 1
        cookies = []
        user = nil
        // Local sign-out has already completed; a failed network request cannot restore the session.
        let transport = session
        Task { _ = try? await transport.data(for: request) }
    }
    func sync(cursor: String?) async throws -> SyncPage {
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "limit", value: "200")]
        if let cursor { parts.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await request("api/v1/collection/sync?" + (parts.percentEncodedQuery ?? ""))
    }
    func market(itemID: String) async throws -> MarketEvidence? {
        let response: MarketResponse = try await request("api/v1/collection/items/\(escaped(itemID))/market")
        return response.market
    }
    func photoURL(id: String) async throws -> String {
        let response: PhotoURLResponse = try await request("api/v1/collection/photos/\(escaped(id))/url")
        return response.url
    }
    func searchCatalog(_ query: String) async throws -> [CatalogChoice] {
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)), URLQueryItem(name: "limit", value: "30"), URLQueryItem(name: "sort", value: "passes")]
        return try await request("api/coincat/types?" + (parts.percentEncodedQuery ?? ""))
    }
    func identify(_ images: [Data]) async throws -> IdentificationResult {
        let multipart = try CoinMultipart(images: images)
        return try await request("api/v1/collection/identify", method: "POST", body: multipart.body,
                                 contentType: multipart.contentType, timeout: 150)
    }
    func create(_ pending: PendingCoin) async throws -> Coin {
        let path = pending.sessionID.map { "api/v1/collection/identifications/\(escaped($0))/save" } ?? "api/v1/collection/items"
        let response: ItemResponse = try await request(path, method: "POST", body: JSONEncoder().encode(pending.input),
                                                     headers: ["Idempotency-Key": pending.id])
        return response.item
    }
    func photos(itemID: String) async throws -> [CoinPhoto] {
        let response: PhotosResponse = try await request("api/v1/collection/items/\(escaped(itemID))/photos")
        return response.photos
    }
    private func escaped(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    }
    private func makeRequest(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: URL(string: path, relativeTo: baseURL)!.absoluteURL)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type") }
        let active = cookies.filter { $0.expires.map { $0 > Date() } ?? true }
        if !active.isEmpty { request.setValue(active.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie") }
        if method != "GET", let csrf = active.first(where: { $0.name == "__Host-wolmar_csrf" || $0.name == "wolmar_csrf" }) {
            request.setValue(csrf.value, forHTTPHeaderField: "X-CSRF-Token")
        }
        return request
    }
    private func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil,
                                      contentType: String? = nil, timeout: TimeInterval? = nil,
                                      headers extraHeaders: [String: String] = [:]) async throws -> T {
        let revision = generation
        let data: Data; let raw: URLResponse
        var outgoing = makeRequest(path, method: method, body: body)
        if let contentType { outgoing.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if let timeout { outgoing.timeoutInterval = timeout }
        for (key, value) in extraHeaders { outgoing.setValue(value, forHTTPHeaderField: key) }
        do { (data, raw) = try await session.data(for: outgoing) }
        catch is CancellationError { throw CancellationError() }
        catch { throw NumiError.unavailable }
        guard revision == generation else { throw CancellationError() }
        guard let response = raw as? HTTPURLResponse else { throw NumiError.invalidResponse }
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in result[String(describing: pair.key)] = String(describing: pair.value) }
        for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: baseURL)
        where ["__Host-wolmar_session", "__Host-wolmar_csrf", "wolmar_session", "wolmar_csrf"].contains(cookie.name) {
            cookies.removeAll { $0.name == cookie.name }
            if !cookie.value.isEmpty, cookie.expiresDate.map({ $0 > Date() }) ?? true {
                cookies.append(SavedCookie(name: cookie.name, value: cookie.value, expires: cookie.expiresDate))
            }
        }
        if let user { try vault.write(SavedSession(user: user, cookies: cookies)) }
        if response.statusCode == 401 { throw path.contains("auth/login") ? NumiError.invalidCredentials : NumiError.sessionExpired }
        if !(200..<300).contains(response.statusCode) {
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            if (json?["error"] as? [String: Any])?["resetRequired"] as? Bool == true { throw SyncResetRequired() }
            let code = (json?["error"] as? [String: Any])?["code"] as? String
            if let code, let message = apiErrorMessage(code) { throw NumiError.server(message) }
            if response.statusCode == 429 { throw NumiError.server("Сервер ограничил запросы. Сообщите об этой ошибке разработчику.") }
            throw NumiError.server("Не удалось выполнить запрос. Код сервера: \(response.statusCode).")
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw NumiError.invalidResponse }
    }
}
struct SyncResetRequired: Error {}
