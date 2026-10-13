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
    @State private var accepting = false
    private var side: Int { replacing ?? draft.images.count }
    var body: some View {
        ZStack {
            Cabinet.background.ignoresSafeArea()
            if !accepting && (taking || draft.pendingPhoto == nil) {
                if source == .camera {
                    camera
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
                        Button("Назад", action: close).accessibilityIdentifier("capture.back"); Spacer()
                        Button("Как фотографировать") { showHelp() }
                    }.padding(22)
                    CapturePhotoZoom(data: data)
                    if let error = draft.error { Text(error).foregroundColor(.orange).padding() }
                    HStack(spacing: 14) {
                        Button("Переснять") {
                            CaptureEventRecorder.record("retake", attempt: draft.captureAttemptID, side: side, source: source.rawValue)
                            taking = true
                        }.padding(18).frame(maxWidth: .infinity).overlay(RoundedRectangle(cornerRadius: 18).stroke(Cabinet.copper))
                            .accessibilityIdentifier("capture.retake")
                        Button {
                            accepting = true
                            Task {
                                if await draft.acceptPhoto() { close() }
                                else { accepting = false }
                            }
                        } label: {
                            if draft.busy { ProgressView() } else { Text("Оставить фото").fontWeight(.semibold) }
                        }.padding(18).frame(maxWidth: .infinity).background(Cabinet.copper).foregroundColor(Cabinet.background).cornerRadius(18)
                            .accessibilityIdentifier("capture.accept")
                    }.padding(22).disabled(draft.busy)
                }
            }
            if draft.busy && draft.pendingPhoto == nil { ProgressView().padding(24).background(Cabinet.panel).cornerRadius(18) }
        }.preferredColorScheme(.dark).tint(Cabinet.copper)
            .sheet(isPresented: $help) { CaptureHelpView() }
            .onAppear {
                #if DEBUG
                if CaptureFixture.enabled { return }
                #endif
                if source == .camera && !UserDefaults.standard.bool(forKey: "capture-help-seen") { showHelp() }
            }
    }
    @ViewBuilder private var camera: some View {
        #if DEBUG
        if CaptureFixture.enabled { CaptureFixtureCamera(side: side, completion: receiveCameraPhoto) }
        else { CoinCamera(completion: receiveCameraPhoto) }
        #else
        CoinCamera(completion: receiveCameraPhoto)
        #endif
    }
    private func receiveCameraPhoto(_ data: Data?) {
        taking = false
        if let data { Task { await draft.stagePhoto(data, source: "camera", replacing: replacing) } }
        else if draft.pendingPhoto == nil { close() }
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

