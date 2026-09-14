import Foundation

struct AcceptedResponse: Decodable { let accepted: Bool }
struct ItemResponse: Decodable { let item: Coin }
struct PhotosResponse: Decodable { let photos: [CoinPhoto] }

enum AccountAction { case login, register, reset }
func validateAccount(email: String, password: String, confirmation: String, action: AccountAction) throws {
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines)
    guard address.contains("@"), !address.contains(where: { $0.isWhitespace }) else {
        throw NumiError.server("Проверьте адрес почты.")
    }
    if action != .login {
        // Match the server's UTF-16 length check, including non-ASCII passwords.
        guard (10...128).contains(password.utf16.count) else { throw NumiError.server("Пароль должен содержать от 10 до 128 символов.") }
        guard password == confirmation else { throw NumiError.server("Пароли не совпадают.") }
    }
    guard !password.isEmpty else { throw NumiError.server("Введите пароль.") }
}
func apiErrorMessage(_ code: String) -> String? {
    ["invalid_email": "Проверьте адрес почты.",
     "weak_password": "Пароль должен содержать от 10 до 128 символов.",
     "email_taken": "Аккаунт с такой почтой уже существует. Войдите или восстановите пароль.",
     "invalid_reset_code": "Код не подошёл или истёк. Запросите новый код.",
     "password_reset_unavailable": "Не удалось отправить письмо. Повторите позже.",
     "recognition_unavailable": "Не удалось запустить определение. Повторите попытку.",
     "recognition_failed": "Не удалось определить монету. Повторите попытку или найдите её в каталоге.",
     "invalid_recognition_response": "Не удалось определить монету. Повторите попытку или найдите её в каталоге.",
     "image_too_large": "Фотографии слишком большие. Выберите другие снимки.",
     "identification_session_unavailable": "Срок хранения загруженных фото истёк. Монета сохранена на устройстве. Сообщите об ошибке разработчику.",
     "identification_session_not_found": "Сервер не нашёл загруженные фото. Монета сохранена на устройстве. Сообщите об ошибке разработчику.",
     "identity_required": "Выберите монету из каталога или укажите название."][code]
}

struct CatalogChoice: Codable, Identifiable {
    let id: Int64
    var name: String; var year: Int?; var country: String?; var metal: String?; var mintage: Int64?; var thumb: String?
    enum CodingKeys: String, CodingKey { case id, name = "name_full", year, country, metal, mintage, thumb }
    var caption: String { [year.map(String.init), country, metal.map(metalName)].compactMap { $0?.nonempty }.joined(separator: " · ") }
}
struct IdentifiedFields: Codable {
    var country: String?; var denominationValue: String?; var denominationUnit: String?; var year: Int?
    var metal: String?; var ruler: String?; var mint: String?; var confidence: Double?
    var slabStatus: String?; var gradingCompanyCode: String?; var gradingCompanyRaw: String?
    var gradeCode: String?; var gradeSource: String?; var slabCertificateNumber: String?
}
struct IdentificationCandidate: Codable, Identifiable {
    let id: Int64; var name: String; var country: String?; var year: Int?; var denomination: String?
    var issueId: Int64?; var issueYear: Int?; var issueMatch: String?
}
struct IdentificationResult: Codable {
    var identificationSessionId: String?; var requestId: String?; var recognizedName: String?
    var catalogMatch: String; var extracted: IdentifiedFields; var candidates: [IdentificationCandidate]
}
struct IdentificationEvidence: Codable {
    var strategy = "qwen_single_pass_v1"
    var catalogMatch: String; var proposedTypeIds: [Int64]; var decision: String
    var recognizedName: String?; var extracted: IdentifiedFields
}
struct CreateCoinInput: Codable {
    var typeId: Int64?; var issueId: Int64?; var identifiedYear: Int?; var userLabel: String?
    var identificationRequestId: String?; var gradeCode: String?
    var slabStatus = "unknown"; var gradingCompanyCode: String?; var gradeSource = "unknown"
    var slabCertificateNumber: String?; var notes: String?; var identificationEvidence: IdentificationEvidence?
}
struct PendingCoin: Codable, Identifiable {
    let id: String
    var input: CreateCoinInput; var coin: Coin; var sessionID: String?; var photoKeys: [String]
    var remoteCoin: Coin?
}
struct CoinMultipart {
    let body: Data; let contentType: String
    init(images: [Data], boundary: String = "numi-" + UUID().uuidString) throws {
        guard (1...2).contains(images.count), images.allSatisfy({ !$0.isEmpty }), images.reduce(0, { $0 + $1.count }) <= 12 * 1024 * 1024 else {
            throw NumiError.server("Выберите две фотографии монеты общим размером до 12 МБ.")
        }
        var result = Data()
        for (index, image) in images.enumerated() {
            result.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"images\"; filename=\"coin-\(index + 1).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8))
            result.append(image); result.append(Data("\r\n".utf8))
        }
        result.append(Data("--\(boundary)--\r\n".utf8))
        body = result; contentType = "multipart/form-data; boundary=\(boundary)"
    }
}
