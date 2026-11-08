import Foundation

extension CoinProperties {
    func denominationText(fallback: String? = nil) -> String {
        if values["denominationText"] != nil || manualFields.contains("denominationText") {
            return values["denominationText"] ?? ""
        }
        let amount = value("denominationValue"), unit = value("denominationUnit")
        if let amount, let unit, unit.hasPrefix(amount + " ") { return unit }
        let combined = [amount, unit].compactMap { $0 }.joined(separator: " ")
        if !combined.isEmpty { return combined }
        if manualFields.contains("denominationValue") || manualFields.contains("denominationUnit") { return "" }
        return fallback ?? ""
    }

    func editingDenomination(_ raw: String) -> CoinProperties {
        var result = self
        result.values["denominationText"] = raw
        result.values.removeValue(forKey: "denominationValue")
        result.values.removeValue(forKey: "denominationUnit")
        result.manualFields = Array(Set(manualFields + ["denominationText", "denominationValue", "denominationUnit"])).sorted()
        return result
    }
}
