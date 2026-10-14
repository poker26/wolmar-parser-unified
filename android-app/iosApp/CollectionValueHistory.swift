import Foundation
import SwiftUI

struct CollectionValuePoint: Codable, Equatable, Identifiable {
    let date: String
    let activeCount: Int
    let valuedCount: Int
    let floorOnlyCount: Int
    let unvaluedCount: Int
    let marketTotalMinor: Int64
    let floorOnlyTotalMinor: Int64
    let conservativeTotalMinor: Int64
    let capturedAt: String
    var id: String { date }
}
struct CollectionValueHistory: Codable, Equatable {
    var currency = "RUB"
    var points: [CollectionValuePoint] = []
    // Keep the server amounts unchanged; order and daily uniqueness are display invariants.
    func ordered() -> CollectionValueHistory {
        var daily: [String: CollectionValuePoint] = [:]
        for point in points where point.date.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil {
            if daily[point.date].map({ $0.capturedAt <= point.capturedAt }) ?? true { daily[point.date] = point }
        }
        return CollectionValueHistory(currency: currency, points: daily.values.sorted { $0.date < $1.date })
    }
    var difference: Int64? {
        guard points.count > 1, let first = points.first, let last = points.last else { return nil }
        let result = last.conservativeTotalMinor.subtractingReportingOverflow(first.conservativeTotalMinor)
        return result.overflow ? nil : result.partialValue
    }
    var differencePercent: Int? {
        guard let difference, let first = points.first, first.conservativeTotalMinor != 0 else { return nil }
        let result = (Double(difference) * 100 / Double(first.conservativeTotalMinor)).rounded(.toNearestOrAwayFromZero)
        guard result.isFinite, result > Double(Int.min), result < Double(Int.max) else { return nil }
        return Int(result)
    }
}
struct CollectionValueHistoryView: View {
    let history: CollectionValueHistory
    var body: some View {
        if let latest = history.points.last {
            VStack(alignment: .leading, spacing: 12) {
                Text("Стоимость по дням").font(.title3).accessibilityIdentifier("overview.history.title")
                Text(money(latest.conservativeTotalMinor, currency: history.currency)).font(.system(size: 28, design: .serif)).accessibilityIdentifier("overview.history.total")
                if let difference = history.difference {
                    Text((difference > 0 ? "+" : "") + money(difference, currency: history.currency) +
                        (history.differencePercent.map { " · \($0 > 0 ? "+" : "")\($0)%" } ?? ""))
                        .foregroundColor(Cabinet.muted).accessibilityIdentifier("overview.history.change")
                }
                Canvas { context, size in
                    let values = history.points.map { Double($0.conservativeTotalMinor) }
                    let minimum = values.min() ?? 0, maximum = values.max() ?? minimum
                    let width = max(1, size.width - 14), height = max(1, size.height - 14)
                    let positions = values.enumerated().map { index, value in
                        CGPoint(x: values.count == 1 ? size.width / 2 : 7 + width * CGFloat(index) / CGFloat(values.count - 1),
                            y: 7 + height * CGFloat(maximum == minimum ? 0.5 : 1 - (value - minimum) / (maximum - minimum)))
                    }
                    var path = Path()
                    for (index, point) in positions.enumerated() {
                        if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
                    }
                    context.stroke(path, with: .color(Cabinet.copper), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    for (index, point) in positions.enumerated() {
                        let radius: CGFloat = index == positions.count - 1 ? 5 : 3
                        context.fill(Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)), with: .color(Cabinet.copper))
                    }
                }.frame(height: 112).accessibilityElement(children: .ignore)
                    .accessibilityLabel("История стоимости коллекции").accessibilityIdentifier("overview.history.chart")
                HStack { Text(history.points.first.map { historyDate($0.date) } ?? ""); Spacer(); Text(historyDate(latest.date)) }
                    .font(.caption).foregroundColor(Cabinet.muted)
                historyLine("По рыночным проходам", latest.valuedCount)
                historyLine("По стоимости металла", latest.floorOnlyCount)
                if latest.unvaluedCount > 0 { historyLine("Без суммы", latest.unvaluedCount) }
            }.cabinetPanel()
        }
    }
    private func historyLine(_ title: String, _ count: Int) -> some View {
        HStack { Text(title).foregroundColor(Cabinet.muted); Spacer(); Text(String(count)) }
    }
}
private func historyDate(_ raw: String) -> String {
    let parser = DateFormatter(); parser.locale = Locale(identifier: "en_US_POSIX"); parser.timeZone = TimeZone(secondsFromGMT: 0); parser.dateFormat = "yyyy-MM-dd"
    guard let date = parser.date(from: raw) else { return raw }
    let display = DateFormatter(); display.locale = Locale(identifier: "ru_RU"); display.timeZone = parser.timeZone; display.dateFormat = "d MMM"
    return display.string(from: date)
}
