import SwiftUI

// TodayView — at-a-glance card for today's HYROX, CrossFit, and recovery
// programming. Spec watch_today_view_and_nudges_spec.md §6.2.
//
// Reads come from TodaySnapshotStore, which is fed by either:
//   - TodayAPIClient (Watch-driven HTTP fetch over HTTPS using the cached
//     bearer token), or
//   - The phone's opportunistic snapshot push via WCSession.update-
//     ApplicationContext after a score-log mutation.
//
// Auto-fetch policy (spec §3.2):
//   - On appear, if the cache is missing or older than 5 minutes, fetch.
//   - On pull-to-refresh, force a fetch regardless of cache age.
//   - On reachability flip, fetch if the cache is older than 30 minutes.

struct TodayView: View {
    @EnvironmentObject private var session: AuthSession
    @EnvironmentObject private var conn: WatchConnectivityManager
    @EnvironmentObject private var store: TodaySnapshotStore

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    header
                    content
                }
                .padding(.horizontal, 4)
            }
            .refreshable {
                await store.refreshFromServer()
            }
        }
        .task {
            // Fetch on appear if cache is missing or older than 5 min.
            if !store.isFresh {
                await store.refreshFromServer()
            }
        }
        .onChange(of: conn.isReachable) { _, reachable in
            // Phone just came online — opportunistic refresh if our
            // snapshot is older than 30 minutes (spec §3.2 step 3).
            guard reachable, store.isOlderThan30Min else { return }
            Task { await store.refreshFromServer() }
        }
        .onChange(of: session.accessToken) { _, newValue in
            // A fresh token arrived from the phone. Re-fetch — we may
            // have been showing the "sign-in expired" banner.
            guard newValue != nil else { return }
            Task { await store.refreshFromServer() }
        }
    }

    @ViewBuilder
    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Today")
                .font(.headline)
            Text(formattedDateHeader())
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var content: some View {
        if !session.isSignedIn && store.snapshot == nil {
            TodayCard {
                Text("Open the iPhone app to load today's training.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else if store.lastFetchError == .unauthorized && store.snapshot == nil {
            TodayCard {
                Label("Sign-in expired", systemImage: "iphone.slash")
                    .font(.caption)
                Text("Open ShredTrack on iPhone to refresh.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } else if store.isStaleForDisplay && store.snapshot != nil {
            // Cache is ≥24h old AND fetch hasn't succeeded — better to
            // show an empty state than yesterday's WOD as if it were
            // today's (spec §3.3).
            TodayCard {
                Text("Pull to refresh today's training.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else if let snapshot = store.snapshot {
            sectionCards(for: snapshot)
            footer
        } else if store.isFetching {
            TodayCard {
                ProgressView()
                    .controlSize(.small)
                Text("Loading today…")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        } else {
            TodayCard {
                Text("Pull to load today's training.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func sectionCards(for snapshot: TodaySnapshot) -> some View {
        if snapshot.isEmptyDay {
            TodayCard {
                Text("Nothing scheduled today — enjoy the rest 💪")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else {
            // HYROX
            if !snapshot.hyrox.sessions.isEmpty {
                ForEach(snapshot.hyrox.sessions) { row in
                    NavigationLink {
                        TodayDetailView(kind: .hyrox(row, week: snapshot.hyrox.week))
                    } label: {
                        HyroxRowCard(row: row, week: snapshot.hyrox.week)
                    }
                    .buttonStyle(.plain)
                }
            }

            // CrossFit
            ForEach(snapshot.crossfit.workouts) { row in
                NavigationLink {
                    TodayDetailView(kind: .crossfit(row))
                } label: {
                    CrossfitRowCard(row: row)
                }
                .buttonStyle(.plain)
            }

            // Recovery
            ForEach(snapshot.recovery.items) { row in
                NavigationLink {
                    TodayDetailView(kind: .recovery(row))
                } label: {
                    RecoveryRowCard(row: row)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if store.lastFetchError == .network {
            Text("Couldn't refresh — showing last known.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        } else if store.lastFetchError == .unauthorized {
            Text("Sign-in expired — open iPhone to refresh.")
                .font(.caption2)
                .foregroundStyle(.orange)
        }
    }

    private func formattedDateHeader() -> String {
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        return f.string(from: Date())
    }
}

// MARK: - Row cards

private struct HyroxRowCard: View {
    let row: TodaySnapshot.HyroxSessionRow
    let week: Int?

    var body: some View {
        TodayCard(accent: .green, dimmed: row.logged) {
            HStack(spacing: 4) {
                if row.logged {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption)
                }
                Label("HYROX", systemImage: "figure.run")
                    .font(.caption2)
                    .foregroundStyle(.green)
                if let week {
                    Text("• Wk \(week)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Text(row.title)
                .font(.caption)
                .fontWeight(.semibold)
                .lineLimit(2)
            if !row.summary.isEmpty {
                Text(row.summary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

private struct CrossfitRowCard: View {
    let row: TodaySnapshot.CrossfitWorkoutRow

    var body: some View {
        TodayCard(accent: .orange, dimmed: row.logged) {
            HStack(spacing: 4) {
                if row.logged {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption)
                }
                Label("CrossFit", systemImage: "dumbbell")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                if !row.communityName.isEmpty {
                    Text("• \(row.communityName)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Text(row.title)
                .font(.caption)
                .fontWeight(.semibold)
                .lineLimit(2)
            if !row.summary.isEmpty {
                Text(row.summary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

private struct RecoveryRowCard: View {
    let row: TodaySnapshot.RecoveryItemRow

    var body: some View {
        TodayCard(accent: .blue, dimmed: row.isCompleted) {
            HStack(spacing: 4) {
                if row.isCompleted {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption)
                }
                Label("Recovery", systemImage: "figure.mind.and.body")
                    .font(.caption2)
                    .foregroundStyle(.blue)
            }
            Text(row.scheduleName)
                .font(.caption)
                .fontWeight(.semibold)
                .lineLimit(2)
            Text(row.slotsSummary)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
    }
}

// MARK: - Card chrome

private struct TodayCard<Content: View>: View {
    var accent: Color? = nil
    var dimmed: Bool = false
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 6) {
            if let accent {
                Rectangle()
                    .fill(accent)
                    .frame(width: 3)
            }
            VStack(alignment: .leading, spacing: 4) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.gray.opacity(0.15))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .opacity(dimmed ? 0.6 : 1.0)
    }
}
