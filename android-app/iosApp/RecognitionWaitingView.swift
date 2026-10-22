import SwiftUI
import UIKit

struct MarketStorySale: Decodable {
    let lotId: Int
    let priceRub: Int
    let price: String
    let date: String
    let source: String
    let url: String
}

#if DEBUG
struct RecognitionWaitingFixture: View {
    @State private var returned = false
    var body: some View {
        if returned { Text("Коллекция").accessibilityIdentifier("fixture.collection") }
        else {
            RecognitionWaitingView(images: Array(repeating: UIImage(named: "MarketStoryCoin")!.jpegData(compressionQuality: 1)!, count: 2),
                onCollection: { returned = true },
                elapsedSecondsOverride: ProcessInfo.processInfo.arguments.contains("-numi-long-wait") ? 16 : 0)
                .environment(\.sizeCategory, ProcessInfo.processInfo.arguments.contains("-numi-waiting-large-text") ? .accessibilityLarge : .large)
        }
    }
}
#endif

struct RecognitionMarketStory: Decodable {
    let id, status, expectedTime, longWait, headline, exampleLabel: String
    let coinName, coinDetails, photoCredit, photoSourceUrl, photoOriginalUrl: String
    let salesLabel: String
    let sales: [MarketStorySale]
    let rangeLabel, range, closing, returnAction: String

    static let bundled: RecognitionMarketStory = {
        guard let data = NSDataAsset(name: "RecognitionMarketStory")?.data,
              let story = try? JSONDecoder().decode(RecognitionMarketStory.self, from: data) else {
            preconditionFailure("Missing verified market story")
        }
        return story
    }()

    func timingText(elapsedSeconds: TimeInterval) -> String {
        elapsedSeconds >= 15 ? longWait : expectedTime
    }
}

struct RecognitionWaitingView: View {
    let images: [Data]
    let onCollection: () -> Void
    var elapsedSecondsOverride: TimeInterval? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var headlineSize: CGFloat = 32
    @ScaledMetric(relativeTo: .title2) private var rangeSize: CGFloat = 27
    @State private var started = ProcessInfo.processInfo.systemUptime
    @State private var elapsed: TimeInterval = 0
    @State private var beat = -1
    @State private var settled = false
    private let story = RecognitionMarketStory.bundled

    var body: some View {
        ZStack {
            Cabinet.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    HStack(spacing: 14) {
                        HStack(spacing: 5) {
                            ForEach(Array(images.prefix(2).enumerated()), id: \.offset) { _, data in
                                if let image = UIImage(data: data) {
                                    Image(uiImage: image).resizable().scaledToFill().frame(width: 40, height: 40)
                                        .clipped().cornerRadius(8)
                                }
                            }
                        }.accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(story.status).font(.headline)
                            Text(story.timingText(elapsedSeconds: elapsedSecondsOverride ?? elapsed))
                                .font(.caption).foregroundColor(Cabinet.muted)
                                .accessibilityIdentifier("recognition.timing")
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        ProgressView().tint(Cabinet.copper)
                    }.padding(20)
                    auctionStory
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onCollection) {
                Text(story.returnAction).fontWeight(.medium).frame(maxWidth: .infinity).padding(17)
                    .overlay(RoundedRectangle(cornerRadius: 18).stroke(Cabinet.muted.opacity(0.4)))
            }.buttonStyle(.plain).padding(.horizontal, 20).padding(.vertical, 12)
                .frame(maxWidth: 760).frame(maxWidth: .infinity).background(Cabinet.background)
                .accessibilityIdentifier("recognition.collection")
        }
        .interactiveDismissDisabled().preferredColorScheme(.dark).tint(Cabinet.copper)
        .task {
            while !Task.isCancelled && elapsed < 15 {
                do { try await Task.sleep(nanoseconds: 250_000_000) } catch { return }
                elapsed = ProcessInfo.processInfo.systemUptime - started
            }
        }
        .task(id: reduceMotion) {
            if reduceMotion { settled = true; beat = 3; return }
            withAnimation(.easeInOut(duration: 10)) { settled = true }
            for index in 0...3 {
                do { try await Task.sleep(nanoseconds: 2_200_000_000) } catch { return }
                beat = index
            }
        }
    }

    private var auctionStory: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                Text(story.headline).font(.system(size: headlineSize, weight: .medium, design: .serif))
                    .accessibilityIdentifier("recognition.story.headline")
                Image("MarketStoryCoin").resizable().scaledToFit().frame(width: 160, height: 160)
                    .clipShape(Circle()).scaleEffect(settled || reduceMotion ? 1 : 0.94)
                    .frame(maxWidth: .infinity).accessibilityLabel("\(story.coinName), \(story.coinDetails)")
                VStack(alignment: .leading, spacing: 5) {
                    Text(story.exampleLabel).font(.caption.weight(.medium)).foregroundColor(Cabinet.copper)
                    Text(story.coinName).font(.title3.weight(.medium))
                    Text(story.coinDetails).font(.caption).foregroundColor(Cabinet.muted)
                    if let url = URL(string: story.photoSourceUrl) {
                        Link(story.photoCredit, destination: url).font(.caption2).padding(.vertical, 8)
                    }
                }
                VStack(spacing: 8) {
                    Text(story.salesLabel).font(.subheadline).foregroundColor(Cabinet.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(Array(story.sales.enumerated()), id: \.element.lotId) { index, sale in
                        HStack(spacing: 12) {
                            Circle().fill(beat >= index || reduceMotion ? Cabinet.copper : Cabinet.muted.opacity(0.45))
                                .frame(width: 6, height: 6).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(sale.source).font(.subheadline)
                                Text(sale.date).font(.caption).foregroundColor(Cabinet.muted)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            Text(sale.price).font(.headline).fixedSize(horizontal: true, vertical: false)
                        }.accessibilityElement(children: .combine)
                    }
                }
                Rectangle().fill(Cabinet.copper.opacity(0.25)).frame(height: 1)
                VStack(alignment: .leading, spacing: 6) {
                    Text(story.rangeLabel).font(.caption).foregroundColor(Cabinet.muted)
                    Text(story.range).font(.system(size: rangeSize, weight: .medium, design: .serif)).foregroundColor(Cabinet.copper)
                    Text(story.closing).font(.subheadline)
                }
            }.frame(maxWidth: 480, alignment: .leading).padding(.horizontal, 26).padding(.vertical, 22)
        }.frame(maxWidth: .infinity)
            .background(LinearGradient(colors: [Color(red: 41/255, green: 32/255, blue: 24/255),
                Color(red: 25/255, green: 25/255, blue: 27/255), Cabinet.background], startPoint: .top, endPoint: .bottom))
            .accessibilityIdentifier("recognition.auctionStory")
    }
}
