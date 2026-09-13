import Foundation
import SwiftUI

@MainActor final class NumiModel: ObservableObject {
    @Published private(set) var user: NumiUser?
    @Published private(set) var library = LibrarySnapshot()
    @Published var loading = true
    @Published var signingIn = false
    @Published var syncing = false
    @Published var progress = ""
    @Published var error: String?
    @Published var needsLogin = false
    @Published var mediaRevision = 0
    @Published var loadingMarket: Set<String> = []
    let api: NumiAPI
    let disk: LibraryDisk
    private var bootstrapped = false
    private var revision = 0
    private var fixture = false

    init(api: NumiAPI = NumiAPI(), disk: LibraryDisk = LibraryDisk()) {
        self.api = api; self.disk = disk
    }
    var coins: [Coin] { library.items.values.sorted { ($0.createdAt ?? "", $0.id) > ($1.createdAt ?? "", $1.id) } }
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
                if library.cursor == nil { Task { await sync() } }
            }
        } catch { self.error = error.localizedDescription }
    }
    func signIn(email: String, password: String) async {
        guard !signingIn else { return }
        signingIn = true; error = nil
        defer { signingIn = false }
        do {
            let authenticated = try await api.login(email: email, password: password)
            revision += 1
            syncing = false; progress = ""; loadingMarket = []
            user = authenticated
            library = LibrarySnapshot()
            library = try await disk.load(account: authenticated.id)
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
            loadingMarket = []
        } catch { self.error = error.localizedDescription }
    }
    private func current(_ account: String, _ token: Int) -> Bool { user?.id == account && revision == token }
    func sync() async {
        guard let account = user?.id, !syncing, !fixture else { return }
        let token = revision
        syncing = true; progress = "Синхронизация монет…"; error = nil
        defer { if current(account, token) { syncing = false; progress = "" } }
        do {
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
    func mediaJobs() -> [MediaJob] {
        var jobs = [MediaJob]()
        for photo in library.photos.values where photo.status == "ready" && library.items[photo.itemId] != nil {
            jobs.append(MediaJob(key: photo.cacheKey, url: photo.displayUrl, photoID: photo.id, size: photo.byteSize, sha256: photo.sha256))
        }
        for coin in coins where library.photos(for: coin).isEmpty {
            if let address = coin.catalog?.imageUrl, URL(string: address)?.scheme == "https" {
                jobs.append(MediaJob(key: "catalog:" + address, url: address, photoID: nil, size: nil, sha256: nil))
            }
        }
        return jobs
    }
    func coverKey(_ coin: Coin) -> String? {
        library.photos(for: coin).first?.cacheKey ?? coin.catalog?.imageUrl.map { "catalog:" + $0 }
    }
    func loadMarket(_ id: String, refresh: Bool = false) async {
        guard let account = user?.id, !fixture, !syncing, !loadingMarket.contains(id), refresh || library.markets[id] == nil else { return }
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
