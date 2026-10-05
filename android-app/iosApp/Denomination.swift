import Foundation

struct ParsedCoinDenomination {
    let value: String
    let unit: String
    let valid: Bool
}
func parseCoinDenomination(_ raw: String) -> ParsedCoinDenomination {
    let fractions: [Character: String] = ["¼":"1/4", "½":"1/2", "¾":"3/4", "⅓":"1/3", "⅔":"2/3",
        "⅛":"1/8", "⅜":"3/8", "⅝":"5/8", "⅞":"7/8"]
    let expanded = raw.map { fractions[$0].map { " " + $0 } ?? String($0) }.joined()
    let text = expanded.precomposedStringWithCompatibilityMapping.replacingOccurrences(of: "⁄", with: "/")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let expression = try! NSRegularExpression(pattern: #"^([0-9]+(?:\s+[0-9]+\s*/\s*[0-9]+|\s*/\s*[0-9]+|[.,][0-9]+)?)\s*(?=[\p{L}$€£¥]|$)(.*)$"#)
    guard let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let valueRange = Range(match.range(at: 1), in: text), let unitRange = Range(match.range(at: 2), in: text) else {
        return ParsedCoinDenomination(value: "", unit: text, valid: text.range(of: #"^[0-9+-]"#, options: .regularExpression) == nil)
    }
    let token = String(text[valueRange]).replacingOccurrences(of: #"\s*/\s*"#, with: "/", options: .regularExpression)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    let number: Double
    if token.contains("/") {
        let parts = token.split(separator: " ").map(String.init)
        let fraction = parts.last!.split(separator: "/").map { Double($0) ?? .nan }
        number = (parts.count == 2 ? Double(parts[0]) ?? .nan : 0) + fraction[0] / fraction[1]
    } else { number = Double(token.replacingOccurrences(of: ",", with: ".")) ?? .nan }
    let valid = number.isFinite && number > 0
    return ParsedCoinDenomination(value: valid ? NSDecimalNumber(value: number).stringValue : "",
        unit: String(text[unitRange]).trimmingCharacters(in: .whitespacesAndNewlines), valid: valid)
}
extension CoinProperties {
    func denominationText(fallback: String? = nil) -> String {
        if values["denominationText"] != nil || manualFields.contains("denominationText") { return values["denominationText"] ?? "" }
        let unit = value("denominationUnit") ?? ""
        if !parseCoinDenomination(unit).value.isEmpty { return unit }
        let combined = [value("denominationValue"), value("denominationUnit")].compactMap { $0 }.joined(separator: " ")
        if !combined.isEmpty { return combined }
        if manualFields.contains("denominationValue") || manualFields.contains("denominationUnit") { return "" }
        return fallback ?? ""
    }
    func editingDenomination(_ raw: String) -> CoinProperties {
        let parsed = parseCoinDenomination(raw)
        var result = self
        result.values["denominationText"] = raw
        result.values["denominationValue"] = parsed.value
        result.values["denominationUnit"] = parsed.unit
        result.manualFields = Array(Set(manualFields + ["denominationText", "denominationValue", "denominationUnit"])).sorted()
        return result
    }
}
