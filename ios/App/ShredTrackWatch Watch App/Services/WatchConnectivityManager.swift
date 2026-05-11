import Combine
import Foundation
import WatchConnectivity

// WatchConnectivityManager — owns the `WCSession` on the Watch side.
//
// Flows (native-app spec §4.2 + §5.4):
//   1. Inbound `applicationContext` from the phone — carries the latest
//      Supabase access token so the Watch session stays warm. Token is
//      latest-value-wins, which is what we want.
//   2. Inbound `didReceiveUserInfo` from the phone — carries per-race
//      sync acks. Acks must be delivered independently (two finished
//      races shouldn't race for the same applicationContext slot), so
//      they ride the queued `transferUserInfo` channel.
//   3. Outbound `transferUserInfo` to the phone — carries finished race
//      payloads. We use `transferUserInfo`, NOT `sendMessage`, because
//      it queues automatically when the phone is unreachable and replays
//      on next connection. That's the whole point of the offline-first
//      Watch design.

@MainActor
final class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    @Published private(set) var isReachable: Bool = false

    private let session: WCSession?

    override private init() {
        self.session = WCSession.isSupported() ? WCSession.default : nil
        super.init()
    }

    /// Assigns the delegate and calls `WCSession.activate()`. Both are
    /// non-blocking — the actual pairing handshake runs on WCSession's
    /// internal queues and surfaces through the delegate callbacks —
    /// but we still want callers to dispatch this off the main thread
    /// at launch so that any first-reference initialization of
    /// `WCSession.default` doesn't pile onto the launch critical path.
    func activate() {
        session?.delegate = self
        session?.activate()
    }

    func sendCompletedRace(_ payload: RaceSavePayload, raceLocalId: String) {
        guard let session, session.activationState == .activated else { return }
        do {
            let data = try JSONEncoder().encode(payload)
            let userInfo: [String: Any] = [
                "kind": "race.save",
                "raceLocalId": raceLocalId,
                "payloadJson": String(data: data, encoding: .utf8) ?? "",
            ]
            session.transferUserInfo(userInfo)
        } catch {
            print("[WC] failed to encode race payload: \(error)")
        }
    }
}

extension WatchConnectivityManager: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error {
            print("[WC] activation error: \(error)")
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        let reachable = session.isReachable
        Task { @MainActor in
            self.isReachable = reachable
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        Task { @MainActor in
            self.handleApplicationContext(applicationContext)
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        Task { @MainActor in
            self.handleUserInfo(userInfo)
        }
    }

    @MainActor
    private func handleApplicationContext(_ ctx: [String: Any]) {
        // Token push from the phone.
        if
            let token = ctx["accessToken"] as? String,
            let userId = ctx["userId"] as? String
        {
            let expiresAt = (ctx["expiresAt"] as? Double).map {
                Date(timeIntervalSince1970: $0)
            }
            AuthSession.shared.updateFromPhone(
                accessToken: token,
                userId: userId,
                expiresAt: expiresAt
            )
        }

        // Sign-out push from the phone.
        if ctx["signOut"] as? Bool == true {
            AuthSession.shared.clear()
        }
    }

    @MainActor
    private func handleUserInfo(_ userInfo: [String: Any]) {
        guard userInfo["kind"] as? String == "race.ack" else { return }
        if let ackedId = userInfo["ackedRaceLocalId"] as? String {
            PendingRaceQueue.shared.clear(localId: ackedId)
        }
    }
}
