import Foundation
import Security

struct SavedCookie: Codable {
    var name: String; var value: String; var expires: Date?
}
struct SavedSession: Codable {
    var user: NumiUser; var cookies: [SavedCookie]
    var authenticationRequired: Bool? = nil
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
    private let guestVault: GuestVault
    private var cookies: [SavedCookie] = []
    private var user: NumiUser?
    private var generation = 0
    private var authenticationRequired = false
    private var authenticationHandler: (@Sendable (String) -> Void)?
    private(set) var lastRecognitionTiming: RecognitionTiming?

    init(baseURL: URL = URL(string: "https://coins.begemot26.ru/")!, session: URLSession? = nil,
         vault: SessionVault = SessionVault(), guestVault: GuestVault = GuestVault()) {
        self.baseURL = baseURL
        self.vault = vault
        self.guestVault = guestVault
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        self.session = session ?? URLSession(configuration: configuration, delegate: OriginRedirectDelegate(), delegateQueue: nil)
    }
    func restore() throws -> NumiUser? {
        if let saved = try vault.read() {
            user = saved.user; cookies = saved.cookies
            authenticationRequired = saved.authenticationRequired == true && !saved.user.guest
        }
        else if let guest = try guestVault.read() { user = NumiUser(id: guest.id, email: "", isGuest: true) }
        return user
    }
    func setAuthenticationRequiredHandler(_ handler: @escaping @Sendable (String) -> Void) {
        authenticationHandler = handler
    }
    func requiresAuthentication(account: String) -> Bool {
        user?.id == account && authenticationRequired
    }
    private func requireAuthentication() {
        guard let user, !user.guest else { return }
        authenticationRequired = true
        try? vault.write(SavedSession(user: user, cookies: cookies, authenticationRequired: true))
        authenticationHandler?(user.id)
    }
    private func checkAuthentication(_ path: String) throws {
        if authenticationRequired && path.hasPrefix("api/v1/") &&
            (!path.hasPrefix("api/v1/auth/") || path == "api/v1/auth/me") && !path.hasPrefix("api/v1/catalog/") {
            requireAuthentication()
            throw NumiError.sessionExpired
        }
    }
    func mobileObservations(_ batch: MobileObservationBatch) async throws -> MobileObservationAck {
        try await ensureGuestSession()
        return try await request("api/v1/analytics/mobile-observations", method: "POST", body: JSONEncoder().encode(batch))
    }
    func localGuest() throws -> NumiUser {
        let proof = try guestVault.loadOrCreate()
        let guest = NumiUser(id: proof.id, email: "", isGuest: true)
        user = guest
        return guest
    }
    func ensureGuestSession() async throws {
        guard user?.guest == true else { return }
        if cookies.contains(where: { $0.name.hasSuffix("wolmar_session") && !$0.value.isEmpty }) { return }
        _ = try await startGuest()
    }
    func startGuest() async throws -> NumiUser {
        let proof = try guestVault.loadOrCreate()
        let body = try JSONEncoder().encode(proof)
        cookies = []
        let response: UserResponse = try await request("api/v1/auth/guest", method: "POST", body: body)
        guard cookies.contains(where: { $0.name.hasSuffix("wolmar_session") && !$0.value.isEmpty }) else { throw NumiError.invalidResponse }
        var guest = response.user; guest.isGuest = true
        user = guest
        try vault.write(SavedSession(user: guest, cookies: cookies))
        return guest
    }
    func registerGuest(email: String, password: String) async throws -> NumiUser {
        let proof = try guestVault.loadOrCreate()
        let body = try JSONEncoder().encode(["id": proof.id, "secret": proof.secret,
                                             "email": email.trimmingCharacters(in: .whitespacesAndNewlines), "password": password])
        let response: UserResponse = try await request("api/v1/auth/guest/register", method: "POST", body: body)
        var account = response.user; account.isGuest = false
        user = account
        try vault.write(SavedSession(user: account, cookies: cookies))
        try guestVault.clear()
        return account
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
        let previousUser = user; let previousCookies = cookies
        let previousAuthenticationRequired = authenticationRequired
        cookies = []
        user = nil
        do {
            let body = try JSONEncoder().encode(fields)
            let response: UserResponse = try await request("api/v1/auth/" + path, method: "POST", body: body)
            guard revision == generation else { throw CancellationError() }
            guard cookies.contains(where: { $0.name.hasSuffix("wolmar_session") && !$0.value.isEmpty }) else { throw NumiError.invalidResponse }
            try vault.write(SavedSession(user: response.user, cookies: cookies))
            user = response.user; authenticationRequired = false
            return response.user
        } catch {
            if revision == generation {
                user = previousUser; cookies = previousCookies
                authenticationRequired = previousAuthenticationRequired
            }
            throw error
        }
    }
    func logout() throws {
        let request = makeRequest("api/v1/auth/logout", method: "POST", body: Data("{}".utf8))
        try vault.clear()
        generation += 1
        cookies = []
        user = nil
        authenticationRequired = false
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
    func recalculate(itemID: String) async throws -> CoinValuation {
        struct ValuationResponse: Decodable { let valuation: CoinValuation }
        let response: ValuationResponse = try await request(
            "api/v1/collection/items/\(escaped(itemID))/valuation/recalculate",
            method: "POST", body: Data("{}".utf8))
        return response.valuation
    }
    func startCollectionRevaluation(requestID: String) async throws -> CollectionRevaluationJob? {
        let response: CollectionRevaluationResponse = try await request("api/v1/collection/valuation/recalculate",
            method: "POST", body: JSONEncoder().encode(CollectionRevaluationRequest(requestId: requestID)))
        return response.job
    }
    func collectionRevaluation() async throws -> CollectionRevaluationJob? {
        let response: CollectionRevaluationResponse = try await request("api/v1/collection/valuation/recalculation")
        return response.job
    }
    func collectionValueHistory() async throws -> CollectionValueHistory {
        try await request("api/v1/collection/value-history")
    }
    func photoURL(id: String) async throws -> String {
        let response: PhotoURLResponse = try await request("api/v1/collection/photos/\(escaped(id))/url")
        return response.url
    }
    func searchCatalog(_ query: String, country: String = "", year: String = "", denomination: String = "") async throws -> [CatalogChoice] {
        return try await browseCatalog(country: country, year: year, denomination: denomination, query: query).items
    }
    func searchSpecimens(query: String, country: String, year: String, denomination: String,
                         metal: String, offset: Int = 0) async throws -> SpecimenSearchResponse {
        var parts = URLComponents()
        parts.queryItems = []
        for (key, value) in [("q", query), ("country", country), ("year", year),
                             ("denomination", denomination), ("metal", metal)] {
            let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { parts.queryItems?.append(URLQueryItem(name: key, value: text)) }
        }
        if offset > 0 { parts.queryItems?.append(URLQueryItem(name: "offset", value: String(offset))) }
        return try await request("api/v1/collection/specimen-search?" + (parts.percentEncodedQuery ?? ""))
    }
    func catalogCountries() async throws -> [CatalogCountry] {
        let response: CatalogCountries = try await request("api/v1/catalog/countries?directory=2")
        return response.countries
    }
    func browseCatalog(country: String, year: String, denomination: String, query: String, offset: Int = 0) async throws -> CatalogPage {
        var parts = URLComponents()
        parts.queryItems = [URLQueryItem(name: "limit", value: "30"), URLQueryItem(name: "offset", value: String(offset)), URLQueryItem(name: "sort", value: "passes")]
        for pair in [("country", country), ("year", year), ("denomination", denomination), ("q", query)] where !pair.1.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.queryItems?.append(URLQueryItem(name: pair.0, value: pair.1.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        return try await request("api/v1/catalog/search?" + (parts.percentEncodedQuery ?? ""))
    }
    func catalogDetail(_ id: Int64) async throws -> CatalogDetail {
        try await request("api/v1/catalog/types/\(id)")
    }
    func catalogMarket(_ id: Int64) async throws -> MarketEvidence? {
        let response: MarketResponse = try await request("api/v1/catalog/types/\(id)/market")
        return response.market
    }
    func imageData(_ address: String) async throws -> Data {
        guard let url = URL(string: address, relativeTo: baseURL)?.absoluteURL, url.scheme == "https" else { throw NumiError.invalidResponse }
        let revision = generation
        let ownOrigin = url.host == baseURL.host && url.port == baseURL.port && url.scheme == baseURL.scheme
        if ownOrigin { try checkAuthentication(String(url.path.dropFirst())) }
        var request = URLRequest(url: url); request.timeoutInterval = 60
        if ownOrigin {
            let active = cookies.filter { $0.expires.map { $0 > Date() } ?? true }
            if !active.isEmpty { request.setValue(active.map { "\($0.name)=\($0.value)" }.joined(separator: "; "), forHTTPHeaderField: "Cookie") }
        }
        let (data, response) = try await session.data(for: request)
        guard revision == generation else { throw CancellationError() }
        if ownOrigin, (response as? HTTPURLResponse)?.statusCode == 401 { requireAuthentication(); throw NumiError.sessionExpired }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, !data.isEmpty else { throw NumiError.invalidResponse }
        return data
    }
    func identify(_ images: [Data]) async throws -> IdentificationResult {
        let started = ProcessInfo.processInfo.systemUptime
        let multipart = try CoinMultipart(images: images)
        let timing = RecognitionMetricsDelegate(started: started, prepared: ProcessInfo.processInfo.systemUptime)
        do {
            let result: IdentificationResult = try await request("api/v1/collection/identify", method: "POST", body: multipart.body,
                contentType: multipart.contentType, timeout: 150, timing: timing)
            lastRecognitionTiming = timing.finish(requestID: result.requestId)
            return result
        } catch {
            lastRecognitionTiming = timing.finish(requestID: nil)
            throw error
        }
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
    func uploadPhoto(itemID: String, data: Data, index: Int) async throws -> CoinPhoto {
        do { return try await sendPhoto(itemID: itemID, data: data, index: index) }
        catch {
            if error is CancellationError { throw error }
            if case NumiError.sessionExpired = error { throw error }
            if let photos = try? await photos(itemID: itemID),
               let ready = recoveredUpload(photos, itemID: itemID, data: data, index: index) { return ready }
            throw error
        }
    }
    private func sendPhoto(itemID: String, data: Data, index: Int) async throws -> CoinPhoto {
        let intentInput = PhotoUploadIntentInput(side: index == 0 ? "obverse" : "reverse", mimeType: "image/jpeg", byteSize: data.count, sortOrder: index)
        let intent: PhotoUploadIntentResponse = try await request("api/v1/collection/items/\(escaped(itemID))/photos/upload-intent",
            method: "POST", body: JSONEncoder().encode(intentInput))
        guard let url = URL(string: intent.upload.url), url.scheme == "https", intent.upload.method.uppercased() == "PUT" else { throw NumiError.invalidResponse }
        var upload = URLRequest(url: url); upload.httpMethod = "PUT"; upload.httpBody = data
        for (key, value) in intent.upload.headers { upload.setValue(value, forHTTPHeaderField: key) }
        let (_, raw) = try await session.data(for: upload)
        guard let response = raw as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw NumiError.unavailable }
        let completed: PhotoResponse = try await request("api/v1/collection/items/\(escaped(itemID))/photos/complete",
            method: "POST", body: JSONEncoder().encode(PhotoCompleteInput(photoId: intent.photo.id)))
        return completed.photo
    }
    func update(_ id: String, version: Int64, input: UpdateCoinInput) async throws -> Coin {
        let response: ItemResponse = try await request("api/v1/collection/items/\(escaped(id))", method: "PATCH",
            body: JSONEncoder().encode(input), headers: ["If-Match": "\"\(version)\""])
        return response.item
    }
    func linkCatalog(_ id: String, version: Int64, input: LinkCatalogInput) async throws -> Coin {
        let response: ItemResponse = try await request("api/v1/collection/items/\(escaped(id))", method: "PATCH",
            body: JSONEncoder().encode(input), headers: ["If-Match": "\"\(version)\""])
        return response.item
    }
    func markSold(_ id: String, version: Int64, input: SoldCoinInput) async throws -> Coin {
        let response: ItemResponse = try await request("api/v1/collection/items/\(escaped(id))/sold", method: "POST",
            body: JSONEncoder().encode(input), headers: ["If-Match": "\"\(version)\""])
        return response.item
    }
    func activate(_ id: String, version: Int64) async throws -> Coin {
        let response: ItemResponse = try await request("api/v1/collection/items/\(escaped(id))/activate", method: "POST",
            body: Data("{}".utf8), headers: ["If-Match": "\"\(version)\""])
        return response.item
    }
    func delete(_ id: String, version: Int64) async throws {
        try checkAuthentication("api/v1/collection/items")
        let revision = generation
        let outgoing = makeRequest("api/v1/collection/items/\(escaped(id))", method: "DELETE", body: nil)
        var request = outgoing
        request.setValue("\"\(version)\"", forHTTPHeaderField: "If-Match")
        do {
            let (_, raw) = try await session.data(for: request)
            guard revision == generation else { throw CancellationError() }
            if (raw as? HTTPURLResponse)?.statusCode == 401 { requireAuthentication(); throw NumiError.sessionExpired }
            guard let response = raw as? HTTPURLResponse, response.statusCode == 204 else { throw NumiError.invalidResponse }
        } catch let error as NumiError { throw error }
        catch is CancellationError { throw CancellationError() }
        catch { throw NumiError.unavailable }
    }
    func requestExport(password: String) async throws -> ExportCreateResponse {
        try await request("api/v1/collection/exports", method: "POST", body: JSONEncoder().encode(["password": password]))
    }
    func exportStatus(_ id: String) async throws -> ExportStatusResponse {
        try await request("api/v1/collection/exports/\(escaped(id))")
    }
    func deleteAccount(password: String) async throws -> AccountDeletionResponse {
        let response: AccountDeletionResponse = try await request("api/v1/account/deletion", method: "POST",
            body: JSONEncoder().encode(["password": password]))
        try vault.clear(); generation += 1; cookies = []; user = nil
        return response
    }
    private func escaped(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
    }
    private func makeRequest(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: URL(string: path, relativeTo: baseURL)!.absoluteURL)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("ios", forHTTPHeaderField: "X-Numi-Platform")
        if let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String {
            request.setValue(version, forHTTPHeaderField: "X-Numi-App-Version")
        }
        if let region = Locale.current.regionCode?.uppercased(),
           region.range(of: "^[A-Z]{2}$", options: .regularExpression) != nil {
            request.setValue(region, forHTTPHeaderField: "X-Numi-Region")
        }
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
                                      headers extraHeaders: [String: String] = [:], timing: RecognitionMetricsDelegate? = nil) async throws -> T {
        try checkAuthentication(path)
        let revision = generation
        let data: Data; let raw: URLResponse
        var outgoing = makeRequest(path, method: method, body: body)
        if let contentType { outgoing.setValue(contentType, forHTTPHeaderField: "Content-Type") }
        if let timeout { outgoing.timeoutInterval = timeout }
        for (key, value) in extraHeaders { outgoing.setValue(value, forHTTPHeaderField: key) }
        do {
            if let timing { (data, raw) = try await session.data(for: outgoing, delegate: timing) }
            else { (data, raw) = try await session.data(for: outgoing) }
        }
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
        if response.statusCode == 401 {
            let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let code = (payload?["error"] as? [String: Any])?["code"] as? String
            if code == "invalid_credentials" { throw NumiError.invalidCredentials }
            if code == "reauthentication_failed" { throw NumiError.server("Неверный пароль.") }
            if (!path.hasPrefix("api/v1/auth/") || path == "api/v1/auth/me") && !path.hasPrefix("api/v1/catalog/") { requireAuthentication() }
            throw path.contains("auth/login") ? NumiError.invalidCredentials : NumiError.sessionExpired
        }
        if let user { try vault.write(SavedSession(user: user, cookies: cookies, authenticationRequired: authenticationRequired)) }
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
