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
    @Published private(set) var sessionLoginPresenter: UUID?
    private var sessionLoginPresenters: [UUID] = []
    @Published var mediaRevision = 0
    @Published var startInCatalog = false
    @Published var startWithAdd = false
    @Published var loadingMarket: Set<String> = []
    @Published var marketErrors: [String: String] = [:]
    @Published var dataBusy = false
    @Published var revaluationBusy = false
    @Published var collectionRevaluation: CollectionRevaluationJob?
    @Published var revaluationError: String?
    @Published var notice: String?
    @Published private(set) var valueHistory = CollectionValueHistory()
    @Published private(set) var loadingValueHistory = false
    @Published var valueHistoryError: String?
    @Published var exportFile: URL?
    @Published private(set) var localToRemote: [String: String] = [:]
    let api: NumiAPI
    let disk: LibraryDisk
    private let mediaTestSession: URLSession?
    private var bootstrapped = false
    private var revision = 0
    private var fixture = false
    private var syncRequested = false
    private var captureActive = false
    private var recognitionRequests = 0
    weak var activeAddCoinDraft: AddCoinModel?
    private var mediaBatchTask: Task<Int, Never>?
    var transferDeferred: Bool { captureActive || recognitionRequests > 0 }
    private var observationFlushAccount: String?
    private let telemetryEnabled: Bool
    private var enqueuing = false
    private var syncWaiters: [CheckedContinuation<Void, Never>] = []
    @Published private(set) var deletingCoinIDs: Set<String> = []
    private var deletedCoinIDs: Set<String> = []
    private var valuationRecoveryTask: Task<Void, Never>?
    private var recoveringValuations = false
    @Published private(set) var calculatingCoinIDs: Set<String> = []
    @Published private(set) var valuationErrors: [String: String] = [:]

    init(api: NumiAPI = NumiAPI(), disk: LibraryDisk = LibraryDisk(), telemetryEnabled: Bool = true, mediaTestSession: URLSession? = nil) {
        self.api = api; self.disk = disk
        self.telemetryEnabled = telemetryEnabled
        self.mediaTestSession = mediaTestSession
    }
    static func forApp() -> NumiModel {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-numi-onboarding-fixture") || arguments.contains("-numi-ui-fixture") || arguments.contains("-numi-store-fixture") {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [OnboardingFixtureProtocol.self]
            let vault = SessionVault(service: "numi-onboarding-ui-" + UUID().uuidString)
            let guestVault = GuestVault(service: "numi-onboarding-guest-ui-" + UUID().uuidString)
            let disk = LibraryDisk(root: FileManager.default.temporaryDirectory.appendingPathComponent("numi-ui-" + UUID().uuidString))
            return NumiModel(api: NumiAPI(session: URLSession(configuration: config), vault: vault, guestVault: guestVault), disk: disk, telemetryEnabled: false)
        }
        #endif
        return NumiModel()
    }
    var coins: [Coin] {
        let shadowed = Set(pendingCoins.compactMap { $0.remoteCoin?.id })
        let hidden = deletingCoinIDs.union(deletingCoinIDs.map { resolvedCoinID($0) }).union(deletedCoinIDs)
        return (pendingCoins.map(\.coin) + library.items.values.filter { !shadowed.contains($0.id) })
            .filter { !hidden.contains($0.id) }
            .sorted { ($0.createdAt ?? "", $0.id) > ($1.createdAt ?? "", $1.id) }
    }
    func activateSessionLoginPresenter(_ id: UUID) {
        sessionLoginPresenters.removeAll { $0 == id }
        sessionLoginPresenters.append(id)
        sessionLoginPresenter = sessionLoginPresenters.last
    }
    func deactivateSessionLoginPresenter(_ id: UUID) {
        sessionLoginPresenters.removeAll { $0 == id }
        sessionLoginPresenter = sessionLoginPresenters.last
    }
    func setCaptureActive(_ active: Bool) {
        captureActive = active
        if active { mediaBatchTask?.cancel() }
        else { resumeDeferredTransfers() }
    }
    func beginRecognition() {
        recognitionRequests += 1
        mediaBatchTask?.cancel()
    }
    func endRecognition() {
        recognitionRequests = max(0, recognitionRequests - 1)
        resumeDeferredTransfers()
    }
    private func resumeDeferredTransfers() {
        guard !transferDeferred else { return }
        if syncRequested && !syncing, let account = user?.id {
            let token = revision
            Task { guard current(account, token) else { return }; await sync() }
        }
        Task { await flushObservations() }
        requestValuationRecovery()
    }
    private func continueSync(_ account: String, _ token: Int) -> Bool {
        guard current(account, token) else { return false }
        if transferDeferred { syncRequested = true; return false }
        return true
    }
    func resolvedCoinID(_ id: String) -> String { localToRemote[id] ?? id }
    func recordForegroundActivity() async {
        guard let account = user?.id, !fixture else { return }
        if await api.requiresAuthentication(account: account) { needsLogin = true; return }
        requestValuationRecovery()
        guard telemetryEnabled else { return }
        do {
            try await disk.queueObservation(.active(account: account), account: account)
            await flushObservations()
        } catch { /* Analytics availability must not block the collection. */ }
    }
    private func flushObservations() async {
        guard let account = user?.id, !fixture, telemetryEnabled, !transferDeferred, observationFlushAccount != account else { return }
        guard !(await api.requiresAuthentication(account: account)) else { return }
        let token = revision
        observationFlushAccount = account
        defer { if observationFlushAccount == account { observationFlushAccount = nil } }
        do {
            while current(account, token) && !transferDeferred {
                let events = Array(try await disk.pendingObservations(account: account).prefix(100))
                guard !transferDeferred else { return }
                if events.isEmpty { return }
                let response = try await api.mobileObservations(MobileObservationBatch(accountId: account, events: events))
                try await disk.acknowledgeObservations(response.acceptedIds, account: account)
                if response.acceptedIds.isEmpty { return }
            }
        } catch { /* Retry the durable queue on foreground and synchronization. */ }
    }
    private func waitForSync() async {
        guard syncing else { return }
        await withCheckedContinuation { syncWaiters.append($0) }
    }
    func bootstrap() async {
        guard !bootstrapped else { return }
        bootstrapped = true
        await api.setAuthenticationRequiredHandler { [weak self] account in
            Task { @MainActor [weak self] in
                guard let self, self.user?.id == account,
                      await self.api.requiresAuthentication(account: account) else { return }
                self.needsLogin = true
                self.error = nil
            }
        }
        defer { loading = false }
        do {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-numi-store-fixture") {
                fixture = true
                user = NumiUser(id: "ui-fixture", email: "demo@example.invalid", displayName: "Коллекционер")
                library = try Self.storeFixtureLibrary()
                valueHistory = Self.fixtureValueHistory()
                try await Self.seedFixturePhotos(disk: disk, account: "ui-fixture")
                mediaRevision += 1
                return
            }
            if ProcessInfo.processInfo.arguments.contains("-numi-ui-fixture") {
                fixture = true
                user = NumiUser(id: "ui-fixture", email: "demo@example.invalid", displayName: "Коллекционер")
                library = try Self.fixtureLibrary()
                if ProcessInfo.processInfo.arguments.contains("-numi-quality-required") {
                    library.items["demo-1"]?.typeId = 42
                    library.items["demo-1"]?.gradeCode = nil
                    library.items["demo-1"]?.valuation = CoinValuation(id: "quality-required",
                        medianMinor: 509500, status: "insufficient_data", abstainReason: "grade_required")
                    library.markets["demo-1"] = MarketEvidence(activity: MarketActivity(), gradeBuckets: [], events: [])
                }
                valueHistory = Self.fixtureValueHistory()
                return
            }
            #endif
            user = try await api.restore()
            if let user {
                needsLogin = await api.requiresAuthentication(account: user.id)
                library = try await disk.load(account: user.id)
                pendingCoins = try await disk.loadPending(account: user.id)
                valueHistory = (try? await disk.loadValueHistory(account: user.id)) ?? CollectionValueHistory()
                Task { await recordForegroundActivity() }
                if library.cursor == nil || !pendingCoins.isEmpty { Task { await sync() } }
            }
        } catch { self.error = error.localizedDescription }
    }
    func startGuest(catalog: Bool = false, add: Bool = false) async {
        error = nil; startInCatalog = catalog; startWithAdd = add
        setCaptureActive(add)
        do {
            let guest = try await api.localGuest()
            user = guest
            library = try await disk.load(account: guest.id)
            pendingCoins = try await disk.loadPending(account: guest.id)
            valueHistory = (try? await disk.loadValueHistory(account: guest.id)) ?? CollectionValueHistory()
            Task { await recordForegroundActivity() }
            Task { await sync() }
        } catch { self.error = error.localizedDescription }
    }
    func signIn(email: String, password: String, action: AccountAction = .login, code: String = "") async {
        guard !signingIn else { return }
        signingIn = true; error = nil
        defer { signingIn = false }
        do {
            let previousAccount = user?.id
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
            valuationRecoveryTask?.cancel(); valuationRecoveryTask = nil
            calculatingCoinIDs = []; valuationErrors = [:]
            mediaBatchTask?.cancel(); syncRequested = false
            let sameAccount = previousAccount == authenticated.id
            if !sameAccount { deletingCoinIDs = []; deletedCoinIDs = []; localToRemote = [:] }
            syncing = false; progress = ""; loadingMarket = []; marketErrors = [:]
            user = authenticated
            collectionRevaluation = nil; revaluationBusy = false; revaluationError = nil
            if !sameAccount {
                library = LibrarySnapshot(); pendingCoins = []
                library = try await disk.load(account: authenticated.id)
                pendingCoins = try await disk.loadPending(account: authenticated.id)
            }
            valueHistory = (try? await disk.loadValueHistory(account: authenticated.id)) ?? CollectionValueHistory()
            valueHistoryError = nil; loadingValueHistory = false
            mediaRevision += 1
            needsLogin = false
            Task { await recordForegroundActivity() }
            Task { await sync() }
        } catch { self.error = error.localizedDescription }
    }
    func signOut() async {
        collectionRevaluation = nil; revaluationBusy = false; revaluationError = nil
        revision += 1
        valuationRecoveryTask?.cancel(); valuationRecoveryTask = nil
        calculatingCoinIDs = []; valuationErrors = [:]
        mediaBatchTask?.cancel(); captureActive = false; recognitionRequests = 0
        valueHistory = CollectionValueHistory(); valueHistoryError = nil; loadingValueHistory = false
        deletingCoinIDs = []; deletedCoinIDs = []
        syncing = false
        localToRemote = [:]
        do {
            try await api.logout()
            user = nil; library = LibrarySnapshot(); error = nil; needsLogin = false
            pendingCoins = []; syncRequested = false
            loadingMarket = []; marketErrors = [:]
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
            mediaBatchTask?.cancel(); captureActive = false; recognitionRequests = 0; syncRequested = false
            valueHistory = CollectionValueHistory(); valueHistoryError = nil; loadingValueHistory = false
            syncing = false; loadingMarket = []; marketErrors = [:]; needsLogin = false
            localToRemote = [:]
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    private func current(_ account: String, _ token: Int) -> Bool { user?.id == account && revision == token }
    func sync(includePhotos: Bool = true) async {
        guard let account = user?.id, !fixture else { return }
        if await api.requiresAuthentication(account: account) { needsLogin = true; syncRequested = false; return }
        guard !transferDeferred else { syncRequested = true; return }
        guard !syncing else { syncRequested = true; return }
        let token = revision
        syncRequested = false
        syncing = true; progress = "Синхронизация монет…"; error = nil
        defer {
            if current(account, token) {
                syncing = false; progress = ""
                requestValuationRecovery()
                if syncRequested && !transferDeferred {
                    syncRequested = false
                    Task { guard current(account, token) else { return }; await sync() }
                }
            }
            let waiters = syncWaiters; syncWaiters.removeAll()
            waiters.forEach { $0.resume() }
        }
        do {
            if user?.guest == true { try await api.ensureGuestSession() }
            guard continueSync(account, token) else { return }
            try await sendPending(account: account, token: token)
            guard continueSync(account, token) else { return }
            var candidate = library
            var resetting = false
            var didReset = false
            repeat {
                guard continueSync(account, token) else { return }
                let page: SyncPage
                do { page = try await api.sync(cursor: candidate.cursor) }
                catch is SyncResetRequired {
                    guard !didReset else { throw NumiError.invalidSync }
                    candidate = LibrarySnapshot(); resetting = true; didReset = true
                    continue
                }
                guard current(account, token) else { return }
                candidate = try candidate.applying(page).removing(deletedCoinIDs)
                // A cursor reset replaces the visible snapshot only after the full new snapshot arrives.
                if !resetting || !page.hasMore {
                    library = candidate
                    // Publish before suspension; a deletion during disk I/O must not be overwritten.
                    try await disk.save(library, account: account)
                    guard current(account, token) else { return }
                }
                progress = "Синхронизация · \(candidate.items.count) монет"
                if !page.hasMore { break }
            } while true
            guard continueSync(account, token) else { return }
            await refreshValueHistory()
            guard continueSync(account, token) else { return }
            guard includePhotos else { return }
            let jobs = mediaJobs()
            let loader = MediaLoader(api: api, disk: disk, testSession: mediaTestSession)
            var failed = 0
            // Four independent transfers overlap while keeping decoding and memory use bounded.
            for offset in stride(from: 0, to: jobs.count, by: 4) {
                guard continueSync(account, token) else { return }
                let batch = Array(jobs[offset..<min(offset + 4, jobs.count)])
                let task = Task {
                    await withTaskGroup(of: Bool.self, returning: Int.self) { group in
                        for job in batch {
                            group.addTask {
                                do {
                                    try await loader.run(job, account: account, admitted: { await self.continueSync(account, token) })
                                    return true
                                } catch { return false }
                            }
                        }
                        var failures = 0
                        for await success in group { if !success { failures += 1 } }
                        return failures
                    }
                }
                mediaBatchTask = task
                failed += await task.value
                mediaBatchTask = nil
                guard continueSync(account, token) else { return }
                mediaRevision += 1
                progress = "Фото · \(min(offset + 4, jobs.count)) из \(jobs.count)"
            }
            guard current(account, token) else { return }
            library.syncedAt = Date()
            try await disk.save(library, account: account)
            Task { await flushObservations() }
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
        let name = CoinName(label: nil, source: nil).selecting(detail.type.name)
        let input = CreateCoinInput(typeId: detail.type.id, issueId: issue?.id,
            identifiedYear: issue?.year ?? detail.type.year, userLabel: name.label,
            identificationRequestId: nil, gradeCode: nil, properties: properties, userLabelSource: name.source)
        let coin = Coin(id: id, version: 0, typeId: detail.type.id, issueId: issue?.id,
            identifiedYear: issue?.year ?? detail.type.year, typeName: detail.type.name,
            userLabel: name.label, identificationStatus: "catalog_selected", gradeCode: nil,
            slabStatus: "unknown", gradingCompanyCode: nil, slabCertificateNumber: nil,
            purchasePriceMinor: nil, purchaseCurrency: nil, purchaseDate: nil,
            purchaseSource: nil, notes: nil, status: "active", soldPriceMinor: nil,
            soldCurrency: nil, soldAt: nil, createdAt: ISO8601DateFormatter().string(from: Date()),
            updatedAt: nil, properties: properties, catalog: snapshot, krauseReference: nil, valuation: nil,
            userLabelSource: name.source)
        _ = account
        try await enqueue(PendingCoin(id: id, input: input, coin: coin, sessionID: nil, photoKeys: []))
    }
    func linkCatalog(_ suppliedID: String, choice: CatalogChoice) async throws {
        guard let account = user?.id else { throw NumiError.sessionExpired }
        let token = revision
        await waitForSync()
        guard current(account, token) else { throw CancellationError() }
        let coinID = resolvedCoinID(suppliedID)
        guard let coin = coins.first(where: { $0.id == coinID }), !deletingCoinIDs.contains(coinID) else { throw NumiError.storage }
        var values = coin.properties?.values ?? [:]
        if values["country"]?.nonempty == nil, let value = choice.country { values["country"] = value }
        if values["year"]?.nonempty == nil, let value = choice.year { values["year"] = String(value) }
        if values["metal"]?.nonempty == nil, let value = choice.metal { values["metal"] = value }
        let properties = CoinProperties(values: values, manualFields: coin.properties?.manualFields ?? [])
        let name = CoinName(label: coin.userLabel, source: coin.userLabelSource).selecting(choice.name)
        if let index = pendingCoins.firstIndex(where: { $0.id == coinID }), pendingCoins[index].remoteCoin == nil {
            let previous = pendingCoins[index]
            pendingCoins[index].input.typeId = choice.id
            pendingCoins[index].input.issueId = nil
            pendingCoins[index].input.identifiedYear = choice.year ?? coin.identifiedYear
            pendingCoins[index].input.userLabel = name.label
            pendingCoins[index].input.userLabelSource = name.source
            pendingCoins[index].input.properties = properties
            pendingCoins[index].coin.typeId = choice.id
            pendingCoins[index].coin.typeName = choice.name
            pendingCoins[index].coin.userLabel = name.label
            pendingCoins[index].coin.userLabelSource = name.source
            pendingCoins[index].coin.identifiedYear = choice.year ?? coin.identifiedYear
            pendingCoins[index].coin.properties = properties
            pendingCoins[index].coin.catalog = CatalogSnapshot(year: choice.year, country: choice.country, metal: choice.metal,
                mintage: choice.mintage, imageUrl: choice.thumb)
            pendingCoins[index].coin.valuation = nil
            do { try await disk.savePending(pendingCoins, account: account) }
            catch { if current(account, token), let idx = pendingCoins.firstIndex(where: { $0.id == coinID }) { pendingCoins[idx] = previous }; throw error }
        } else {
            let remote = pendingCoins.first(where: { $0.id == coinID })?.remoteCoin ?? coin
            var updated = try await api.linkCatalog(remote.id, version: remote.version,
                input: LinkCatalogInput(typeId: choice.id, issueId: nil,
                    identifiedYear: choice.year ?? coin.identifiedYear, properties: properties,
                    userLabel: name.label, userLabelSource: name.source))
            updated.valuation = nil
            guard current(account, token), !deletedCoinIDs.contains(remote.id) else { throw CancellationError() }
            if let index = pendingCoins.firstIndex(where: { $0.id == coinID }) {
                pendingCoins[index].remoteCoin = updated
                pendingCoins[index].input.typeId = updated.typeId
                pendingCoins[index].input.userLabel = updated.userLabel
                pendingCoins[index].input.userLabelSource = updated.userLabelSource
                pendingCoins[index].coin.typeId = updated.typeId
                pendingCoins[index].coin.issueId = updated.issueId
                pendingCoins[index].coin.identifiedYear = updated.identifiedYear
                pendingCoins[index].coin.typeName = updated.typeName
                pendingCoins[index].coin.userLabel = updated.userLabel
                pendingCoins[index].coin.userLabelSource = updated.userLabelSource
                pendingCoins[index].coin.properties = updated.properties
                pendingCoins[index].coin.catalog = updated.catalog
                pendingCoins[index].coin.valuation = updated.valuation
                try await disk.savePending(pendingCoins, account: account)
            }
            library.items[updated.id] = updated
            try await disk.save(library, account: account)
        }
        mediaRevision += 1
        requestValuationRecovery()
    }
    func linkSpecimen(_ coinID: String, choice: SpecimenChoice) async throws {
        guard let account = user?.id else { throw NumiError.sessionExpired }
        let token = revision
        await waitForSync()
        guard current(account, token) else { throw CancellationError() }
        let id = resolvedCoinID(coinID)
        guard let coin = coins.first(where: { $0.id == id }), !deletingCoinIDs.contains(id) else { throw NumiError.storage }
        var values = coin.properties?.values ?? [:]
        let facts = ["country": choice.country, "year": choice.year.map(String.init), "metal": choice.metal,
                     "mass": choice.mass, "subject": choice.subject, "finish": choice.quality]
        for (key, value) in facts where values[key]?.nonempty == nil {
            if !(coin.properties?.manualFields.contains(key) ?? false) { values[key] = value?.nonempty }
        }
        var properties = CoinProperties(values: values, manualFields: coin.properties?.manualFields ?? [])
        if properties.denominationText().isEmpty, let denomination = choice.denomination {
            let parsed = parseCoinDenomination(denomination)
            properties.values["denominationValue"] = parsed.value; properties.values["denominationUnit"] = parsed.unit
        }
        let name = CoinName(label: coin.userLabel, source: coin.userLabelSource).selecting(choice.name)
        let input = LinkCatalogInput(typeId: choice.typeId, issueId: nil,
            identifiedYear: choice.year ?? coin.year, properties: properties, userLabel: name.label, userLabelSource: name.source)
        if let index = pendingCoins.firstIndex(where: { $0.id == id }), pendingCoins[index].remoteCoin == nil {
            let previous = pendingCoins[index]
            pendingCoins[index].input.typeId = input.typeId; pendingCoins[index].input.issueId = nil
            pendingCoins[index].input.identifiedYear = input.identifiedYear; pendingCoins[index].input.userLabel = input.userLabel
            pendingCoins[index].input.userLabelSource = input.userLabelSource
            pendingCoins[index].input.properties = properties; pendingCoins[index].input.identificationEvidence = nil
            pendingCoins[index].coin.typeId = input.typeId; pendingCoins[index].coin.issueId = nil
            pendingCoins[index].coin.typeName = input.typeId == nil ? nil : choice.name
            pendingCoins[index].coin.userLabel = input.userLabel; pendingCoins[index].coin.identifiedYear = input.identifiedYear
            pendingCoins[index].coin.userLabelSource = input.userLabelSource
            pendingCoins[index].coin.properties = properties; pendingCoins[index].coin.valuation = nil
            pendingCoins[index].coin.catalog = choice.catalogChoice.map { CatalogDetail(type: $0, issues: []).snapshot() }
            do { try await disk.savePending(pendingCoins, account: account) }
            catch { if current(account, token), let idx = pendingCoins.firstIndex(where: { $0.id == id }) { pendingCoins[idx] = previous }; throw error }
        } else {
            let remote = pendingCoins.first(where: { $0.id == id })?.remoteCoin ?? coin
            var updated = try await api.linkCatalog(remote.id, version: remote.version, input: input)
            updated.valuation = nil
            guard current(account, token), !deletedCoinIDs.contains(remote.id) else { throw CancellationError() }
            if let index = pendingCoins.firstIndex(where: { $0.id == id }) {
                pendingCoins[index].remoteCoin = updated
                // Keep the local key stable until pending photo delivery completes.
                var localCoin = pendingCoins[index].coin
                localCoin.typeId = updated.typeId; localCoin.typeName = updated.typeName
                localCoin.issueId = updated.issueId; localCoin.identifiedYear = updated.identifiedYear
                localCoin.userLabel = updated.userLabel; localCoin.properties = updated.properties
                localCoin.userLabelSource = updated.userLabelSource
                localCoin.catalog = updated.catalog; localCoin.valuation = updated.valuation
                pendingCoins[index].coin = localCoin
                try await disk.savePending(pendingCoins, account: account)
            }
            library.items[updated.id] = updated; library.markets.removeValue(forKey: updated.id)
            try await disk.save(library, account: account)
        }
        mediaRevision += 1
        requestValuationRecovery()
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
    func recognitionHint(for coinID: String) async -> SavedRecognitionHint? {
        guard let account = user?.id else { return nil }
        let token = revision
        if let pending = pendingCoins.first(where: { $0.id == coinID || $0.remoteCoin?.id == coinID }) {
            return pending.recognitionHint
        }
        let hint = try? await disk.loadRecognitionHint(account: account, coinID: resolvedCoinID(coinID))
        return current(account, token) ? hint : nil
    }
    private func sendPending(account: String, token: Int) async throws {
        while let first = pendingCoins.first(where: { !deletingCoinIDs.contains($0.id) }) {
            guard continueSync(account, token) else { return }
            progress = "Отправка монеты…"
            let remote: Coin
            if let saved = first.remoteCoin { remote = saved }
            else { remote = try await api.create(first) }
            guard current(account, token) else { return }
            guard let index = pendingCoins.firstIndex(where: { $0.id == first.id }) else { continue }
            pendingCoins[index].remoteCoin = remote
            try await disk.savePending(pendingCoins, account: account)
            if let hint = first.recognitionHint {
                try await disk.saveRecognitionHint(hint, account: account, coinID: remote.id)
            }
            if let createdAt = first.coin.createdAt {
                try? await disk.queueObservation(.added(item: remote.id, occurredAt: createdAt), account: account)
            }
            Task { await flushObservations() }
            guard current(account, token) else { return }
            let photos: [CoinPhoto]
            guard continueSync(account, token) else { return }
            if first.photoKeys.isEmpty { photos = [] }
            else if first.sessionID != nil { photos = try await api.photos(itemID: remote.id) }
            else {
                var uploaded = [CoinPhoto]()
                let existing = try await api.photos(itemID: remote.id)
                for (index, key) in first.photoKeys.enumerated() {
                    guard continueSync(account, token) else { return }
                    guard let data = await disk.image(account: account, key: key) else { throw NumiError.storage }
                    guard continueSync(account, token) else { return }
                    if let ready = recoveredUpload(existing, itemID: remote.id, data: data, index: index) {
                        uploaded.append(ready)
                    } else {
                        uploaded.append(try await api.uploadPhoto(itemID: remote.id, data: data, index: index))
                    }
                }
                photos = uploaded
            }
            guard first.photoKeys.isEmpty || photos.count == first.photoKeys.count else { throw NumiError.invalidResponse }
            guard current(account, token) else { return }
            for photo in photos where photo.sortOrder < first.photoKeys.count && photo.sortOrder >= 0 {
                try await disk.copyImage(account: account, from: first.photoKeys[photo.sortOrder], to: photo.cacheKey)
                let originalKey = "original:" + first.photoKeys[photo.sortOrder]
                if await disk.hasImage(account: account, key: originalKey) {
                    try await disk.copyImage(account: account, from: originalKey, to: "original:" + photo.cacheKey)
                }
            }
            guard current(account, token) else { return }
            library.items[remote.id] = remote
            for photo in photos { library.photos[photo.id] = photo }
            try await disk.save(library, account: account)
            guard current(account, token) else { return }
            localToRemote[first.id] = remote.id
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
        marketErrors[id] = nil
        let itemVersion = library.items[id]?.version
        defer { loadingMarket.remove(id) }
        do {
            let market = try await api.market(itemID: id)
            guard current(account, token), !syncing, library.items[id]?.version == itemVersion else { return }
            library.markets[id] = market
            try await disk.save(library, account: account)
            marketErrors[id] = nil
        } catch {
            guard current(account, token) else { return }
            marketErrors[id] = error is CancellationError ? nil : "Не удалось обновить проходы."
            if case NumiError.sessionExpired = error { needsLogin = true }
        }
    }
    func updateCoin(_ suppliedID: String, input: UpdateCoinInput) async throws {
        guard let account = user?.id else { throw NumiError.sessionExpired }
        let token = revision
        await waitForSync()
        guard current(account, token) else { throw CancellationError() }
        let id = resolvedCoinID(suppliedID)
        guard let coin = coins.first(where: { $0.id == id }), !deletingCoinIDs.contains(id) else { throw NumiError.storage }
        let pending = pendingCoins.first(where: { $0.id == id })
        var remoteUpdate: Coin?
        if pending == nil || pending?.remoteCoin != nil {
            let remote = pending?.remoteCoin ?? coin
            remoteUpdate = try await api.update(remote.id, version: remote.version, input: input)
            if let updated = remoteUpdate, !updated.sameValuationInputs(as: coin) { remoteUpdate?.valuation = nil }
            guard current(account, token), !deletedCoinIDs.contains(remote.id) else { throw CancellationError() }
        }
        if let index = pendingCoins.firstIndex(where: { $0.id == id }) {
            let previous = pendingCoins[index]
            pendingCoins[index].input.identifiedYear = input.identifiedYear
            pendingCoins[index].input.userLabel = input.userLabel
            pendingCoins[index].input.userLabelSource = input.userLabelSource
            pendingCoins[index].input.gradeCode = input.gradeCode
            pendingCoins[index].input.purchasePriceMinor = input.purchasePriceMinor
            pendingCoins[index].input.purchaseCurrency = input.purchaseCurrency
            pendingCoins[index].input.purchaseDate = input.purchaseDate
            pendingCoins[index].input.purchaseSource = input.purchaseSource
            pendingCoins[index].input.notes = input.notes
            pendingCoins[index].input.properties = input.properties
            pendingCoins[index].coin.identifiedYear = input.identifiedYear
            pendingCoins[index].coin.userLabel = input.userLabel
            pendingCoins[index].coin.userLabelSource = input.userLabelSource
            pendingCoins[index].coin.gradeCode = input.gradeCode
            pendingCoins[index].coin.purchasePriceMinor = input.purchasePriceMinor
            pendingCoins[index].coin.purchaseCurrency = input.purchaseCurrency
            pendingCoins[index].coin.purchaseDate = input.purchaseDate
            pendingCoins[index].coin.purchaseSource = input.purchaseSource
            pendingCoins[index].coin.notes = input.notes
            pendingCoins[index].coin.properties = input.properties
            if !pendingCoins[index].coin.sameValuationInputs(as: coin) { pendingCoins[index].coin.valuation = nil }
            if let remoteUpdate { pendingCoins[index].remoteCoin = remoteUpdate }
            do { try await disk.savePending(pendingCoins, account: account) }
            catch { if current(account, token), let idx = pendingCoins.firstIndex(where: { $0.id == id }) { pendingCoins[idx] = previous }; throw error }
        }
        if let updated = remoteUpdate {
            library.items[updated.id] = updated
            try await disk.save(library, account: account)
        }
        requestValuationRecovery()
    }
    func recalculateCollection() async { await watchRevaluation(start: true) }
    func refreshValueHistory() async {
        guard let account = user?.id, !fixture, !transferDeferred, !loadingValueHistory else { return }
        let token = revision
        loadingValueHistory = true
        defer { if current(account, token) { loadingValueHistory = false } }
        do {
            try await api.ensureGuestSession()
            guard current(account, token), !transferDeferred else { return }
            let history = try await api.collectionValueHistory().ordered()
            guard current(account, token) else { return }
            try await disk.saveValueHistory(history, account: account)
            guard current(account, token) else { return }
            valueHistory = history; valueHistoryError = nil
        } catch {
            guard current(account, token) else { return }
            valueHistoryError = valueHistory.points.isEmpty ? "Не удалось загрузить историю стоимости. Повторите загрузку при подключении к интернету." : nil
        }
    }
    func resumeCollectionRevaluation() async { await watchRevaluation(start: false) }
    private func watchRevaluation(start: Bool) async {
        guard let account = user?.id, !revaluationBusy else { return }
        let token = revision
        revaluationBusy = true; revaluationError = nil
        defer { if current(account, token) { revaluationBusy = false } }
        do {
            if start {
                await waitForSync()
                await sync(includePhotos: false)
                if let error { throw NumiError.server(error) }
                guard pendingCoins.isEmpty else { throw NumiError.server("Не удалось отправить изменения коллекции.") }
            }
            guard current(account, token) else { return }
            var job = start ? try await api.startCollectionRevaluation(requestID: UUID().uuidString)
                : try await api.collectionRevaluation()
            var lastProcessed = -1
            while current(account, token) {
                collectionRevaluation = job
                if let result = job, result.processed != lastProcessed || !result.running {
                    await waitForSync()
                    await sync(includePhotos: false)
                    if let error { throw NumiError.server(error) }
                    lastProcessed = result.processed
                }
                guard job?.running == true else { break }
                try await Task.sleep(nanoseconds: 1_500_000_000)
                job = try await api.collectionRevaluation()
            }
        } catch is CancellationError { }
        catch { if current(account, token) && (start || collectionRevaluation?.running == true) { revaluationError = error.localizedDescription } }
    }

    private func requestValuationRecovery() {
        guard let account = user?.id, valuationRecoveryTask == nil, !recoveringValuations, !fixture, !transferDeferred, !syncing else { return }
        let token = revision
        valuationRecoveryTask = Task {
            guard current(account, token) else { return }
            await recoverMissingValuations()
            if current(account, token) { valuationRecoveryTask = nil }
        }
    }
    /// Missing results live in the saved collection, so a restart does not lose the work.
    func recoverMissingValuations() async {
        guard let account = user?.id, !fixture, !transferDeferred, !syncing,
              !recoveringValuations else { return }
        let token = revision
        recoveringValuations = true
        defer { recoveringValuations = false }
        guard !(await api.requiresAuthentication(account: account)), current(account, token) else { return }
        for coin in coins where coin.needsInitialValuation {
            guard current(account, token), !transferDeferred,
                  !(await api.requiresAuthentication(account: account)) else { return }
            do { try await recalculateCoin(coin.id) }
            catch is CancellationError { }
            catch { if current(account, token) { valuationErrors[coin.id] = error.localizedDescription } }
        }
    }
    func recalculateCoin(_ id: String) async throws {
        guard let account = user?.id else { throw NumiError.sessionExpired }
        let token = revision
        guard !calculatingCoinIDs.contains(id) else { return }
        calculatingCoinIDs.insert(id); valuationErrors.removeValue(forKey: id)
        defer { if current(account, token) { calculatingCoinIDs.remove(id) } }
        if pendingCoins.contains(where: { $0.id == id && $0.remoteCoin == nil }) {
            if syncing { await waitForSync() } else { await sync() }
        }
        guard current(account, token) else { throw NumiError.sessionExpired }
        let remoteID = resolvedCoinID(id)
        let pending = pendingCoins.first(where: { $0.id == id })
        guard let expected = pending?.remoteCoin ?? library.items[remoteID],
              let specimen = coins.first(where: { $0.id == id || $0.id == remoteID }),
              !deletedCoinIDs.contains(remoteID), !deletingCoinIDs.contains(id) else { throw NumiError.unavailable }
        guard specimen.sameValuationInputs(as: expected) else { throw NumiError.unavailable }
        let valuation = try await api.recalculate(itemID: expected.id)
        guard current(account, token), !deletedCoinIDs.contains(expected.id), !deletingCoinIDs.contains(id),
              let currentCoin = coins.first(where: { $0.id == id || $0.id == remoteID }),
              currentCoin.sameValuationInputs(as: specimen) else { throw CancellationError() }
        if let index = pendingCoins.firstIndex(where: { $0.id == id }) {
            pendingCoins[index].coin.valuation = valuation
            pendingCoins[index].remoteCoin?.valuation = valuation
            try await disk.savePending(pendingCoins, account: account)
        }
        library.items[expected.id]?.valuation = valuation
        try await disk.save(library, account: account)
    }

    func setValuationQuality(_ id: String, grade: String) async throws {
        guard let coin = coins.first(where: { $0.id == resolvedCoinID(id) || $0.id == id }),
              let value = grade.nonempty else { throw NumiError.storage }
        try await updateCoin(id, input: UpdateCoinInput(identifiedYear: coin.identifiedYear,
            userLabel: coin.userLabel, gradeCode: value.uppercased(), purchasePriceMinor: coin.purchasePriceMinor,
            purchaseCurrency: coin.purchaseCurrency, purchaseDate: coin.purchaseDate, purchaseSource: coin.purchaseSource,
            notes: coin.notes, properties: coin.properties ?? CoinProperties(), userLabelSource: coin.userLabelSource))
        try await recalculateCoin(id)
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
        guard let account = user?.id, !deletingCoinIDs.contains(id),
              coins.contains(where: { $0.id == id }) else { throw NumiError.storage }
        let token = revision
        deletingCoinIDs.insert(id)
        defer { if current(account, token) { deletingCoinIDs.remove(id) } }
        // An in-flight create may already have a server ID. Finish it before deleting that ID.
        if pendingCoins.contains(where: { $0.id == id }) { await waitForSync() }
        guard current(account, token) else { throw CancellationError() }
        let remoteID = resolvedCoinID(id)
        let pending = pendingCoins.first(where: { $0.id == id })
        if let remote = pending?.remoteCoin ?? library.items[remoteID] {
            try await api.delete(remote.id, version: remote.version)
            guard current(account, token) else { throw CancellationError() }
            deletedCoinIDs.insert(remote.id)
        }
        deletedCoinIDs.insert(id)
        library = library.removing(deletedCoinIDs)
        try await disk.save(library, account: account)
        guard current(account, token) else { throw CancellationError() }
        let oldPending = pendingCoins
        pendingCoins.removeAll { $0.id == id }
        do { try await disk.savePending(pendingCoins, account: account) }
        catch {
            if current(account, token) {
                pendingCoins = oldPending
                if pending?.remoteCoin == nil && library.items[remoteID] == nil { deletedCoinIDs.remove(id) }
            }
            throw error
        }
        marketErrors.removeValue(forKey: remoteID)
        mediaRevision += 1
    }
    #if DEBUG
    static func fixtureValueHistory() -> CollectionValueHistory {
        CollectionValueHistory(points: [
            CollectionValuePoint(date: "2026-10-12", activeCount: 2, valuedCount: 1, floorOnlyCount: 0, unvaluedCount: 1,
                marketTotalMinor: 1200000, floorOnlyTotalMinor: 0, conservativeTotalMinor: 1200000, capturedAt: "2026-10-12T10:00:00Z"),
            CollectionValuePoint(date: "2026-10-14", activeCount: 2, valuedCount: 1, floorOnlyCount: 0, unvaluedCount: 1,
                marketTotalMinor: 1500000, floorOnlyTotalMinor: 0, conservativeTotalMinor: 1500000, capturedAt: "2026-10-14T10:00:00Z")
        ])
    }
    static func seedFixturePhotos(disk: LibraryDisk, account: String) async throws {
        let photos = [
            ("kamchatka-2003-front", "photo:demo-photo-1:"),
            ("kamchatka-2003-back", "photo:demo-photo-2:"),
            ("somalia-leopard-2019", "photo:demo-photo-3:"),
            ("mongolia-snow-leopard-2017", "photo:demo-photo-4:")
        ]
        for (name, key) in photos {
            guard let url = Bundle.main.url(forResource: name, withExtension: "jpg") ??
                Bundle.main.url(forResource: name, withExtension: "jpg", subdirectory: "ScreenshotPhotos") else { throw NumiError.storage }
            try await disk.storeImage(Data(contentsOf: url), account: account, key: key)
        }
    }
    static func fixtureLibrary() throws -> LibrarySnapshot {
        let json = """
        {"changes":[{"seq":"1","entityKind":"item","entityId":"demo-1","itemId":"demo-1","operation":"upsert","item":{"id":"demo-1","version":1,"typeName":"25 рублей. Камчатская экспедиция","identifiedYear":2004,"gradeCode":"PF","status":"active","catalog":{"country":"Россия","metal":"silver","mintage":1000},"valuation":{"id":"v1","status":"ready","medianMinor":1500000,"lowMinor":1200000,"highMinor":1800000,"currency":"RUB","confidence":0.8,"rangeAvailable":true}}},{"seq":"2","entityKind":"item","entityId":"demo-2","itemId":"demo-2","operation":"upsert","item":{"id":"demo-2","version":1,"typeName":"Монета без оценки","status":"active","catalog":{"country":"Монголия","metal":"silver"}}}],"nextCursor":"fixture","hasMore":false}
        """
        var result = try LibrarySnapshot().applying(JSONDecoder().decode(SyncPage.self, from: Data(json.utf8)))
        result.syncedAt = Date(timeIntervalSince1970: 1789257600)
        return result
    }
    static func storeFixtureLibrary() throws -> LibrarySnapshot {
        let json = """
        {"changes":[
          {"seq":"1","entityKind":"item","entityId":"demo-1","itemId":"demo-1","operation":"upsert","item":{"id":"demo-1","version":1,"typeName":"25 рублей. Первая Камчатская экспедиция","identifiedYear":2003,"gradeCode":"PF","status":"active","createdAt":"2026-09-15T12:00:00Z","catalog":{"year":2003,"country":"Россия","metal":"silver"}}},
          {"seq":"2","entityKind":"item","entityId":"demo-2","itemId":"demo-2","operation":"upsert","item":{"id":"demo-2","version":1,"typeId":847137,"typeName":"1000 шиллингов. Леопард","identifiedYear":2019,"status":"active","createdAt":"2026-09-15T11:00:00Z","catalog":{"year":2019,"country":"Сомали","metal":"gold"}}},
          {"seq":"3","entityKind":"item","entityId":"demo-3","itemId":"demo-3","operation":"upsert","item":{"id":"demo-3","version":1,"typeId":847138,"typeName":"500 тугриков. Снежный барс","identifiedYear":2017,"gradeCode":"PF","status":"active","createdAt":"2026-09-15T10:00:00Z","catalog":{"year":2017,"country":"Монголия","metal":"silver"}}},
          {"seq":"4","entityKind":"photo","entityId":"demo-photo-1","itemId":"demo-1","operation":"upsert","photo":{"id":"demo-photo-1","itemId":"demo-1","side":"obverse","byteSize":491614,"status":"ready","sortOrder":0}},
          {"seq":"5","entityKind":"photo","entityId":"demo-photo-2","itemId":"demo-1","operation":"upsert","photo":{"id":"demo-photo-2","itemId":"demo-1","side":"reverse","byteSize":281872,"status":"ready","sortOrder":1}},
          {"seq":"6","entityKind":"photo","entityId":"demo-photo-3","itemId":"demo-2","operation":"upsert","photo":{"id":"demo-photo-3","itemId":"demo-2","side":"obverse","byteSize":421732,"status":"ready","sortOrder":0}},
          {"seq":"7","entityKind":"photo","entityId":"demo-photo-4","itemId":"demo-3","operation":"upsert","photo":{"id":"demo-photo-4","itemId":"demo-3","side":"obverse","byteSize":418332,"status":"ready","sortOrder":0}}
        ],"nextCursor":"fixture","hasMore":false}
        """
        var result = try LibrarySnapshot().applying(JSONDecoder().decode(SyncPage.self, from: Data(json.utf8)))
        result.syncedAt = Date(timeIntervalSince1970: 1789257600)
        return result
    }
    #endif
}
