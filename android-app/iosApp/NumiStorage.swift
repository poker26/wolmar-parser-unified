import Foundation
import CryptoKit
import ImageIO
import UniformTypeIdentifiers

actor LibraryDisk {
    private let root: URL
    init(root: URL? = nil) {
        self.root = root ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Numi", isDirectory: true)
    }
    nonisolated static func hash(_ value: String) -> String { SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined() }
    private func folder(account: String) -> URL { root.appendingPathComponent(Self.hash(account), isDirectory: true) }
    func load(account: String) throws -> LibrarySnapshot {
        let url = folder(account: account).appendingPathComponent("collection.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return LibrarySnapshot() }
        return try JSONDecoder().decode(LibrarySnapshot.self, from: Data(contentsOf: url))
    }
    func save(_ snapshot: LibrarySnapshot, account: String) throws {
        let folder = folder(account: account)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(snapshot).write(to: folder.appendingPathComponent("collection.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func loadPending(account: String) throws -> [PendingCoin] {
        let url = folder(account: account).appendingPathComponent("pending-coins.json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try JSONDecoder().decode([PendingCoin].self, from: Data(contentsOf: url))
    }
    func savePending(_ pending: [PendingCoin], account: String) throws {
        let folder = folder(account: account)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try JSONEncoder().encode(pending).write(to: folder.appendingPathComponent("pending-coins.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func copyImage(account: String, from: String, to: String) throws {
        let folder = folder(account: account)
        let data = try Data(contentsOf: folder.appendingPathComponent(Self.hash(from) + ".jpg"))
        try data.write(to: folder.appendingPathComponent(Self.hash(to) + ".jpg"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func hasImage(account: String, key: String) -> Bool {
        FileManager.default.fileExists(atPath: folder(account: account).appendingPathComponent(Self.hash(key) + ".jpg").path)
    }
    func image(account: String, key: String) -> Data? {
        try? Data(contentsOf: folder(account: account).appendingPathComponent(Self.hash(key) + ".jpg"))
    }
    func storeImage(_ data: Data, account: String, key: String) throws {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1200
              ] as CFDictionary) else { throw NumiError.corruptPhoto }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw NumiError.storage }
        CGImageDestinationAddImage(destination, thumbnail, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw NumiError.storage }
        let folder = folder(account: account)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try (output as Data).write(to: folder.appendingPathComponent(Self.hash(key) + ".jpg"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func clear(account: String) throws {
        let target = folder(account: account)
        if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
    }
}

struct MediaJob: Sendable {
    let key: String; let url: String?; let photoID: String?; let size: Int64?; let sha256: String?
}
struct MediaLoader {
    let api: NumiAPI; let disk: LibraryDisk
    // Media requests never carry account cookies to signed object-storage URLs.
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 60
        return URLSession(configuration: configuration)
    }()
    func run(_ job: MediaJob, account: String) async throws {
        if await disk.hasImage(account: account, key: job.key) { return }
        var address = job.url
        var original = job.url == nil
        if address == nil, let id = job.photoID { address = try await api.photoURL(id: id) }
        guard var url = address.flatMap(URL.init(string:)), url.scheme == "https" else { throw NumiError.invalidResponse }
        var (data, response) = try await Self.session.data(from: url)
        if let http = response as? HTTPURLResponse, [401, 403, 404].contains(http.statusCode), let id = job.photoID {
            guard let refreshed = URL(string: try await api.photoURL(id: id)), refreshed.scheme == "https" else { throw NumiError.invalidResponse }
            url = refreshed
            original = true
            (data, response) = try await Self.session.data(from: url)
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw NumiError.unavailable }
        if original {
            guard let size = job.size, let hash = job.sha256, Int64(data.count) == size,
                  SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined().lowercased() == hash.lowercased() else { throw NumiError.corruptPhoto }
        }
        try await disk.storeImage(data, account: account, key: job.key)
    }
}
