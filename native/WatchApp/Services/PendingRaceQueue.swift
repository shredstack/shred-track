import Foundation

// PendingRaceQueue — local-first storage for finished races on the
// Watch.
//
// Per native-app spec §5.4: the timer must never lose a race because
// the phone wasn't around at the finish line. On `Finish`, the Watch
// writes the race to disk as a "pending save" before doing anything
// else. The save survives app termination, Watch reboot, and battery
// death + recharge.
//
// Sync happens via `WCSession.transferUserInfo` (queued, replays on
// reachability) and is acked by the phone via `applicationContext`.
//
// Implementation: each pending save is a JSON file in the app's
// Documents directory keyed by a local UUID. We retry-resend everything
// in the queue every time WC reachability flips on.

@MainActor
final class PendingRaceQueue: ObservableObject {
    static let shared = PendingRaceQueue()

    @Published private(set) var pending: [String] = []

    private let directory: URL = {
        let docs = FileManager.default.urls(
            for: .documentDirectory,
            in: .userDomainMask
        )[0]
        let dir = docs.appendingPathComponent("PendingRaces", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    private init() {
        refresh()
    }

    func enqueue(_ payload: RaceSavePayload) -> String {
        let localId = UUID().uuidString
        let url = directory.appendingPathComponent("\(localId).json")
        do {
            let data = try JSONEncoder().encode(payload)
            try data.write(to: url, options: [.atomic])
        } catch {
            print("[PendingQueue] failed to write \(localId): \(error)")
        }
        refresh()
        WatchConnectivityManager.shared.sendCompletedRace(payload, raceLocalId: localId)
        return localId
    }

    func resendAll() {
        for localId in pending {
            let url = directory.appendingPathComponent("\(localId).json")
            guard
                let data = try? Data(contentsOf: url),
                let payload = try? JSONDecoder().decode(RaceSavePayload.self, from: data)
            else { continue }
            WatchConnectivityManager.shared.sendCompletedRace(payload, raceLocalId: localId)
        }
    }

    func clear(localId: String) {
        let url = directory.appendingPathComponent("\(localId).json")
        try? FileManager.default.removeItem(at: url)
        refresh()
    }

    private func refresh() {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        pending = files
            .filter { $0.hasSuffix(".json") }
            .map { String($0.dropLast(".json".count)) }
            .sorted()
    }
}
