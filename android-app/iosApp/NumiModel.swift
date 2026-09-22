import Foundation
import SwiftUI

@MainActor final class NumiModel: ObservableObject {
    @Published private(set) var user: NumiUser?
    @Published private(set) var library = LibrarySnapshot()
    @Published private(set) var pendingCoins: [PendingCoin] = []
    @Published var loading = true
    @Published var signingIn = false
    @Published var syncing = false
    @Published var progress = ""
    @Published var error: String?
    @Published var needsLogin = false
    @Published var mediaRevision = 0
    @Published var startInCatalog = false
    @Published var startWithAdd = false
    @Published var loadingMarket: Set<String> = []
    @Published var dataBusy = false
    @Published var notice: String?
    @Published var exportFile: URL?
    let api: NumiAPI
    let disk: LibraryDisk
    private var bootstrapped = false
    private var revision = 0
    private var fixture = false
    private var syncRequested = false
    private var enqueuing = false

    init(api: NumiAPI = NumiAPI(), disk: LibraryDisk = LibraryDisk()) {
        self.api = api; self.disk = disk
    }
    static func forApp() -> NumiModel {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-numi-onboarding-fixture") {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [OnboardingFixtureProtocol.self]
            let vault = SessionVault(service: "numi-onboarding-ui-" + UUID().uuidString)
            let guestVault = GuestVault(service: "numi-onboarding-guest-ui-" + UUID().uuidString)
            let disk = LibraryDisk(root: FileManager.default.temporaryDirectory.appendingPathComponent("numi-ui-" + UUID().uuidString))
            return NumiModel(api: NumiAPI(session: URLSession(configuration: config), vault: vault, guestVault: guestVault), disk: disk)
        }
        #endif
        return NumiModel()
    }
    var coins: [Coin] {
        let shadowed = Set(pendingCoins.compactMap { $0.remoteCoin?.id })
        return (pendingCoins.map(\.coin) + library.items.values.filter { !shadowed.contains($0.id) })
            .sorted { ($0.createdAt ?? "", $0.id) > ($1.createdAt ?? "", $1.id) }
    }
    func bootstrap() async {
        guard !bootstrapped else { return }
        bootstrapped = true
        defer { loading = false }
        do {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-numi-ui-fixture") {
                fixture = true
                user = NumiUser(id: "ui-fixture", email: "demo@example.invalid", displayName: "Коллекционер")
                library = try Self.fixtureLibrary()
                return
            }
            #endif
            user = try await api.restore()
            if let user {
                library = try await disk.load(account: user.id)
                pendingCoins = try await disk.loadPending(account: user.id)
                if library.cursor == nil || !pendingCoins.isEmpty { Task { await sync() } }
            }
        } catch { self.error = error.localizedDescription }
    }
    func startGuest(catalog: Bool = false, add: Bool = false) async {
        error = nil; startInCatalog = catalog; startWithAdd = add
        do {
            let guest = try await api.localGuest()
            user = guest
            library = try await disk.load(account: guest.id)
            pendingCoins = try await disk.loadPending(account: guest.id)
            Task {
                do { try await api.ensureGuestSession(); await sync() }
                catch { if self.user?.id == guest.id { self.error = error.localizedDescription } }
            }
        } catch { self.error = error.localizedDescription }
    }
    func signIn(email: String, password: String, action: AccountAction = .login, code: String = "") async {
        guard !signingIn else { return }
        signingIn = true; error = nil
        defer { signingIn = false }
        do {
            let authenticated: NumiUser
            switch action {
            case .login: authenticated = try await api.login(email: email, password: password)
            case .register:
                authenticated = user?.guest == true
                    ? try await api.registerGuest(email: email, password: password)
                    : try await api.register(email: email, password: password)
            case .reset: authenticated = try await api.resetPassword(email: email, code: code, password: password)
            }
            revision += 1
            syncing = false; progress = ""; loadingMarket = []
            user = authenticated
            library = LibrarySnapshot()
            pendingCoins = []
            library = try await disk.load(account: authenticated.id)
            pendingCoins = try await disk.loadPending(account: authenticated.id)
            mediaRevision += 1
            needsLogin = false
            Task { await sync() }
        } catch { self.error = error.localizedDescription }
    }
    func signOut() async {
        revision += 1
        syncing = false
        do {
            try await api.logout()
            user = nil; library = LibrarySnapshot(); error = nil; needsLogin = false
            pendingCoins = []; syncRequested = false
            loadingMarket = []
        } catch { self.error = error.localizedDescription }
    }
    func exportCollection(password: String) async {
        guard !dataBusy, !password.isEmpty else { error = "Введите пароль."; return }
        dataBusy = true; error = nil; notice = nil
        defer { dataBusy = false }
        do {
            let created = try await api.requestExport(password: password)
            for _ in 0..<120 {
                let status = try await api.exportStatus(created.export.id)
                if status.export.status == "ready", let download = status.download,
                   let url = URL(string: download.url), url.scheme == "https" {
                    let (data, response) = try await URLSession.shared.data(from: url)
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode), !data.isEmpty else { throw NumiError.unavailable }
                    let target = FileManager.default.temporaryDirectory.appendingPathComponent(download.fileName)
                    try data.write(to: target, options: .atomic)
                    exportFile = target; notice = "Архив готов."
                    return
                }
                if ["failed", "expired"].contains(status.export.status) { throw NumiError.server("Не удалось подготовить архив.") }
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }
            throw NumiError.server("Архив ещё создаётся. Повторите загрузку позже.")
        } catch { self.error = error.localizedDescription }
    }
    func deleteAccount(password: String) async -> Bool {
        guard let account = user?.id, !dataBusy, !password.isEmpty else { error = "Введите пароль."; return false }
        dataBusy = true; error = nil
        defer { dataBusy = false }
        do {
            _ = try await api.deleteAccount(password: password)
            try await disk.clear(account: account)
            revision += 1; user = nil; library = LibrarySnapshot(); pendingCoins = []
            syncing = false; loadingMarket = []; needsLogin = false
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private func current(_ account: String, _ token: Int) -> Bool { user?.id == account && revision == token }
    func sync() async {
        guard let account = user?.id, !fixture else { return }
        guard !syncing else { syncRequested = true; return }
        let token = revision
        syncRequested = false
        syncing = true; progress = "Синхронизация монет…"; error = nil
        defer {
            if current(account, token) {
                syncing = false; progress = ""
                if syncRequested { syncRequested = false; Task { await sync() } }
            }
        }
        do {
            if user?.guest == true { try await api.ensureGuestSession() }
            try await sendPending(account: account, token: token)
            guard current(account, token) else { return }
            var candidate = library
            var resetting = false
            var didReset = false
            repeat {
                let page: SyncPage
                do { page = try await api.sync(cursor: candidate.cursor) }
                catch is SyncResetRequired {
                    guard !didReset else { throw NumiError.invalidSync }
                    candidate = LibrarySnapshot(); resetting = true; didReset = true
                    continue
                }
                guard current(account, token) else { return }
                candidate = try candidate.applying(page)
                // A cursor reset replaces the visible snapshot only after the full new snapshot arrives.
                if !resetting || !page.hasMore {
                    try await disk.save(candidate, account: account)
                    guard current(account, token) else { return }
                    library = candidate
                }
                progress = "Синхронизация · \(candidate.items.count) монет"
                if !page.hasMore { break }
            } while true
            guard current(account, token) else { return }
            let jobs = mediaJobs()
            let loader = MediaLoader(api: api, disk: disk)
            var failed = 0
            // Four independent transfers overlap while keeping decoding and memory use bounded.
            for offset in stride(from: 0, to: jobs.count, by: 4) {
                guard current(account, token) else { return }
                let batch = Array(jobs[offset..<min(offset + 4, jobs.count)])
                failed += await withTaskGroup(of: Bool.self, returning: Int.self) { group in
                    for job in batch { group.addTask { do { try await loader.run(job, account: account); return true } catch { return false } } }
                    var failures = 0
                    for await success in group { if !success { failures += 1 } }
                    return failures
                }
                guard current(account, token) else { return }
                mediaRevision += 1
                progress = "Фото · \(min(offset + 4, jobs.count)) из \(jobs.count)"
            }
            guard current(account, token) else { return }
            library.syncedAt = Date()
            try await disk.save(library, account: account)
            if failed > 0 { error = "Не удалось загрузить фото: \(failed). Повторите синхронизацию." }
        } catch {
            guard current(account, token) else { return }
            self.error = error.localizedDescription
            if case NumiError.sessionExpired = error { needsLogin = true }
        }
    }
    func addCatalog(_ detail: CatalogDetail, issue: CatalogIssue? = nil) async throws {
        guard let account = user?.id else { throw NumiError.sessionExpired }
        let id = UUID().uuidString
        let snapshot = detail.snapshot(issue)
        let properties = CoinProperties(values: [
            "country": snapshot.country ?? "", "year": snapshot.year.map(String.init) ?? "",
            "metal": snapshot.metal ?? "", "subject": snapshot.subject ?? ""
        ].filter { !$0.value.isEmpty })
        let input = CreateCoinInput(typeId: detail.type.id, issueId: issue?.id,
            identifiedYear: issue?.year ?? detail.type.year, userLabel: nil,
            identificationRequestId: nil, gradeCode: nil, properties: properties)
        let coin = Coin(id: id, version: 0, typeId: detail.type.id, issueId: issue?.id,
            identifiedYear: issue?.year ?? detail.type.year, typeName: detail.type.name,
            userLabel: nil, identificationStatus: "catalog_selected", gradeCode: nil,
            slabStatus: "unknown", gradingCompanyCode: nil, slabCertificateNumber: nil,
            purchasePriceMinor: nil, purchaseCurrency: nil, purchaseDate: nil,
            purchaseSource: nil, notes: nil, status: "active", soldPriceMinor: nil,
            soldCurrency: nil, soldAt: nil, createdAt: ISO8601DateFormatter().string(from: Date()),
            updatedAt: nil, properties: properties, catalog: snapshot, krauseReference: nil, valuation: nil)
        _ = account
        try await enqueue(PendingCoin(id: id, input: input, coin: coin, sessionID: nil, photoKeys: []))
    }
    func linkCatalog(_ coinID: String, choice: CatalogChoice) async throws {
        guard let account = user?.id, let coin = coins.first(where: { $0.id == coinID }) else { throw NumiError.storage }
        var values = coin.properties?.values ?? [:]
        if values["country"]?.nonempty == nil, let value = choice.country { values["country"] = value }
        if values["year"]?.nonempty == nil, let value = choice.year { values["year"] = String(value) }
        if values["metal"]?.nonempty == nil, let value = choice.metal { values["metal"] = value }
        let properties = CoinProperties(values: values, manualFields: coin.properties?.manualFields ?? [])
        if let index = pendingCoins.firstIndex(where: { $0.id == coinID }) {
            pendingCoins[index].input.typeId = choice.id
            pendingCoins[index].input.issueId = nil
            pendingCoins[index].input.identifiedYear = choice.year ?? coin.identifiedYear
            pendingCoins[index].input.userLabel = nil
            pendingCoins[index].input.properties = properties
            pendingCoins[index].coin.typeId = choice.id
            pendingCoins[index].coin.typeName = choice.name
            pendingCoins[index].coin.userLabel = nil
            pendingCoins[index].coin.identifiedYear = choice.year ?? coin.identifiedYear
            pendingCoins[index].coin.properties = properties
            pendingCoins[index].coin.catalog = CatalogSnapshot(year: choice.year, country: choice.country, metal: choice.metal,
                mintage: choice.mintage, imageUrl: choice.thumb)
            try await disk.savePending(pendingCoins, account: account)
        } else {
            let updated = try await api.linkCatalog(coinID, version: coin.version,
                input: LinkCatalogInput(typeId: choice.id, issueId: nil,
                    identifiedYear: choice.year ?? coin.identifiedYear, properties: properties))
            library.items[coinID] = updated
            try await disk.save(library, account: account)
        }
        mediaRevision += 1
    }
    func mediaJobs() -> [MediaJob] {
        var jobs = [MediaJob]()
        for photo in library.photos.values where photo.status == "ready" && library.items[photo.itemId] != nil {
            jobs.append(MediaJob(key: photo.cacheKey, url: photo.originalUrl ?? photo.displayUrl, photoID: photo.id, size: photo.byteSize, sha256: photo.sha256))
        }
        for coin in coins where library.photos(for: coin).isEmpty {
            if let address = coin.catalog?.imageUrl, URL(string: address)?.scheme == "https" {
                jobs.append(MediaJob(key: "catalog:" + address, url: address, photoID: nil, size: nil, sha256: nil))
            }
        }
        return jobs
    }
    func coverKey(_ coin: Coin) -> String? {
        pendingCoins.first(where: { $0.id == coin.id })?.photoKeys.first ?? library.photos(for: coin).first?.cacheKey ?? coin.catalog?.imageUrl.map { "catalog:" + $0 }
    }
    func enqueue(_ pending: PendingCoin) async throws {
        guard let account = user?.id, !enqueuing else { throw NumiError.storage }
        guard !pendingCoins.contains(where: { $0.id == pending.id }) else { return }
        let token = revision
        enqueuing = true
        defer { enqueuing = false }
        // Mutate before awaiting the disk actor so concurrent acknowledgements cannot be overwritten.
        pendingCoins.append(pending)
        do { try await disk.savePending(pendingCoins, account: account) }
        catch {
            if current(account, token) { pendingCoins.removeAll { $0.id == pending.id } }
            throw error
        }
        guard current(account, token) else { throw CancellationError() }
        mediaRevision += 1
        Task { await sync() }
    }
    private func sendPending(account: String, token: Int) async throws {
        while let first = pendingCoins.first {
            progress = "Отправка монеты…"
            let remote: Coin
            if let saved = first.remoteCoin { remote = saved }
            else { remote = try await api.create(first) }
            guard current(account, token) else { return }
            guard let index = pendingCoins.firstIndex(where: { $0.id == first.id }) else { continue }
            pendingCoins[index].remoteCoin = remote
            try await disk.savePending(pendingCoins, account: account)
            guard current(account, token) else { return }
            let photos: [CoinPhoto]
            if first.photoKeys.isEmpty { photos = [] }
            else if first.sessionID != nil { photos = try await api.photos(itemID: remote.id) }
            else {
                var uploaded = [CoinPhoto]()
                for (index, key) in first.photoKeys.enumerated() {
                    guard let data = await disk.image(account: account, key: key) else { throw NumiError.storage }
                    uploaded.append(try await api.uploadPhoto(itemID: remote.id, data: data, index: index))
                }
                photos = uploaded
            }
            guard first.photoKeys.isEmpty || photos.count == first.photoKeys.count else { throw NumiError.invalidResponse }
            guard current(account, token) else { return }
            for photo in photos where photo.sortOrder < first.photoKeys.count && photo.sortOrder >= 0 {
                try await disk.copyImage(account: account, from: first.photoKeys[photo.sortOrder], to: photo.cacheKey)
            }
            guard current(account, token) else { return }
            library.items[remote.id] = remote
            for photo in photos { library.photos[photo.id] = photo }
            try await disk.save(library, account: account)
            guard current(account, token) else { return }
            // The remote item is durable before removing its pending record.
            pendingCoins.removeAll { $0.id == first.id }
            try await disk.savePending(pendingCoins, account: account)
            guard current(account, token) else { return }
            mediaRevision += 1
        }
    }
    func loadMarket(_ id: String, refresh: Bool = false) async {
        guard let account = user?.id, library.items[id] != nil, !fixture, !syncing, !loadingMarket.contains(id), refresh || library.markets[id] == nil else { return }
        let token = revision
        loadingMarket.insert(id)
        let itemVersion = library.items[id]?.version
        defer { loadingMarket.remove(id) }
        do {
            let market = try await api.market(itemID: id)
            guard current(account, token), !syncing, library.items[id]?.version == itemVersion else { return }
            library.markets[id] = market
            try await disk.save(library, account: account)
        } catch {
            guard current(account, token) else { return }
            self.error = error.localizedDescription
            if case NumiError.sessionExpired = error { needsLogin = true }
        }
    }
    func updateCoin(_ id: String, input: UpdateCoinInput) async throws {
        guard let account = user?.id, let coin = coins.first(where: { $0.id == id }) else { throw NumiError.storage }
        if let index = pendingCoins.firstIndex(where: { $0.id == id }) {
            pendingCoins[index].input.identifiedYear = input.identifiedYear
            pendingCoins[index].input.userLabel = input.userLabel
            pendingCoins[index].input.gradeCode = input.gradeCode
            pendingCoins[index].input.purchasePriceMinor = input.purchasePriceMinor
            pendingCoins[index].input.purchaseCurrency = input.purchaseCurrency
            pendingCoins[index].input.purchaseDate = input.purchaseDate
            pendingCoins[index].input.purchaseSource = input.purchaseSource
            pendingCoins[index].input.notes = input.notes
            pendingCoins[index].input.properties = input.properties
            pendingCoins[index].coin.identifiedYear = input.identifiedYear
            pendingCoins[index].coin.userLabel = input.userLabel
            pendingCoins[index].coin.gradeCode = input.gradeCode
            pendingCoins[index].coin.purchasePriceMinor = input.purchasePriceMinor
            pendingCoins[index].coin.purchaseCurrency = input.purchaseCurrency
            pendingCoins[index].coin.purchaseDate = input.purchaseDate
            pendingCoins[index].coin.purchaseSource = input.purchaseSource
            pendingCoins[index].coin.notes = input.notes
            pendingCoins[index].coin.properties = input.properties
            try await disk.savePending(pendingCoins, account: account)
        } else {
            let updated = try await api.update(id, version: coin.version, input: input)
            library.items[id] = updated
            try await disk.save(library, account: account)
        }
    }
    func markSold(_ id: String, price: Int64?, date: String?) async throws {
        guard let account = user?.id, let coin = coins.first(where: { $0.id == id }) else { throw NumiError.storage }
        if let index = pendingCoins.firstIndex(where: { $0.id == id }) {
            pendingCoins[index].coin.status = "sold"; pendingCoins[index].coin.soldPriceMinor = price; pendingCoins[index].coin.soldAt = date
            try await disk.savePending(pendingCoins, account: account)
        } else {
            let updated = try await api.markSold(id, version: coin.version, input: SoldCoinInput(soldPriceMinor: price, soldAt: date))
            library.items[id] = updated; try await disk.save(library, account: account)
        }
    }
    func activate(_ id: String) async throws {
        guard let account = user?.id, let coin = coins.first(where: { $0.id == id }) else { throw NumiError.storage }
        if let index = pendingCoins.firstIndex(where: { $0.id == id }) {
            pendingCoins[index].coin.status = "active"; pendingCoins[index].coin.soldPriceMinor = nil; pendingCoins[index].coin.soldAt = nil
            try await disk.savePending(pendingCoins, account: account)
        } else {
            let updated = try await api.activate(id, version: coin.version)
            library.items[id] = updated; try await disk.save(library, account: account)
        }
    }
    func deleteCoin(_ id: String) async throws {
        guard let account = user?.id, let coin = coins.first(where: { $0.id == id }) else { throw NumiError.storage }
        if pendingCoins.contains(where: { $0.id == id }) {
            pendingCoins.removeAll { $0.id == id }; try await disk.savePending(pendingCoins, account: account)
        } else {
            try await api.delete(id, version: coin.version)
            library.items.removeValue(forKey: id)
            library.photos = library.photos.filter { $0.value.itemId != id }
            library.markets.removeValue(forKey: id)
            try await disk.save(library, account: account)
        }
    }
    #if DEBUG
    static func fixtureLibrary() throws -> LibrarySnapshot {
        let json = """
        {"changes":[{"seq":"1","entityKind":"item","entityId":"demo-1","itemId":"demo-1","operation":"upsert","item":{"id":"demo-1","version":1,"typeName":"25 рублей. Камчатская экспедиция","identifiedYear":2004,"gradeCode":"PF","status":"active","catalog":{"country":"Россия","metal":"silver","mintage":1000},"valuation":{"id":"v1","status":"ready","medianMinor":1500000,"lowMinor":1200000,"highMinor":1800000,"currency":"RUB","confidence":0.8,"rangeAvailable":true}}},{"seq":"2","entityKind":"item","entityId":"demo-2","itemId":"demo-2","operation":"upsert","item":{"id":"demo-2","version":1,"typeName":"Монета без оценки","status":"active","catalog":{"country":"Монголия","metal":"silver"}}}],"nextCursor":"fixture","hasMore":false}
        """
        var result = try LibrarySnapshot().applying(JSONDecoder().decode(SyncPage.self, from: Data(json.utf8)))
        result.syncedAt = Date(timeIntervalSince1970: 1789257600)
        return result
    }
    #endif
}
