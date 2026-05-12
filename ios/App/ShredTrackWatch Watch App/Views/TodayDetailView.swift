import SwiftUI

// TodayDetailView — full per-card detail. v1 is read-only; the primary
// action is "Open on iPhone" which sends a WCSession message that the
// iOS shell forwards to the WebView for deep linking.

struct TodayDetailView: View {
    enum Kind {
        case hyrox(TodaySnapshot.HyroxSessionRow, week: Int?)
        case crossfit(TodaySnapshot.CrossfitWorkoutRow)
        case recovery(TodaySnapshot.RecoveryItemRow)
    }

    let kind: Kind

    @EnvironmentObject private var conn: WatchConnectivityManager
    @State private var didTryOpen: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                titleBlock
                Divider()
                bodyBlock

                Button {
                    didTryOpen = true
                    let (type, id) = identifier
                    conn.sendOpenItem(type: type, id: id)
                } label: {
                    Label("Open on iPhone", systemImage: "iphone")
                }
                .buttonStyle(.borderedProminent)

                if didTryOpen && !conn.isReachable {
                    Text("Open the ShredTrack iPhone app to log this.")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    @ViewBuilder
    private var titleBlock: some View {
        switch kind {
        case .hyrox(let row, let week):
            VStack(alignment: .leading, spacing: 2) {
                Label("HYROX", systemImage: "figure.run")
                    .font(.caption2)
                    .foregroundStyle(.green)
                Text(row.title).font(.headline)
                if let week {
                    Text("Week \(week)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        case .crossfit(let row):
            VStack(alignment: .leading, spacing: 2) {
                Label("CrossFit", systemImage: "dumbbell")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                Text(row.title).font(.headline)
                if !row.communityName.isEmpty {
                    Text(row.communityName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        case .recovery(let row):
            VStack(alignment: .leading, spacing: 2) {
                Label("Recovery", systemImage: "figure.mind.and.body")
                    .font(.caption2)
                    .foregroundStyle(.blue)
                Text(row.scheduleName).font(.headline)
            }
        }
    }

    @ViewBuilder
    private var bodyBlock: some View {
        switch kind {
        case .hyrox(let row, _):
            Text(row.summary.isEmpty ? "Tap to open on iPhone." : row.summary)
                .font(.caption)
        case .crossfit(let row):
            Text(row.summary.isEmpty ? "Tap to open on iPhone." : row.summary)
                .font(.caption)
        case .recovery(let row):
            Text(row.slotsSummary)
                .font(.caption)
        }
    }

    private var identifier: (type: String, id: String) {
        switch kind {
        case .hyrox(let row, _):
            return ("hyrox", row.sessionId)
        case .crossfit(let row):
            return ("crossfit", row.workoutId)
        case .recovery(let row):
            return ("recovery", row.scheduleId)
        }
    }
}
