import SwiftUI
import PhotosUI
import ImageIO
import UniformTypeIdentifiers
import AVFoundation

@MainActor final class AddCoinModel: ObservableObject {
    @Published var query = ""
    @Published var results: [CatalogChoice] = []
    @Published var selected: CatalogChoice?
    @Published var recognition: IdentificationResult?
    @Published var candidate: IdentificationCandidate?
    @Published var images: [Data] = []
    @Published var label = ""
    @Published var year = ""
    @Published var country = ""
    @Published var denominationValue = ""
    @Published var denominationUnit = ""
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
    private var photoKeys: [String] = []
    private var saveID = UUID().uuidString
    private var preparedPending: PendingCoin?
    private var draftAccount: String?
    let model: NumiModel
    init(model: NumiModel) { self.model = model; draftAccount = model.user?.id }
    var hasIdentity: Bool { selected != nil || candidate != nil || label.nonempty != nil }
    var hasChanges: Bool {
        !images.isEmpty || hasIdentity || [year, country, denominationValue, denominationUnit, subject,
            metal, fineness, mass, finish, grade, notes].contains { $0.nonempty != nil }
    }
    func choose(_ choice: CatalogChoice) {
        selected = choice; candidate = nil; label = ""; year = choice.year.map(String.init) ?? ""
        country = choice.country ?? country; metal = choice.metal ?? metal
        results = []; query = ""; error = nil
    }
    func choose(_ choice: IdentificationCandidate) {
        candidate = choice; selected = nil; label = ""
        year = (choice.issueYear ?? recognition?.extracted.year ?? choice.year).map(String.init) ?? ""
        country = choice.country ?? recognition?.extracted.country ?? country
        if let denomination = choice.denomination?.nonempty { denominationUnit = denomination }
        error = nil
    }
    func search() async {
        guard !busy, query.nonempty != nil else { return }
        busy = true; phase = "Поиск в каталоге…"; error = nil
        defer { busy = false }
        do { results = try await model.api.searchCatalog(query) }
        catch { self.error = error.localizedDescription }
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
                try await model.disk.storeImage(normalized, account: account, key: key)
                images.append(normalized); photoKeys.append(key)
            }
        } catch { self.error = error.localizedDescription }
    }
    func removePhoto(_ index: Int) { images.remove(at: index); photoKeys.remove(at: index) }
    func identify() async {
        guard images.count == 2, !busy, recognition == nil else { return }
        busy = true; identifying = true; phase = "Определяем монету"; error = nil
        defer { busy = false; identifying = false }
        do {
            let response = try await model.api.identify(images)
            guard response.identificationSessionId != nil else { throw NumiError.invalidResponse }
            recognition = response; selected = nil; candidate = nil; label = ""
            if response.candidates.isEmpty { label = response.recognizedName.map { String($0.prefix(200)) } ?? "" }
            year = response.extracted.year.map(String.init) ?? ""
            country = response.extracted.country ?? ""
            denominationValue = response.extracted.denominationValue ?? ""
            denominationUnit = response.extracted.denominationUnit ?? ""
            metal = response.extracted.metal ?? ""
            if response.extracted.gradeSource == "slab_label" { grade = response.extracted.gradeCode ?? "" }
        } catch {
            self.error = "Монета сохранена на устройстве. Повторите распознавание или заполните известные сведения."
        }
    }
    func save() async -> Bool {
        guard !busy else { return false }
        busy = true; phase = "Сохранение на устройстве…"; error = nil
        defer { busy = false }
        do {
            guard draftAccount == model.user?.id else { throw NumiError.sessionExpired }
            if preparedPending == nil { preparedPending = try makePending() }
            try await model.enqueue(preparedPending!)
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
    func makePending() throws -> PendingCoin {
        let yearText = year.trimmingCharacters(in: .whitespacesAndNewlines)
        let parsedYear = Int(yearText)
        guard yearText.isEmpty || parsedYear.map({ (1000...2200).contains($0) }) == true else { throw NumiError.server("Проверьте год монеты.") }
        guard grade.count <= 20, label.count <= 200, notes.count <= 5000 else { throw NumiError.server("Проверьте длину названия, состояния и заметки.") }
        try validateDecimal(denominationValue, message: "Проверьте номинал.")
        try validateDecimal(mass, message: "Проверьте массу.")
        try validateDecimal(fineness, maximum: 1000, message: "Проверьте пробу.")
        let typeID = selected?.id ?? candidate?.id
        let manualValues = [
            "country": country, "year": year, "denominationValue": denominationValue,
            "denominationUnit": denominationUnit, "subject": subject, "metal": metal,
            "fineness": fineness, "mass": mass, "massUnit": mass.isEmpty ? "" : massUnit,
            "finish": finish
        ].mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.value.isEmpty }
        let properties = CoinProperties(values: manualValues, manualFields: Array(manualValues.keys))
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
            coin.catalog = CatalogSnapshot(year: selected.year, country: selected.country, metal: selected.metal,
                mintage: selected.mintage, imageUrl: selected.thumb)
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
    @State private var confirmClose = false
    init(model: NumiModel) { _draft = StateObject(wrappedValue: AddCoinModel(model: model)) }
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if !draft.images.isEmpty { photoStrip }
                    if draft.recognition == nil {
                        HStack {
                            Button { requestCamera() } label: { Label(draft.images.isEmpty ? "Снять одну сторону" : "Снять другую сторону", systemImage: "camera") }
                                .accessibilityIdentifier("add.camera")
                            Spacer()
                            Button { picker = .library } label: { Label("Выбрать фото", systemImage: "photo") }
                                .accessibilityIdentifier("add.photos")
                        }.disabled(draft.images.count >= 2)
                        if !draft.images.isEmpty {
                            Button(draft.images.count == 1 ? "Добавьте фото другой стороны" : "Определить монету") { Task { await draft.identify() } }
                                .disabled(draft.images.count != 2).accessibilityIdentifier("add.identify")
                        }
                    }
                    if let recognition = draft.recognition {
                        if let name = recognition.recognizedName { Text(name).font(.system(size: 25, design: .serif)) }
                        ForEach(recognition.candidates) { candidate in
                            Button { draft.choose(candidate) } label: {
                                HStack {
                                    Image(systemName: draft.candidate?.id == candidate.id ? "checkmark.circle.fill" : "circle")
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(candidate.name)
                                        Text([candidate.year.map(String.init), candidate.country].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundColor(Cabinet.muted)
                                    }
                                    Spacer()
                                }.cabinetPanel()
                            }.foregroundColor(Cabinet.ivory)
                        }
                    }
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Найти в каталоге").font(.title3)
                        HStack {
                            TextField("Название, год или номер", text: $draft.query).submitLabel(.search)
                                .onSubmit { Task { await draft.search() } }.accessibilityIdentifier("add.query")
                            Button { Task { await draft.search() } } label: { Image(systemName: "magnifyingglass") }
                                .accessibilityLabel("Найти").accessibilityIdentifier("add.search")
                        }.cabinetPanel()
                        ForEach(draft.results) { choice in
                            Button { draft.choose(choice) } label: {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(choice.name); Text(choice.caption).font(.caption).foregroundColor(Cabinet.muted)
                                }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
                            }.foregroundColor(Cabinet.ivory).accessibilityIdentifier("add.catalog.\(choice.id)")
                        }
                        if let choice = draft.selected { Text(choice.name).foregroundColor(Cabinet.copper).cabinetPanel() }
                        if draft.candidate == nil && draft.selected == nil {
                            TextField("Своё название монеты", text: $draft.label).accessibilityIdentifier("add.label").cabinetPanel()
                        } else {
                            Button("Указать своё название") { draft.selected = nil; draft.candidate = nil }
                        }
                    }
                    DisclosureGroup("Сведения о монете") {
                        VStack(spacing: 16) {
                            manualField("Страна", text: $draft.country, id: "add.country")
                            HStack {
                                manualField("Номинал", text: $draft.denominationValue, id: "add.denomination.value", keyboard: .decimalPad)
                                manualField("Валюта", text: $draft.denominationUnit, id: "add.denomination.unit")
                            }
                            manualField("Год", text: $draft.year, id: "add.year", keyboard: .numberPad)
                            manualField("Сюжет", text: $draft.subject, id: "add.subject")
                            manualField("Металл", text: $draft.metal, id: "add.metal")
                            HStack {
                                manualField("Проба, ‰", text: $draft.fineness, id: "add.fineness", keyboard: .decimalPad)
                                manualField("Масса", text: $draft.mass, id: "add.mass", keyboard: .decimalPad)
                            }
                            Picker("Единица массы", selection: $draft.massUnit) {
                                Text("г").tag("g"); Text("тр. унц.").tag("troy_oz")
                            }.pickerStyle(.segmented).accessibilityIdentifier("add.mass.unit")
                            manualField("Исполнение", text: $draft.finish, id: "add.finish")
                        }.padding(.top, 14)
                    }.cabinetPanel()
                    VStack(spacing: 18) {
                        TextField("Состояние или грейд", text: $draft.grade).autocapitalization(.allCharacters).accessibilityIdentifier("add.grade")
                        Divider()
                        TextField("Заметка", text: $draft.notes).accessibilityIdentifier("add.notes")
                    }.cabinetPanel()
                    if draft.busy && !draft.identifying { HStack { ProgressView(); Text(draft.phase) } }
                    if let error = draft.error { Text(error).foregroundColor(.orange).accessibilityIdentifier("add.error") }
                    Button { Task { if await draft.save() { dismiss() } } } label: {
                        Text("Добавить в коллекцию").fontWeight(.semibold).frame(maxWidth: .infinity).padding(18)
                    }.background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                        .disabled(!draft.hasChanges)
                        .accessibilityIdentifier("add.save")
                }.padding(22).disabled(draft.busy)
            }.background(Cabinet.background.ignoresSafeArea()).navigationTitle("Новая монета")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { if draft.hasChanges { confirmClose = true } else { dismiss() } }.disabled(draft.busy)
                } }
                .confirmationDialog("Удалить несохранённую монету?", isPresented: $confirmClose, titleVisibility: .visible) {
                    Button("Удалить", role: .destructive) { dismiss() }
                    Button("Продолжить заполнение", role: .cancel) { }
                }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
            .interactiveDismissDisabled(draft.hasChanges || draft.busy)
            .fullScreenCover(isPresented: $draft.identifying) {
                RecognitionWaitingView(images: draft.images)
            }
            .task {
                #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-numi-onboarding-fixture"), draft.results.isEmpty, draft.query.isEmpty {
                    draft.query = "Kamchatka"
                    await draft.search()
                }
                #endif
            }
            .sheet(item: $picker) { source in
                if source == .camera {
                    CoinCamera { data in picker = nil; if let data { Task { await draft.addImages([data]) } } }
                } else {
                    CoinPhotoPicker(count: 2 - draft.images.count) { data, error in
                        picker = nil
                        if let error { draft.error = error }
                        else { Task { await draft.addImages(data) } }
                    }
                }
            }
    }
    private var photoStrip: some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(draft.images.indices, id: \.self) { index in
                VStack {
                    if let image = UIImage(data: draft.images[index]) { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180).cornerRadius(14) }
                    Text(index == 0 ? "Первая сторона" : "Вторая сторона").font(.caption).foregroundColor(Cabinet.muted)
                    if draft.recognition == nil { Button("Удалить фото") { draft.removePhoto(index) }.font(.caption) }
                }
            }
        }
    }
    private func manualField(_ title: String, text: Binding<String>, id: String,
                             keyboard: UIKeyboardType = .default) -> some View {
        TextField(title, text: text).keyboardType(keyboard).accessibilityIdentifier(id)
            .padding(.vertical, 8).overlay(alignment: .bottom) { Divider() }
    }
    private func requestCamera() {
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
    func makeCoordinator() -> Coordinator { Coordinator(completion) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController(); picker.sourceType = .camera; picker.delegate = context.coordinator; return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) { }
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let completion: (Data?) -> Void
        init(_ completion: @escaping (Data?) -> Void) { self.completion = completion }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { completion(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            let image = info[.originalImage] as? UIImage
            Task { @MainActor in
                let data = await Task.detached(priority: .userInitiated) { image?.jpegData(compressionQuality: 0.92) }.value
                completion(data)
            }
        }
    }
}
