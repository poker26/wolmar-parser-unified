import SwiftUI

struct RecognitionReferenceView: View {
    let candidate: IdentificationCandidate
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Похожий рисунок").font(.subheadline.weight(.medium)).foregroundColor(Cabinet.copper)
            Text(candidate.catalogReference?.name ?? candidate.name).font(.title3)
            if !candidate.physicalDetails.isEmpty {
                Text(candidate.physicalDetails.joined(separator: " · ")).font(.caption).foregroundColor(Cabinet.muted)
            }
            if let reference = candidate.catalogReference {
                let metadata = [collectionCountry(reference.country), reference.year.map(String.init),
                    reference.denomination, reference.metal, reference.quality].compactMap { $0 }.joined(separator: " · ")
                if !metadata.isEmpty {
                    Text("Выпуск в каталоге · " + metadata).font(.caption).foregroundColor(Cabinet.muted)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).cabinetPanel()
            .accessibilityIdentifier("recognition.reference")
    }
}
