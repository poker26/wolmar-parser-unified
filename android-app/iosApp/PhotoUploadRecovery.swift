import Foundation
import CryptoKit

func recoveredUpload(_ photos: [CoinPhoto], itemID: String, data: Data, index: Int) -> CoinPhoto? {
    let sha = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let matches = photos.filter {
        $0.itemId == itemID && $0.status == "ready" && $0.sortOrder == index &&
        $0.side == (index == 0 ? "obverse" : "reverse") && $0.byteSize == Int64(data.count) &&
        $0.sha256?.lowercased() == sha
    }
    return matches.count == 1 ? matches[0] : nil
}
