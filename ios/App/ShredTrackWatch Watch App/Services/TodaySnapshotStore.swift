import Combine
import Foundation

// TodaySnapshotStore — single source of truth for the Watch's "Today"
// payload. Holds the latest snapshot in @Published state for SwiftUI
// and mirrors it to UserDefaults so it survives app termination.
//
// Two upstreams (spec §3.2):
//   1. Watch-driven HTTP fetch (TodayAPIClient) — primary path.
//   2. Phone push via WCSession.updateApplicationContext — optional
//      optimization triggered after a score/log mutation on the phone.
//
// Both end up in the same place; the view doesn't care which arrived
// first.

@MainActor
final class TodaySnapshotStore: ObservableObject {
    static let shared = TodaySnapshotStore()

    @Published private(set) var snapshot: TodaySnapshot?
    @Published private(set) var lastUpdatedAt: Date?
    @Published private(set) var lastFetchError: FetchError?
    @Published private(set) var isFetching: Bool = false

    enum FetchError: Equatable {
        case unauthorized
        case network
    }

    private let defaults = UserDefaults.standard
    private static let snapshotKey = "watch.today.snapshot.v1"
    private static let updatedAtKey = "watch.today.lastUpdatedAt.v1"

    private init() {
        loadFromUserDefaults()
    }

    /// True when the cached snapshot is for today and was fetched in the
    /// last 5 minutes. Used to gate auto-fetch on TodayView.onAppear so
    /// flipping between tabs doesn't hammer the API.
    var isFresh: Bool {
        guard let updatedAt = lastUpdatedAt else { return false }
        guard let snapshot, snapshot.date == TodayAPIClient.todayLocalDateString()
        else { return false }
        return Date().timeIntervalSince(updatedAt) < 5 * 60
    }

    /// True when the cached snapshot is for an older date OR was last
    /// touched more than 24h ago. Used by the view to switch from
    /// "showing yesterday's data" to a blank state.
    var isStaleForDisplay: Bool {
        guard let snapshot else { return true }
        if snapshot.date != TodayAPIClient.todayLocalDateString() {
            return true
        }
        if let updatedAt = lastUpdatedAt,
           Date().timeIntervalSince(updatedAt) > 24 * 60 * 60 {
            return true
        }
        return false
    }

    /// Whether the cached snapshot is older than 30 minutes. Used to
    /// gate the reachability-change refresh (spec §3.2 step 3).
    var isOlderThan30Min: Bool {
        guard let updatedAt = lastUpdatedAt else { return true }
        return Date().timeIntervalSince(updatedAt) > 30 * 60
    }

    // MARK: - Ingest paths

    /// Called by TodayView when the user pulls-to-refresh or when the
    /// view appears and the cached snapshot is stale.
    func refreshFromServer() async {
        guard !isFetching else { return }
        isFetching = true
        defer { isFetching = false }

        let result = await TodayAPIClient.shared.fetchToday()
        switch result {
        case .success(let snapshot):
            lastFetchError = nil
            ingest(snapshot)
        case .unauthorized:
            lastFetchError = .unauthorized
        case .failure:
            lastFetchError = .network
        }
    }

    /// Called by WatchConnectivityManager when the phone pushes a fresh
    /// snapshot via `updateApplicationContext` (spec §3.2 step 5). The
    /// phone-built snapshot uses the same shape as the Watch-built one
    /// — a shared contract.
    func ingestFromApplicationContext(_ json: String) {
        guard let data = json.data(using: .utf8) else { return }
        guard let snapshot = try? JSONDecoder().decode(TodaySnapshot.self, from: data)
        else {
            print("[TodaySnapshotStore] failed to decode phone-pushed snapshot")
            return
        }
        // Phone push is best-effort: keep the freshest of the two. If
        // the Watch already has a newer one (it fetched seconds ago),
        // don't overwrite.
        if let existing = self.snapshot,
           existing.generatedAt > snapshot.generatedAt {
            return
        }
        ingest(snapshot)
    }

    // MARK: - Persistence

    private func ingest(_ snapshot: TodaySnapshot) {
        self.snapshot = snapshot
        self.lastUpdatedAt = Date()
        persist()
    }

    private func persist() {
        guard let snapshot else { return }
        do {
            let data = try JSONEncoder().encode(snapshot)
            defaults.set(data, forKey: Self.snapshotKey)
            if let lastUpdatedAt {
                defaults.set(lastUpdatedAt.timeIntervalSince1970,
                             forKey: Self.updatedAtKey)
            }
        } catch {
            print("[TodaySnapshotStore] persist failed: \(error)")
        }
    }

    private func loadFromUserDefaults() {
        guard let data = defaults.data(forKey: Self.snapshotKey) else { return }
        if let snapshot = try? JSONDecoder().decode(TodaySnapshot.self, from: data) {
            self.snapshot = snapshot
        }
        let raw = defaults.double(forKey: Self.updatedAtKey)
        if raw > 0 {
            self.lastUpdatedAt = Date(timeIntervalSince1970: raw)
        }
    }

    /// Called when the phone pushes a sign-out — drop both the snapshot
    /// and the persistence record so a future signed-in state doesn't
    /// inherit yesterday's data from another account.
    func clear() {
        snapshot = nil
        lastUpdatedAt = nil
        lastFetchError = nil
        defaults.removeObject(forKey: Self.snapshotKey)
        defaults.removeObject(forKey: Self.updatedAtKey)
    }
}
