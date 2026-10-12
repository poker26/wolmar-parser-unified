import Foundation

struct CollectionRevaluationRequest: Encodable { let requestId: String }
struct CollectionRevaluationResponse: Decodable { let job: CollectionRevaluationJob? }
struct CollectionRevaluationJob: Decodable, Equatable {
    var requestId: String?
    var status: String
    var startedAt: String?
    var completedAt: String?
    var total: Int
    var processed: Int
    var valued: Int
    var unvalued: Int
    var failed: Int
    var skipped: Int
    var running: Bool { status == "queued" || status == "running" }
    var label: String {
        if running { return total == 0 ? "Пересчёт начинается." : "Обработано \(processed) из \(total) монет." }
        if status == "failed" { return "Не удалось завершить пересчёт." }
        if failed > 0 { return "Обработано \(processed) из \(total) монет. Ошибок: \(failed)." }
        return "Пересчёт завершён. Обработано монет: \(processed)."
    }
}
