#if DEBUG
import SwiftUI

// Substitute only the hardware boundary. The shipping draft, persistence,
// review, dismissal, HTTP identification and confirmation paths still run.
enum CaptureFixture {
    static var enabled: Bool { ProcessInfo.processInfo.arguments.contains("-numi-capture-fixture") }
    static func photo(side: Int) -> Data {
        let name = side == 0 ? "kamchatka-2003-front" : "kamchatka-2003-back"
        if let url = Bundle.main.url(forResource: name, withExtension: "jpg") ??
            Bundle.main.url(forResource: name, withExtension: "jpg", subdirectory: "ScreenshotPhotos"),
            let data = try? Data(contentsOf: url) { return data }
        return UIGraphicsImageRenderer(size: CGSize(width: 600, height: 600)).image { context in
            (side == 0 ? UIColor.gray : UIColor.brown).setFill()
            context.fill(CGRect(x: 0, y: 0, width: 600, height: 600))
        }.jpegData(compressionQuality: 1)!
    }
}

struct CaptureFixtureCamera: View {
    let side: Int
    let completion: (Data?) -> Void
    var body: some View {
        VStack(spacing: 32) {
            Text("Camera fixture \(side + 1)")
            Button("Capture fixture photo") { completion(CaptureFixture.photo(side: side)) }
                .accessibilityIdentifier("fixture.shutter")
            Button("Cancel camera") { completion(nil) }.accessibilityIdentifier("fixture.cancel")
        }
    }
}
#endif
