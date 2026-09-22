import SwiftUI

enum NumiSection: String, CaseIterable {
    case collection, catalog, overview, profile
}

struct NumiSectionButton: View {
    let section: NumiSection
    let current: NumiSection
    let title: String
    let icon: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 21, weight: .medium))
                Text(title).font(.caption2).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .foregroundColor(current == section ? Cabinet.copper : Cabinet.muted)
        }
        .accessibilityIdentifier("tab.\(section.rawValue)")
    }
}

struct NumiBottomBar: View {
    @Binding var section: NumiSection
    let add: () -> Void
    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            NumiSectionButton(section: .collection, current: section, title: "Монеты", icon: "square.grid.2x2") { section = .collection }
            NumiSectionButton(section: .catalog, current: section, title: "Каталог", icon: "book.closed") { section = .catalog }
            Button(action: add) {
                Image(systemName: "plus").font(.system(size: 26, weight: .medium))
                    .frame(width: 58, height: 58).background(Cabinet.copper)
                    .foregroundColor(Cabinet.background).clipShape(Circle())
                    .shadow(color: Color.black.opacity(0.35), radius: 10, y: 4)
            }
            .frame(maxWidth: .infinity)
            .offset(y: -7)
            .accessibilityLabel("Добавить монету")
            .accessibilityIdentifier("album.add")
            NumiSectionButton(section: .overview, current: section, title: "Обзор", icon: "chart.bar.fill") { section = .overview }
            NumiSectionButton(section: .profile, current: section, title: "Профиль", icon: "person") { section = .profile }
        }
        .padding(.horizontal, 8).padding(.top, 9).padding(.bottom, 5)
        .background(Cabinet.panel)
        .overlay(Divider(), alignment: .top)
    }
}

struct NumiActionRow: View {
    let title: String
    var detail: String? = nil
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).foregroundColor(Cabinet.ivory)
                    if let detail = detail?.nonempty { Text(detail).font(.caption).foregroundColor(Cabinet.muted) }
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundColor(Cabinet.muted)
            }.padding(.vertical, 13)
        }.buttonStyle(.plain)
    }
}

struct NumiFact: View {
    let label: String
    let value: String?
    var body: some View {
        if let value = value?.nonempty {
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                Text(label).foregroundColor(Cabinet.muted).frame(maxWidth: .infinity, alignment: .leading)
                Text(value).frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
            }.font(.callout).padding(.vertical, 5)
        }
    }
}

struct AuthenticatedRemoteImage: View {
    let api: NumiAPI
    let address: String
    @State private var image: UIImage?
    @State private var failed = false
    var body: some View {
        ZStack {
            Cabinet.panel
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else if failed { Image(systemName: "photo").foregroundColor(Cabinet.muted) }
            else { ProgressView() }
        }.task(id: address) {
            do { image = UIImage(data: try await api.imageData(address)) }
            catch { failed = true }
        }
    }
}
