import SwiftUI

enum Golos {
    static func regular(_ size: CGFloat = 17, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("GolosText-Regular", size: size, relativeTo: style)
    }

    static func label(_ size: CGFloat = 15, relativeTo style: Font.TextStyle = .subheadline) -> Font {
        .custom("GolosText-Medium", size: size, relativeTo: style)
    }

    static func heading(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("GolosText-SemiBold", size: size, relativeTo: style)
    }

    static func wrappedAmount(_ formatted: String) -> String {
        var text = formatted
        for separator in ["\u{00a0}", "\u{202f}", "\u{2007}"] {
            text = text.replacingOccurrences(of: separator, with: " ")
        }
        return text.replacingOccurrences(of: #"(?<=\d)[,.](?=\d)"#,
                                         with: "\u{2060}$0\u{2060}", options: .regularExpression)
    }
}
