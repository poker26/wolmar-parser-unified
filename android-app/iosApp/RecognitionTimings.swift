import Foundation

struct RecognitionTiming: Codable, Equatable {
    let recordedAt: Date
    let preparationMs: Double
    let totalMs: Double
    let connectionMs: Double?
    let uploadMs: Double?
    let responseWaitMs: Double?
    let downloadMs: Double?
    let reusedConnection: Bool?
    let statusCode: Int?
    let requestID: String?
}
// Only timings and an opaque request ID are retained. URLs, cookies and image data are excluded.
final class RecognitionMetricsDelegate: NSObject, URLSessionTaskDelegate {
    private let lock = NSLock()
    private var metric: URLSessionTaskTransactionMetrics?
    private let started: TimeInterval
    private let prepared: TimeInterval
    init(started: TimeInterval, prepared: TimeInterval) { self.started = started; self.prepared = prepared }
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        lock.lock(); metric = metrics.transactionMetrics.last; lock.unlock()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        let original = task.originalRequest?.url
        completionHandler(request.url?.scheme == original?.scheme && request.url?.host == original?.host && request.url?.port == original?.port ? request : nil)
    }
    func finish(requestID: String?) -> RecognitionTiming {
        lock.lock(); let metric = metric; lock.unlock()
        func duration(_ from: Date?, _ to: Date?) -> Double? {
            guard let from, let to, to >= from else { return nil }
            return to.timeIntervalSince(from) * 1000
        }
        let safeID = requestID.flatMap { value in
            value.count <= 128 && value.range(of: #"^[a-zA-Z0-9_.:-]+$"#, options: .regularExpression) != nil ? value : nil
        }
        return RecognitionTiming(recordedAt: Date(), preparationMs: max(0, (prepared - started) * 1000),
            totalMs: max(0, (ProcessInfo.processInfo.systemUptime - started) * 1000),
            connectionMs: duration(metric?.connectStartDate, metric?.connectEndDate),
            uploadMs: duration(metric?.requestStartDate, metric?.requestEndDate),
            responseWaitMs: duration(metric?.requestEndDate, metric?.responseStartDate),
            downloadMs: duration(metric?.responseStartDate, metric?.responseEndDate),
            reusedConnection: metric?.isReusedConnection, statusCode: (metric?.response as? HTTPURLResponse)?.statusCode, requestID: safeID)
    }
}
