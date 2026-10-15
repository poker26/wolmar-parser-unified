import Foundation

/// Source travels with the label. A missing legacy source does not establish authorship.
struct CoinName: Equatable {
    var label: String?
    var source: String?
    static let automatic = "automatic"
    static let user = "user"
    private var value: String? { label?.trimmingCharacters(in: .whitespacesAndNewlines).nonempty }
    private var generatedPlaceholder: Bool {
        source != Self.user && ["Нераспознанная монета", "Монета без названия"].contains(value ?? "")
    }
    private var protected: Bool { value != nil && source != Self.automatic && !generatedPlaceholder }

    func selecting(_ name: String) -> CoinName {
        protected ? self : CoinName(label: String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)).nonempty, source: Self.automatic)
    }
    func recognizing(_ name: String?, catalogName: String? = nil) -> CoinName {
        guard !protected, let next = catalogName?.trimmingCharacters(in: .whitespacesAndNewlines).nonempty
            ?? name?.trimmingCharacters(in: .whitespacesAndNewlines).nonempty else { return self }
        return CoinName(label: String(next.prefix(200)), source: Self.automatic)
    }
    /// Invoke for an actual edit, not when prefilling the form or selecting a match.
    func editing(_ text: String) -> CoinName {
        let next = text.trimmingCharacters(in: .whitespacesAndNewlines).nonempty
        return next == value ? self : CoinName(label: next, source: next == nil ? Self.automatic : Self.user)
    }
    func title(catalogName: String?) -> String {
        source == Self.user && value != nil ? value! : (catalogName?.trimmingCharacters(in: .whitespacesAndNewlines).nonempty ?? value ?? "Монета без названия")
    }
}
