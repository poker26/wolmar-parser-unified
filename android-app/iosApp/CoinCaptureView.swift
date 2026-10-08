import SwiftUI
import AVFoundation
import UIKit

enum CaptureEventRecorder {
    static func record(_ action: String, attempt: String, side: Int, source: String) {
        guard ["help_shown", "side_accepted", "retake", "manual_after_failure"].contains(action) else { return }
        let value: [String: Any] = ["id": UUID().uuidString, "action": action,
            "attemptId": attempt, "side": side, "source": source, "platform": "ios",
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "occurredAtMs": Int64(Date().timeIntervalSince1970 * 1000), "contractVersion": 1,
            "qualityCheckerVersion": NSNull()]
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        UserDefaults.standard.set(data, forKey: "capture-event:" + (value["id"] as! String))
    }
}

struct CoinCaptureFlow: View {
    @ObservedObject var draft: AddCoinModel
    let source: CoinPickerSource
    let replacing: Int?
    let close: () -> Void
    @State private var taking = false
    @State private var help = false
    private var side: Int { replacing ?? draft.images.count }
    var body: some View {
        ZStack {
            Cabinet.background.ignoresSafeArea()
            if taking || draft.pendingPhoto == nil {
                if source == .camera {
                    CoinCamera { data in
                        taking = false
                        if let data { Task { await draft.stagePhoto(data, source: "camera", replacing: replacing) } }
                        else if draft.pendingPhoto == nil { close() }
                    }
                } else {
                    CoinPhotoPicker(count: 1) { photos, error in
                        taking = false
                        if let error { draft.error = error; close() }
                        else if let data = photos.first { Task { await draft.stagePhoto(data, source: "gallery", replacing: replacing) } }
                        else if draft.pendingPhoto == nil { close() }
                    }
                }
            }
            if !taking, let data = draft.pendingPhoto {
                VStack(spacing: 0) {
                    HStack {
                        Button("Назад", action: close); Spacer()
                        Button("Как фотографировать") { showHelp() }
                    }.padding(22)
                    CapturePhotoZoom(data: data)
                    if let error = draft.error { Text(error).foregroundColor(.orange).padding() }
                    HStack(spacing: 14) {
                        Button("Переснять") {
                            CaptureEventRecorder.record("retake", attempt: draft.captureAttemptID, side: side, source: source.rawValue)
                            taking = true
                        }.padding(18).frame(maxWidth: .infinity).overlay(RoundedRectangle(cornerRadius: 18).stroke(Cabinet.copper))
                        Button { Task { if await draft.acceptPhoto() { close() } } } label: {
                            if draft.busy { ProgressView() } else { Text("Оставить фото").fontWeight(.semibold) }
                        }.padding(18).frame(maxWidth: .infinity).background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                    }.padding(22).disabled(draft.busy)
                }
            }
            if draft.busy && draft.pendingPhoto == nil { ProgressView().padding(24).background(Cabinet.panel).cornerRadius(18) }
        }.preferredColorScheme(.dark).tint(Cabinet.copper)
            .sheet(isPresented: $help) { CaptureHelpView() }
            .onAppear {
                if source == .camera && !UserDefaults.standard.bool(forKey: "capture-help-seen") { showHelp() }
            }
    }
    private func showHelp() {
        UserDefaults.standard.set(true, forKey: "capture-help-seen")
        CaptureEventRecorder.record("help_shown", attempt: draft.captureAttemptID, side: side, source: source.rawValue)
        help = true
    }
}

struct CapturePhotoZoom: View {
    let data: Data
    @State private var scale: CGFloat = 1
    @State private var prior: CGFloat = 1
    @State private var offset = CGSize.zero
    @State private var priorOffset = CGSize.zero
    var body: some View {
        GeometryReader { geometry in
            if let image = UIImage(data: data) {
                Image(uiImage: image).resizable().scaledToFit().frame(width: geometry.size.width, height: geometry.size.height)
                    .scaleEffect(scale).offset(offset)
                    .gesture(MagnificationGesture().onChanged { value in
                        scale = min(8, max(1, prior * value)); if scale == 1 { offset = .zero; priorOffset = .zero }
                    }.onEnded { _ in prior = scale })
                    .simultaneousGesture(DragGesture().onChanged { value in
                        if scale > 1 {
                            let x = geometry.size.width * (scale - 1) / 2, y = geometry.size.height * (scale - 1) / 2
                            offset = CGSize(width: min(x, max(-x, priorOffset.width + value.translation.width)),
                                height: min(y, max(-y, priorOffset.height + value.translation.height)))
                        }
                    }.onEnded { _ in priorOffset = offset })
                    .onTapGesture(count: 2) { scale = scale > 1 ? 1 : 3; prior = scale; offset = .zero; priorOffset = .zero }
            }
        }.clipped().accessibilityIdentifier("capture.preview")
    }
}

struct CaptureHelpView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack(spacing: 16) {
                        CaptureExample(large: true); CaptureExample(large: false)
                    }
                    Text("Положите монету на ровную матовую поверхность. Выберите хорошо освещённое место без бликов. Держите телефон прямо над монетой.")
                    Text("Если надписи размываются, немного отдалите телефон и дождитесь фокусировки. Если на монете есть блики, измените положение источника света.").foregroundColor(Cabinet.muted)
                }.padding(24)
            }.background(Cabinet.background.ignoresSafeArea()).navigationTitle("Как фотографировать")
                .navigationBarTitleDisplayMode(.inline).toolbar { ToolbarItem(placement: .confirmationAction) { Button("К съёмке") { dismiss() } } }
        }.navigationViewStyle(.stack).preferredColorScheme(.dark).tint(Cabinet.copper)
    }
}
private struct CaptureExample: View {
    let large: Bool
    var body: some View {
        VStack {
            GeometryReader { geometry in
                let diameter = geometry.size.width * (large ? 0.74 : 0.22)
                ZStack {
                    Cabinet.panel
                    Circle().fill(Color.gray).frame(width: diameter, height: diameter)
                        .overlay(Circle().stroke(Cabinet.ivory, lineWidth: 2).padding(diameter * 0.07))
                }
            }.aspectRatio(1, contentMode: .fit).cornerRadius(16)
            Text(large ? "Крупно" : "Слишком далеко").font(.caption)
        }
    }
}

/** Preview and guide are separate layers; AVCapturePhotoOutput saves only sensor data. */
final class GuidedCameraController: UIViewController, AVCapturePhotoCaptureDelegate {
    let completion: (Data?) -> Void
    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "numi.camera.session")
    private let output = AVCapturePhotoOutput()
    private let frame = UIView()
    private var preview: AVCaptureVideoPreviewLayer!
    private let guide = CAShapeLayer()
    private let shutter = UIButton(type: .system)
    private let message = UILabel()
    private var device: AVCaptureDevice?
    private var finishing = false
    init(completion: @escaping (Data?) -> Void) { self.completion = completion; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(Cabinet.background)
        let cancel = UIButton(type: .system); cancel.setTitle("Назад", for: .normal)
        cancel.addTarget(self, action: #selector(cancelPhoto), for: .touchUpInside)
        let help = UIButton(type: .system); help.setTitle("Как фотографировать", for: .normal)
        help.addTarget(self, action: #selector(showHelp), for: .touchUpInside)
        message.text = "Приблизьте телефон, чтобы монета почти заполнила круг. Оставьте весь край монеты в кадре."
        message.numberOfLines = 0; message.textColor = UIColor(Cabinet.ivory); message.font = .preferredFont(forTextStyle: .body)
        shutter.setTitle("Снять сторону", for: .normal); shutter.backgroundColor = UIColor(Cabinet.copper)
        shutter.setTitleColor(UIColor(Cabinet.background), for: .normal); shutter.layer.cornerRadius = 24
        shutter.accessibilityIdentifier = "capture.shutter"; shutter.isEnabled = false
        shutter.addTarget(self, action: #selector(takePhoto), for: .touchUpInside)
        [cancel, help, frame, message, shutter].forEach { $0.translatesAutoresizingMaskIntoConstraints = false; view.addSubview($0) }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            cancel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 20), cancel.topAnchor.constraint(equalTo: safe.topAnchor, constant: 8),
            help.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -20), help.centerYAnchor.constraint(equalTo: cancel.centerYAnchor),
            shutter.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 22), shutter.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -22),
            shutter.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -16), shutter.heightAnchor.constraint(equalToConstant: 56),
            message.leadingAnchor.constraint(equalTo: shutter.leadingAnchor), message.trailingAnchor.constraint(equalTo: shutter.trailingAnchor),
            message.bottomAnchor.constraint(equalTo: shutter.topAnchor, constant: -16),
            frame.topAnchor.constraint(equalTo: cancel.bottomAnchor, constant: 16), frame.bottomAnchor.constraint(equalTo: message.topAnchor, constant: -16),
            frame.leadingAnchor.constraint(equalTo: safe.leadingAnchor), frame.trailingAnchor.constraint(equalTo: safe.trailingAnchor)
        ])
        preview = AVCaptureVideoPreviewLayer(session: session); preview.videoGravity = .resizeAspect
        frame.layer.addSublayer(preview); frame.layer.addSublayer(guide)
        guide.fillColor = UIColor.clear.cgColor; guide.strokeColor = UIColor.white.withAlphaComponent(0.8).cgColor; guide.lineWidth = 2
        frame.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(focus(_:))))
        sessionQueue.async { [weak self] in self?.configure() }
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.frame = frame.bounds
        let orientation = view.window?.windowScene?.interfaceOrientation ?? .portrait
        let videoOrientation: AVCaptureVideoOrientation = orientation == .landscapeLeft ? .landscapeLeft : orientation == .landscapeRight ? .landscapeRight : orientation == .portraitUpsideDown ? .portraitUpsideDown : .portrait
        preview.connection?.videoOrientation = videoOrientation
        let ratio: CGFloat = orientation.isLandscape ? 4 / 3 : 3 / 4
        let width = min(frame.bounds.width, frame.bounds.height * ratio), height = min(frame.bounds.height, frame.bounds.width / ratio)
        let diameter = min(width, height) * 0.75
        guide.frame = frame.bounds
        guide.path = UIBezierPath(ovalIn: CGRect(x: (frame.bounds.width - diameter) / 2, y: (frame.bounds.height - diameter) / 2, width: diameter, height: diameter)).cgPath
    }
    private func configure() {
        session.beginConfiguration(); session.sessionPreset = .photo
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration(); DispatchQueue.main.async { self.message.text = "Камера недоступна. Выберите фото или заполните сведения вручную." }; return
        }
        device = camera; session.addInput(input); session.addOutput(output)
        if (try? camera.lockForConfiguration()) != nil {
            if camera.isFocusModeSupported(.continuousAutoFocus) { camera.focusMode = .continuousAutoFocus }
            if camera.isExposureModeSupported(.continuousAutoExposure) { camera.exposureMode = .continuousAutoExposure }
            camera.unlockForConfiguration()
        }
        output.isHighResolutionCaptureEnabled = true; session.commitConfiguration(); session.startRunning()
        DispatchQueue.main.async { self.shutter.isEnabled = true }
    }
    @objc private func takePhoto() {
        guard !finishing else { return }
        shutter.isEnabled = false
        output.connection(with: .video)?.videoOrientation = preview.connection?.videoOrientation ?? .portrait
        let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
        settings.isHighResolutionPhotoEnabled = true; settings.flashMode = .off
        output.capturePhoto(with: settings, delegate: self)
    }
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        DispatchQueue.main.async {
            if error == nil, let data = photo.fileDataRepresentation() { self.finishing = true; self.completion(data) }
            else { self.message.text = "Не удалось снять фотографию. Попробуйте ещё раз."; self.shutter.isEnabled = true }
        }
    }
    @objc private func cancelPhoto() { finishing = true; completion(nil) }
    @objc private func showHelp() {
        let host = UIHostingController(rootView: CaptureHelpView()); present(host, animated: true)
    }
    @objc private func focus(_ gesture: UITapGestureRecognizer) {
        let point = preview.captureDevicePointConverted(fromLayerPoint: gesture.location(in: frame))
        sessionQueue.async { [weak self] in
            guard let camera = self?.device, (try? camera.lockForConfiguration()) != nil else { return }
            if camera.isFocusPointOfInterestSupported { camera.focusPointOfInterest = point; camera.focusMode = .autoFocus }
            if camera.isExposurePointOfInterestSupported { camera.exposurePointOfInterest = point; camera.exposureMode = .continuousAutoExposure }
            camera.unlockForConfiguration()
        }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); sessionQueue.async { [weak self] in if self?.session.inputs.isEmpty == false { self?.session.startRunning() } } }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); sessionQueue.async { [weak self] in self?.session.stopRunning() } }
}
