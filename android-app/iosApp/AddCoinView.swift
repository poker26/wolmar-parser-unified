import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers
import AVFoundation

struct AddCoinDraft: Codable {
    var id: String
    var photoKeys: [String]
    var selected: CatalogChoice?
    var candidate: IdentificationCandidate?
    var recognition: IdentificationResult?
    var label: String
    var year: String
    var country: String
    var denominationValue: String
    var denominationUnit: String
    var subject: String
    var metal: String
    var fineness: String
    var mass: String
    var massUnit: String
    var finish: String
    var grade: String
    var notes: String
    var denominationText: String? = nil
    var pendingPhotoKey: String?
    var pendingPhotoSource: String?
    var pendingPhotoIndex: Int?
    var identificationFailed: Bool?
}

enum AddCoinStep: Equatable {
    case firstSide, secondSide, readyToIdentify, identifying, identificationFailed, matching
}

@MainActor final class AddCoinModel: ObservableObject {
    @Published var query = ""
    @Published var specimenResults: [SpecimenChoice] = []
    @Published var specimenTotal = 0
    @Published var selected: CatalogChoice?
    @Published var recognition: IdentificationResult?
    @Published var candidate: IdentificationCandidate?
    @Published var images: [Data] = []
    @Published var label = ""
    @Published var year = ""
    @Published var country = ""
    @Published var denominationValue = ""
    @Published var denominationUnit = ""
    @Published var denominationText: String?
    var denominationDisplay: String {
        denominationText ?? CoinProperties(values: ["denominationValue": denominationValue, "denominationUnit": denominationUnit]).denominationText()
    }
    func setDenomination(_ raw: String) {
        let p = parseCoinDenomination(raw)
        denominationValue = p.value; denominationUnit = p.unit; denominationText = raw
    }
    @Published var subject = ""
    @Published var metal = ""
    @Published var fineness = ""
    @Published var mass = ""
    @Published var massUnit = "g"
    @Published var finish = ""
    @Published var grade = ""
    @Published var notes = ""
    @Published var busy = false
    @Published var error: String?
    @Published var phase = ""
    @Published var identifying = false
    @Published var pendingPhoto: Data?
    private var pendingPhotoKey: String?
    var pendingPhotoSource: String?
    var pendingPhotoIndex: Int?
    private var identificationFailed = false
    var step: AddCoinStep {
        if identifying { return .identifying }
        if recognition != nil { return .matching }
        if images.isEmpty { return .firstSide }
        if images.count == 1 { return .secondSide }
        return identificationFailed ? .identificationFailed : .readyToIdentify
    }
    var captureAttemptID: String { saveID }
    private var photoKeys: [String] = []
    private var saveID = UUID().uuidString
    private var draftAccount: String?
    private var restored = false
    private var finished = false
    private var persistTask: Task<Void, Never>?
    let model: NumiModel
    init(model: NumiModel) { self.model = model; draftAccount = model.user?.id }
    func restore() async {
        guard !restored, let account = draftAccount, model.user?.id == account else { return }
        defer { restored = true }
        do {
            guard let draft = try await model.disk.loadAddDraft(account: account) else { return }
            if model.pendingCoins.contains(where: { $0.id == draft.id }) {
                try? await model.disk.clearAddDraft(account: account)
                return
            }
            var photos = [Data]()
            var availableKeys = [String]()
            for key in draft.photoKeys {
                if let photo = await model.disk.image(account: account, key: key) {
                    photos.append(photo); availableKeys.append(key)
                }
            }
            saveID = draft.id; photoKeys = availableKeys; images = photos
            selected = draft.selected; candidate = draft.candidate; recognition = draft.recognition
            label = draft.label; year = draft.year; country = draft.country
            denominationValue = draft.denominationValue; denominationUnit = draft.denominationUnit
            denominationText = draft.denominationText
            subject = draft.subject; metal = draft.metal; fineness = draft.fineness
            mass = draft.mass; massUnit = draft.massUnit; finish = draft.finish
            grade = draft.grade; notes = draft.notes
            pendingPhotoKey = draft.pendingPhotoKey; pendingPhotoSource = draft.pendingPhotoSource
            pendingPhotoIndex = draft.pendingPhotoIndex
            identificationFailed = draft.identificationFailed ?? false
            if let key = pendingPhotoKey { pendingPhoto = await model.disk.image(account: account, key: key) }
            if availableKeys.count != draft.photoKeys.count {
                error = "Часть фотографий не сохранилась. Добавьте их снова."
            }
        } catch { self.error = "Не удалось восстановить сохранённую монету." }
    }
    func schedulePersistence() {
        guard restored, !finished, draftAccount == model.user?.id else { return }
        persistTask?.cancel()
        persistTask = Task {
            try? await Task.sleep(nanoseconds: 100_000_000)
            guard !Task.isCancelled else { return }
            await persist()
        }
    }
    @discardableResult private func persist() async -> Bool {
        guard restored, !finished, let account = draftAccount, model.user?.id == account else { return false }
        let draft = AddCoinDraft(id: saveID, photoKeys: photoKeys, selected: selected, candidate: candidate,
            recognition: recognition, label: label, year: year, country: country,
            denominationValue: denominationValue, denominationUnit: denominationUnit,
            subject: subject, metal: metal, fineness: fineness, mass: mass, massUnit: massUnit,
            finish: finish, grade: grade, notes: notes, denominationText: denominationText, pendingPhotoKey: pendingPhotoKey,
            pendingPhotoSource: pendingPhotoSource, pendingPhotoIndex: pendingPhotoIndex, identificationFailed: identificationFailed)
        do { try await model.disk.saveAddDraft(draft, account: account); return true }
        catch {
            if self.error != "Не удалось сохранить монету на устройстве." {
                self.error = "Не удалось сохранить монету на устройстве."
            }
            return false
        }
    }
    func stagePhoto(_ data: Data, source: String, replacing: Int?) async {
        guard !busy, let account = draftAccount, model.user?.id == account else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let key = "capture:" + UUID().uuidString
            try await model.disk.storeOriginal(data, account: account, key: key)
            pendingPhotoKey = key; pendingPhoto = data; pendingPhotoSource = source; pendingPhotoIndex = replacing
            await persist()
        } catch { self.error = "Не удалось сохранить фотографию. Повторите попытку." }
    }
    func acceptPhoto() async -> Bool {
        guard !busy, let data = pendingPhoto, let account = draftAccount, model.user?.id == account else { return false }
        busy = true; error = nil
        defer { busy = false }
        do {
            let normalized = try await Task.detached(priority: .userInitiated) { try prepareCoinImage(data) }.value
            let key = "draft:" + UUID().uuidString
            try await model.disk.storeOriginal(data, account: account, key: "original:" + key)
            try await model.disk.storeImage(normalized, account: account, key: key)
            let oldImages = images, oldKeys = photoKeys, oldRecognition = recognition
            let oldSelected = selected, oldCandidate = candidate, oldFailed = identificationFailed
            let oldPending = pendingPhotoKey, oldSource = pendingPhotoSource, oldIndex = pendingPhotoIndex
            let index = pendingPhotoIndex ?? images.count
            if let replacement = pendingPhotoIndex, images.indices.contains(replacement) {
                images[replacement] = normalized; photoKeys[replacement] = key
            } else {
                guard images.count < 2 else { return false }
                images.append(normalized); photoKeys.append(key)
            }
            recognition = nil; selected = nil; candidate = nil; identificationFailed = false
            pendingPhoto = nil; pendingPhotoKey = nil; pendingPhotoSource = nil; pendingPhotoIndex = nil
            guard await persist() else {
                images = oldImages; photoKeys = oldKeys; recognition = oldRecognition
                selected = oldSelected; candidate = oldCandidate; identificationFailed = oldFailed
                pendingPhoto = data; pendingPhotoKey = oldPending; pendingPhotoSource = oldSource; pendingPhotoIndex = oldIndex
                return false
            }
            CaptureEventRecorder.record("side_accepted", attempt: saveID, side: index, source: oldSource ?? "camera")
            return true
        } catch { self.error = "Не удалось сохранить фотографию. Повторите попытку."; return false }
    }
    func discard() async {
        guard let account = draftAccount else { return }
        finished = true; persistTask?.cancel()
        try? await model.disk.clearAddDraft(account: account)
    }
    func keepDraft() async -> Bool { await persist() }
    var hasIdentity: Bool { selected != nil || candidate != nil || label.nonempty != nil }
    var hasChanges: Bool {
        !images.isEmpty || hasIdentity || [year, country, denominationValue, denominationUnit, subject,
            metal, fineness, mass, finish, grade, notes].contains { $0.nonempty != nil }
    }
    func choose(_ choice: CatalogChoice) {
        selected = choice; candidate = nil; label = ""
        if year.nonempty == nil { year = choice.year.map(String.init) ?? "" }
        if country.nonempty == nil { country = choice.country ?? "" }
        if metal.nonempty == nil { metal = choice.metal ?? "" }
        if denominationDisplay.isEmpty, let value = choice.denomination { setDenomination(value) }
        if mass.nonempty == nil { mass = choice.mass ?? "" }
        if subject.nonempty == nil { subject = choice.subject ?? "" }
        if finish.nonempty == nil { finish = choice.quality ?? "" }
        specimenResults = []; specimenTotal = 0; query = ""; error = nil
    }
    func choose(_ choice: IdentificationCandidate) {
        candidate = choice; selected = nil; label = ""
        if year.nonempty == nil { year = (choice.issueYear ?? recognition?.extracted.year ?? choice.year).map(String.init) ?? "" }
        if country.nonempty == nil { country = choice.country ?? recognition?.extracted.country ?? "" }
        if denominationDisplay.isEmpty, let value = choice.denomination?.nonempty { setDenomination(value) }
        error = nil
    }
    func search(more: Bool = false) async {
        guard !busy, [query, country, year, denominationValue, metal].contains(where: { $0.nonempty != nil }) else { return }
        busy = true; phase = "Ищем монету…"; error = nil
        defer { busy = false }
        do {
            let denomination = denominationDisplay
            let page = try await model.api.searchSpecimens(query: query, country: country,
                year: year, denomination: denomination, metal: metal,
                offset: more ? specimenResults.count : 0)
            specimenResults = more ? specimenResults + page.items : page.items
            specimenTotal = page.total
        }
        catch { self.error = error.localizedDescription }
    }
    func choose(_ choice: SpecimenChoice) {
        if let typeID = choice.typeId {
            var catalog = CatalogChoice(id: typeID, name: choice.name)
            catalog.year = choice.year; catalog.country = choice.country; catalog.metal = choice.metal
            catalog.thumb = choice.thumb; catalog.denomination = choice.denomination
            catalog.mass = choice.mass; catalog.subject = choice.subject; catalog.quality = choice.quality
            choose(catalog)
        } else {
            selected = nil; candidate = nil; label = choice.name
            if country.nonempty == nil { country = choice.country ?? "" }
            if year.nonempty == nil, let value = choice.year, (1000...2200).contains(value) { year = String(value) }
            if denominationText == nil, denominationValue.nonempty == nil, let value = choice.denomination {
                let parsed = parseCoinDenomination(value)
                denominationValue = parsed.value
                if denominationUnit.nonempty == nil { denominationUnit = parsed.unit }
            }
            if subject.nonempty == nil { subject = choice.subject ?? "" }
            if metal.nonempty == nil { metal = choice.metal ?? "" }
            if mass.nonempty == nil { mass = choice.mass ?? "" }
        }
        specimenResults = []; specimenTotal = 0; query = ""; error = nil
    }
    func addImages(_ values: [Data]) async {
        guard !busy, recognition == nil else { return }
        busy = true; phase = "Подготовка фото…"; error = nil
        defer { busy = false }
        do {
            guard let account = draftAccount, model.user?.id == account else { throw NumiError.sessionExpired }
            for data in values.prefix(2 - images.count) {
                let normalized = try await Task.detached(priority: .userInitiated) { try prepareCoinImage(data) }.value
                let key = "draft:" + UUID().uuidString
                try await model.disk.storeOriginal(data, account: account, key: "original:" + key)
                try await model.disk.storeImage(normalized, account: account, key: key)
                images.append(normalized); photoKeys.append(key)
            }
            await persist()
        } catch { self.error = error.localizedDescription }
    }
    func removePhoto(_ index: Int) {
        images.remove(at: index); photoKeys.remove(at: index)
        recognition = nil; selected = nil; candidate = nil; identificationFailed = false
        Task { await persist() }
    }
    // Called only after the system camera/review has dismissed. This also resumes
    // an interrupted request from a durable two-photo draft, but never loops on failure.
    func continueAfterCapture() async {
        guard pendingPhoto == nil, step == .readyToIdentify, !finished else { return }
        await identify()
    }
    func identify() async {
        guard images.count == 2, !busy, recognition == nil else { return }
        busy = true; identifying = true; phase = "Определяем монету"; error = nil
        model.beginRecognition()
        defer { busy = false; identifying = false; model.endRecognition() }
        do {
            let response = try await model.api.identify(images)
            if let timing = await model.api.lastRecognitionTiming, let account = draftAccount {
                try? await model.disk.saveRecognitionTiming(timing, account: account)
            }
            guard response.identificationSessionId != nil else { throw NumiError.invalidResponse }
            recognition = response; selected = nil; candidate = nil; identificationFailed = false
            if label.nonempty == nil, response.candidates.isEmpty {
                label = response.recognizedName.map { String($0.prefix(200)) } ?? ""
            }
            if year.nonempty == nil { year = response.extracted.year.map(String.init) ?? "" }
            if country.nonempty == nil { country = response.extracted.country ?? "" }
            if denominationText == nil, denominationValue.nonempty == nil { denominationValue = response.extracted.denominationValue ?? "" }
            if denominationText == nil, denominationUnit.nonempty == nil { denominationUnit = response.extracted.denominationUnit ?? "" }
            if metal.nonempty == nil { metal = response.extracted.metal ?? "" }
            if grade.nonempty == nil, response.extracted.gradeSource == "slab_label" { grade = response.extracted.gradeCode ?? "" }
            await persist()
        } catch {
            identificationFailed = true
            if let timing = await model.api.lastRecognitionTiming, let account = draftAccount {
                try? await model.disk.saveRecognitionTiming(timing, account: account)
            }
            await persist()
            self.error = "Монета сохранена на устройстве. Повторите распознавание или заполните известные сведения."
        }
    }
    func save() async -> Bool {
        guard !busy else { return false }
        busy = true; phase = "Сохранение на устройстве…"; error = nil
        defer { busy = false }
        do {
            guard draftAccount == model.user?.id else { throw NumiError.sessionExpired }
            try await model.enqueue(makePending())
            if identificationFailed && selected == nil && candidate == nil {
                CaptureEventRecorder.record("manual_after_failure", attempt: saveID, side: -1, source: "manual")
            }
            finished = true; persistTask?.cancel()
            if let account = draftAccount { try? await model.disk.clearAddDraft(account: account) }
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func saveWithoutMatch() async -> Bool {
        let oldSelected = selected, oldCandidate = candidate
        selected = nil; candidate = nil
        if await save() { return true }
        selected = oldSelected; candidate = oldCandidate
        return false
    }
    func makePending() throws -> PendingCoin {
        let yearText = year.trimmingCharacters(in: .whitespacesAndNewlines)
        let parsedYear = Int(yearText)
        guard yearText.isEmpty || parsedYear.map({ (1000...2200).contains($0) }) == true else { throw NumiError.server("Проверьте год монеты.") }
        guard grade.count <= 20, label.count <= 200, notes.count <= 5000 else { throw NumiError.server("Проверьте длину названия, состояния и заметки.") }
        guard parseCoinDenomination(denominationDisplay).valid else { throw NumiError.server("Проверьте номинал.") }
        try validateDecimal(mass, message: "Проверьте массу.")
        try validateDecimal(fineness, maximum: 1000, message: "Проверьте пробу.")
        let typeID = selected?.id ?? candidate?.id
        let manualValues = [
            "country": country, "year": year, "denominationValue": denominationValue,
            "denominationUnit": denominationUnit, "subject": subject, "metal": metal,
            "fineness": fineness, "mass": mass, "massUnit": mass.isEmpty ? "" : massUnit,
            "finish": finish
        ].mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.value.isEmpty }
        let original = CoinProperties(values: manualValues, manualFields: Array(manualValues.keys))
        let properties = denominationText != nil || !denominationDisplay.isEmpty ? original.editingDenomination(denominationDisplay) : original
        let fallbackLabel = label.nonempty ?? recognition?.recognizedName?.nonempty ?? "Нераспознанная монета"
        var input = CreateCoinInput(typeId: typeID,
            issueId: candidate?.issueYear == parsedYear ? candidate?.issueId : nil,
            identifiedYear: parsedYear, userLabel: typeID == nil ? fallbackLabel : nil,
            identificationRequestId: recognition?.requestId, gradeCode: grade.nonempty?.uppercased(),
            notes: notes.nonempty, properties: properties)
        input.gradeSource = input.gradeCode == nil ? "unknown" : "user"
        if let response = recognition {
            input.slabStatus = response.extracted.slabStatus ?? "unknown"
            input.gradingCompanyCode = response.extracted.gradingCompanyCode
            input.slabCertificateNumber = response.extracted.slabCertificateNumber
            if let typeID, response.candidates.contains(where: { $0.id == typeID }) {
                input.identificationEvidence = IdentificationEvidence(catalogMatch: response.catalogMatch,
                    proposedTypeIds: response.candidates.map(\.id), decision: response.candidates.first?.id == typeID ? "accepted_top" : "selected_alternative",
                    recognizedName: response.recognizedName.map { String($0.prefix(200)) }, extracted: response.extracted)
            }
        }
        var coin = Coin(id: saveID, version: 0, typeId: typeID, identifiedYear: parsedYear,
            typeName: selected?.name ?? candidate?.name, userLabel: input.userLabel, gradeCode: input.gradeCode,
            notes: input.notes, status: "active", createdAt: ISO8601DateFormatter().string(from: Date()), properties: properties)
        if let selected {
            coin.catalog = CatalogDetail(type: selected, issues: []).snapshot()
        }
        return PendingCoin(id: saveID, input: input, coin: coin,
                           sessionID: recognition?.identificationSessionId, photoKeys: photoKeys)
    }
    private func validateDecimal(_ value: String, maximum: Decimal? = nil, message: String) throws {
        guard let text = value.nonempty else { return }
        guard let number = Decimal(string: text.replacingOccurrences(of: ",", with: "."), locale: Locale(identifier: "en_US_POSIX")),
              number > 0, maximum.map({ number <= $0 }) ?? true else { throw NumiError.server(message) }
    }
}

struct AddCoinView: View {
    @StateObject private var draft: AddCoinModel
    @Environment(\.dismiss) private var dismiss
    @State private var picker: CoinPickerSource?
    @State private var replacingPhoto: Int?
    @State private var searching = false
    @State private var manualEditing = false
    init(model: NumiModel) { _draft = StateObject(wrappedValue: AddCoinModel(model: model)) }
    private var matching: Bool { draft.recognition != nil && !manualEditing }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if !manualEditing && !matching { captureHeading }
                    if !draft.images.isEmpty || (!manualEditing && !matching) { photoStrip }
                    if manualEditing { manualProperties }
                    else if let recognition = draft.recognition {
                        if let name = recognition.recognizedName {
                            Text(name).font(.system(size: 27, design: .serif))
                        }
                        ForEach(recognition.candidates) { candidate in
                            Button { draft.choose(candidate) } label: {
                                HStack(spacing: 14) {
                                    Image(systemName: draft.candidate?.id == candidate.id ? "checkmark.circle.fill" : "circle")
                                        .foregroundColor(Cabinet.copper)
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(candidate.name)
                                        Text([candidate.year.map(String.init), candidate.country]
                                            .compactMap { $0 }.joined(separator: " · "))
                                            .font(.caption).foregroundColor(Cabinet.muted)
                                    }
                                    Spacer(minLength: 0)
                                }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
                            }.buttonStyle(.plain).accessibilityIdentifier("add.candidate.\(candidate.id)")
                                .accessibilityValue(draft.candidate?.id == candidate.id ? "selected" : "unselected")
                        }
                        Button("Найти другой вариант") { searching = true }.accessibilityIdentifier("add.find")
                        Button("Указать свойства вручную") { openManual() }.accessibilityIdentifier("add.manual")
                    } else {
                        if draft.images.count < 2 {
                            Button { picker = .library } label: { Label("Выбрать фото", systemImage: "photo") }
                                .accessibilityIdentifier("add.photos")
                        }
                        Button("Найти в каталоге") { searching = true }.accessibilityIdentifier("add.find")
                        Button("Указать свойства вручную") { openManual() }.accessibilityIdentifier("add.manual")
                        if draft.step == .identificationFailed {
                            Button("Сохранить без определения") { Task { if await draft.saveWithoutMatch() { dismiss() } } }
                                .accessibilityIdentifier("add.saveUnidentified")
                        }
                    }
                    if draft.busy && !draft.identifying { HStack { ProgressView(); Text(draft.phase) } }
                    if let error = draft.error { Text(error).foregroundColor(.orange).accessibilityIdentifier("add.error") }
                }.padding(22).frame(maxWidth: 760).frame(maxWidth: .infinity).disabled(draft.busy)
            }.background(Cabinet.background.ignoresSafeArea())
                .navigationTitle(manualEditing ? "Сведения о монете" : matching ? "Выберите монету" : "Добавить монету")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) {
                    Button("Назад") {
                        if manualEditing { manualEditing = false }
                        else { Task {
                            if !draft.hasChanges { dismiss() }
                            else if await draft.keepDraft() { dismiss() }
                        } }
                    }.disabled(draft.busy).accessibilityIdentifier("add.back")
                } }
                .safeAreaInset(edge: .bottom) {
                    Button(action: primaryAction) {
                        Text(primaryTitle)
                            .fontWeight(.semibold).frame(maxWidth: .infinity).padding(18)
                    }.background(primaryDisabled ? Cabinet.panel : Cabinet.copper)
                        .foregroundColor(primaryDisabled ? Cabinet.muted : Cabinet.background).cornerRadius(18)
                        .disabled(primaryDisabled).accessibilityIdentifier(primaryIdentifier)
                        .padding(16).frame(maxWidth: 760).frame(maxWidth: .infinity).background(Cabinet.background)
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
            .interactiveDismissDisabled(draft.hasChanges || draft.busy)
            .fullScreenCover(isPresented: $searching) {
                SpecimenSearchView(api: draft.model.api, query: draft.subject, country: draft.country,
                    year: draft.year, denomination: draft.denominationDisplay, metal: draft.metal,
                    confirm: { choice in
                        draft.choose(choice)
                        guard await draft.save() else { throw NumiError.server(draft.error ?? "Не удалось сохранить монету.") }
                    }, onSaved: { searching = false; dismiss() })
            }
            .fullScreenCover(isPresented: $draft.identifying) { RecognitionWaitingView(images: draft.images) }
            .task {
                await draft.restore()
                if draft.pendingPhoto != nil {
                    replacingPhoto = draft.pendingPhotoIndex
                    picker = draft.pendingPhotoSource == "gallery" ? .library : .camera
                }
                else { await draft.continueAfterCapture() }
            }
            .onReceive(draft.objectWillChange) { _ in draft.schedulePersistence() }
            .fullScreenCover(item: $picker, onDismiss: {
                Task { await draft.continueAfterCapture() }
            }) { source in
                CoinCaptureFlow(draft: draft, source: source, replacing: replacingPhoto) { picker = nil; replacingPhoto = nil }
            }
    }
    private var primaryTitle: String {
        if manualEditing { return "Сохранить" }
        if matching { return draft.recognition?.candidates.isEmpty == true ? "Найти в каталоге" : "Это моя монета" }
        switch draft.step {
        case .firstSide: return "Снять одну сторону"
        case .secondSide: return "Снять другую сторону"
        case .identificationFailed: return "Повторить определение"
        default: return "Определить монету"
        }
    }
    private var primaryIdentifier: String {
        if manualEditing { return "add.save" }
        if matching { return draft.recognition?.candidates.isEmpty == true ? "add.findPrimary" : "add.confirm" }
        return draft.images.count < 2 ? "add.camera" : "add.identify"
    }
    private var primaryDisabled: Bool {
        draft.busy || (manualEditing && !draft.hasChanges) ||
            (matching && draft.recognition?.candidates.isEmpty == false && draft.candidate == nil && draft.selected == nil)
    }
    private func primaryAction() {
        if manualEditing || (matching && draft.recognition?.candidates.isEmpty == false) {
            Task { if await draft.save() { dismiss() } }
        } else if matching { searching = true }
        else if draft.images.count < 2 { requestCamera() }
        else { Task { await draft.identify() } }
    }
    private var captureHeading: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                ForEach(0..<3) { index in
                    Capsule().fill(index <= draft.images.count ? Cabinet.copper : Cabinet.panel).frame(height: 4)
                }
            }
            Text(draft.images.isEmpty ? "Сфотографируйте одну сторону" : draft.images.count == 1 ?
                 "Теперь другую сторону" : draft.step == .identificationFailed ? "Не удалось определить монету" : "Фотографии готовы")
                .font(.system(size: 32, design: .serif)).accessibilityIdentifier("add.captureHeading")
        }.padding(.bottom, 8)
    }
    private func openManual() {
        if draft.label.isEmpty { draft.label = draft.recognition?.recognizedName ?? draft.selected?.name ?? draft.candidate?.name ?? "" }
        draft.selected = nil; draft.candidate = nil; manualEditing = true
    }
    private var manualProperties: some View {
        VStack(spacing: 16) {
            manualField("Название", text: $draft.label, id: "add.label")
            manualField("Страна", text: $draft.country, id: "add.country")
            manualField("Номинал", text: Binding(get: { draft.denominationDisplay }, set: draft.setDenomination), id: "add.denomination.value")
            manualField("Год", text: $draft.year, id: "add.year", keyboard: .numberPad)
            manualField("Сюжет", text: $draft.subject, id: "add.subject")
            manualField("Металл", text: $draft.metal, id: "add.metal")
            HStack {
                manualField("Проба, ‰", text: $draft.fineness, id: "add.fineness", keyboard: .decimalPad)
                manualField("Масса", text: $draft.mass, id: "add.mass", keyboard: .decimalPad)
            }
            Picker("Единица массы", selection: $draft.massUnit) { Text("г").tag("g"); Text("тр. унц.").tag("troy_oz") }
                .pickerStyle(.segmented)
            manualField("Исполнение", text: $draft.finish, id: "add.finish")
            manualField("Состояние или грейд", text: $draft.grade, id: "add.grade")
            manualField("Заметка", text: $draft.notes, id: "add.notes")
        }.cabinetPanel()
    }
    private var photoStrip: some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(0..<(manualEditing || matching ? draft.images.count : 2), id: \.self) { index in
                VStack {
                    if draft.images.indices.contains(index), let image = UIImage(data: draft.images[index]) {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: matching || manualEditing ? 220 : 300).cornerRadius(14)
                            .accessibilityIdentifier("add.photo.\(index)")
                        if !matching {
                            Button("Переснять") { replacingPhoto = index; requestCamera() }.font(.caption)
                                .accessibilityIdentifier("add.retake.\(index)")
                            Button("Выбрать другое") { replacingPhoto = index; picker = .library }.font(.caption)
                        }
                    } else {
                        RoundedRectangle(cornerRadius: 14).fill(Cabinet.panel).aspectRatio(1, contentMode: .fit)
                            .overlay(Image(systemName: "camera").font(.largeTitle).foregroundColor(Cabinet.muted))
                    }
                }.frame(maxWidth: .infinity)
            }
        }
    }
    private func manualField(_ title: String, text: Binding<String>, id: String, keyboard: UIKeyboardType = .default) -> some View {
        TextField(title, text: text).keyboardType(keyboard).accessibilityIdentifier(id)
            .padding(.vertical, 8).overlay(alignment: .bottom) { Divider() }
    }
    private func requestCamera() {
        #if DEBUG
        if CaptureFixture.enabled { picker = .camera; return }
        #endif
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else { draft.error = "Камера недоступна. Выберите фотографии."; return }
        Task {
            let allowed = await AVCaptureDevice.requestAccess(for: .video)
            if allowed { picker = .camera }
            else { draft.error = "Разрешите доступ к камере в настройках устройства или выберите фотографии." }
        }
    }
}

private struct RecognitionWaitingView: View {
    let images: [Data]
    @State private var card = 0
    private let cards = [
        ("История продаж", "Сравнивайте реальные продажи монеты на разных аукционах.", "chart.line.uptrend.xyaxis"),
        ("Найдите свой выпуск", "Ищите в каталоге по стране, году и номиналу.", "book.closed"),
        ("Коллекция с собой", "Рассматривайте сохранённые монеты и фотографии без интернета.", "square.grid.2x2")
    ]
    var body: some View {
        ZStack {
            Cabinet.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 24) {
                    Text("Нуми").font(.title2.weight(.semibold)).foregroundColor(Cabinet.copper)
                    Text("Определяем монету").font(.system(size: 32, design: .serif))
                    ZStack {
                        Circle().stroke(Cabinet.copper.opacity(0.22), lineWidth: 2).frame(width: 300, height: 300)
                        ProgressView().scaleEffect(1.7).tint(Cabinet.copper)
                        if let data = images.first, let image = UIImage(data: data) {
                            Image(uiImage: image).resizable().scaledToFit().frame(width: 238, height: 238).clipShape(RoundedRectangle(cornerRadius: 28))
                        }
                    }
                    let item = cards[card]
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Image(systemName: item.2).foregroundColor(Cabinet.copper); Spacer(); Text("\(card + 1) / \(cards.count)").foregroundColor(Cabinet.muted) }
                        Text(item.0).font(.title3.weight(.semibold))
                        Text(item.1).foregroundColor(Cabinet.muted)
                        HStack {
                            Spacer()
                            Button { card = (card + cards.count - 1) % cards.count } label: { Image(systemName: "chevron.left") }
                            Button { card = (card + 1) % cards.count } label: { Image(systemName: "chevron.right") }
                        }
                    }.cabinetPanel()
                }.padding(24)
            }
        }.preferredColorScheme(.dark).tint(Cabinet.copper)
            .task {
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 12_000_000_000)
                    if !Task.isCancelled { card = (card + 1) % cards.count }
                }
            }
    }
}

enum CoinPickerSource: String, Identifiable { case camera, library; var id: String { rawValue } }
func prepareCoinImage(_ data: Data) throws -> Data {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
          let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2000] as CFDictionary) else { throw NumiError.corruptPhoto }
    let output = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw NumiError.storage }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw NumiError.storage }
    return output as Data
}
struct CoinPhotoPicker: UIViewControllerRepresentable {
    let count: Int; let completion: ([Data], String?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(completion) }
    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(); config.filter = .images; config.selectionLimit = count
        let picker = PHPickerViewController(configuration: config); picker.delegate = context.coordinator; return picker
    }
    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) { }
    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let completion: ([Data], String?) -> Void
        init(_ completion: @escaping ([Data], String?) -> Void) { self.completion = completion }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            Task { @MainActor in
                var photos: [Data] = []
                for result in results {
                    let data: Data? = await withCheckedContinuation { continuation in
                        result.itemProvider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in continuation.resume(returning: data) }
                    }
                    guard let data else { completion([], "Не удалось прочитать фотографию. Выберите её ещё раз."); return }
                    photos.append(data)
                }
                completion(photos, nil)
            }
        }
    }
}
struct CoinCamera: UIViewControllerRepresentable {
    let completion: (Data?) -> Void
    static let sourceType: UIImagePickerController.SourceType = .camera

    func makeCoordinator() -> Coordinator { Coordinator(completion: completion) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = Self.makePicker()
        picker.delegate = context.coordinator
        return picker
    }
    static func makePicker() -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.allowsEditing = false
        picker.modalPresentationStyle = .fullScreen
        // Simulators have no camera. The production entry point checks availability.
        if UIImagePickerController.isSourceTypeAvailable(sourceType) {
            picker.sourceType = sourceType
            picker.cameraCaptureMode = .photo
            picker.showsCameraControls = true
        }
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) { }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let completion: (Data?) -> Void
        private var completed = false
        init(completion: @escaping (Data?) -> Void) { self.completion = completion }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finish(nil) }
        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let url = info[.imageURL] as? URL, let data = try? Data(contentsOf: url), !data.isEmpty {
                finish(data)
            } else {
                finish((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.98))
            }
        }
        private func finish(_ data: Data?) {
            guard !completed else { return }
            completed = true
            completion(data)
        }
    }
}
