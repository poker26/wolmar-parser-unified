import Foundation

enum APNsTokenRequestError: LocalizedError {
    case unavailable
    var errorDescription: String? { "Не удалось подключить уведомления. Проверьте интернет и повторите." }
}

/// Every request waits for a current OS callback. Cancellation and a late callback resume each waiter once.
@MainActor final class APNsTokenRequest {
    private var waiters: [UUID: CheckedContinuation<Data, Error>] = [:]
    private var deadlines: [UUID: Task<Void, Never>] = [:]

    func request(timeoutNanoseconds: UInt64 = 30_000_000_000, register: () -> Void) async throws -> Data {
        let id = UUID()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(throwing: CancellationError()); return }
                waiters[id] = continuation
                deadlines[id] = Task { [weak self] in
                    do { try await Task.sleep(nanoseconds: timeoutNanoseconds) }
                    catch { return }
                    self?.finish(id, result: .failure(APNsTokenRequestError.unavailable))
                }
                register()
            }
        }, onCancel: { [weak self] in
            Task { @MainActor in self?.finish(id, result: .failure(CancellationError())) }
        })
    }
    func received(_ value: Data) {
        for id in Array(waiters.keys) { finish(id, result: .success(value)) }
    }
    func failed() {
        for id in Array(waiters.keys) { finish(id, result: .failure(APNsTokenRequestError.unavailable)) }
    }
    private func finish(_ id: UUID, result: Result<Data, Error>) {
        guard let continuation = waiters.removeValue(forKey: id) else { return }
        deadlines.removeValue(forKey: id)?.cancel()
        continuation.resume(with: result)
    }
}
