import XCTest
import UIKit
@testable import Numi

final class SystemCameraTests: XCTestCase {
    @MainActor func testCaptureUsesSystemPickerWithoutOverlayOrCropping() {
        XCTAssertEqual(CoinCamera.sourceType, .camera)
        let picker = CoinCamera.makePicker()
        XCTAssertTrue(type(of: picker) == UIImagePickerController.self)
        XCTAssertFalse(picker.allowsEditing)
        XCTAssertEqual(picker.modalPresentationStyle, .fullScreen)
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            XCTAssertNil(picker.cameraOverlayView)
            XCTAssertEqual(picker.cameraViewTransform, .identity)
            XCTAssertEqual(picker.sourceType, .camera)
            XCTAssertTrue(picker.showsCameraControls)
        }
    }

    @MainActor func testCancelReturnsOnceWithoutInventingAPhoto() {
        var results: [Data?] = []
        let coordinator = CoinCamera.Coordinator { results.append($0) }
        let picker = UIImagePickerController()
        coordinator.imagePickerControllerDidCancel(picker)
        coordinator.imagePickerControllerDidCancel(picker)
        XCTAssertEqual(results.count, 1)
        XCTAssertNil(results[0])
    }

    @MainActor func testFullImageIsReturnedInsteadOfThumbnailOrCrop() throws {
        let original = UIGraphicsImageRenderer(size: CGSize(width: 800, height: 600)).image { _ in
            UIColor.gray.setFill(); UIBezierPath(rect: CGRect(x: 0, y: 0, width: 800, height: 600)).fill()
        }
        var result: Data?
        let coordinator = CoinCamera.Coordinator { result = $0 }
        coordinator.imagePickerController(UIImagePickerController(), didFinishPickingMediaWithInfo: [.originalImage: original])
        let image = try XCTUnwrap(UIImage(data: XCTUnwrap(result)))
        XCTAssertEqual(image.cgImage?.width, original.cgImage?.width)
        XCTAssertEqual(image.cgImage?.height, original.cgImage?.height)
    }
}
