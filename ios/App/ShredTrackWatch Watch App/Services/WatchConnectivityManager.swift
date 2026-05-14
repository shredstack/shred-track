import Combine
import Foundation
import WatchConnectivity

// WatchConnectivityManager — owns the `WCSession` on the Watch side.
//
// Flows (native-app spec §4.2 + §5.4):
//   1. Inbound `applicationContext` from the phone — carries the latest
//      Supabase access token so the Watch session stays warm. Token is
//      latest-value-wins, which is what we want. Also carries a
//      `pendingRaceStart` payload when the user starts a race on the
//      phone and we want the watch to mirror it.
//   2. Inbound `didReceiveUserInfo` from the phone — carries per-race
//      sync acks and live race events when the watch wasn't reachable
//      at the time of the tap. Acks must be delivered independently
//      (two finished races shouldn't race for the same
//      applicationContext slot), so they ride the queued
//      `transferUserInfo` channel.
//   3. Inbound `didReceiveMessage` from the phone — low-latency
//      delivery for live race events (split/pause/resume/finish) while
//      both apps are foreground-reachable.
//   4. Outbound `transferUserInfo` to the phone — finished race
//      payloads. We use `transferUserInfo`, NOT `sendMessage`, because
//      it queues automatically when the phone is unreachable and replays
//      on next connection. That's the whole point of the offline-first
//      Watch design.
//   5. Outbound race events — prefer `sendMessage` for low-latency
//      delivery; fall back to `transferUserInfo` when the phone isn't
//      reachable so a split tap is never silently lost.

@MainActor
final class WatchConnectivityManager: NSObject, ObservableObject {
    static let shared = WatchConnectivityManager()

    @Published private(set) var isReachable: Bool = false

    /// Owned by `ShredTrackWatchApp` so the inbound handlers can drive
    /// it directly when a `race.start` / live event arrives. Wired up
    /// at app launch.
    weak var raceTimer: RaceTimerViewModel?

    /// Set of race IDs whose `race.start` we've already processed.
    /// Guards against the watch re-applying the same `pendingRaceStart`
    /// every time `didReceiveApplicationContext` fires (which it does
    /// on each app launch with the most recent snapshot).
    private var consumedRaceStartIds: Set<String> = []

    /// Outbound race events that arrived before `WCSession` finished
    /// activating. WCSession activation runs on its own internal queue
    /// and typically completes within hundreds of ms of launch, but the
    /// user can absolutely tap SPLIT during that window — without this
    /// queue the tap would be silently dropped while the local watch
    /// state advanced, leaving the phone permanently a segment behind.
    /// Flushed in `activationDidCompleteWith(.activated)`.
    private var pendingOutboundEvents: [[String: Any]] = []

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

    /// Asks the phone to open a specific Today item — used by the Watch's
    /// "Open on iPhone" button (spec §6.2). Uses `sendMessage` because we
    /// only need delivery while the phone is reachable; if it's not, the
    /// Watch shows a fallback "Open the ShredTrack iPhone app to log
    /// this" hint and bails.
    func sendOpenItem(type: String, id: String) {
        guard
            let session,
            session.activationState == .activated,
            session.isReachable
        else { return }
        session.sendMessage(
            ["kind": "openItem", "type": type, "id": id],
            replyHandler: nil,
            errorHandler: { error in
                print("[WC] openItem failed: \(error)")
            }
        )
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

    // MARK: - Outbound race sync

    /// Watch → Phone: announce a race started on the watch so the phone
    /// adopts it (live mirror) and the user can also tap splits there.
    /// Uses `sendMessage` first for low-latency delivery; falls back to
    /// `transferUserInfo` if the phone isn't currently reachable.
    func sendRaceStart(
        raceId: String,
        divisionKey: String,
        template: String,
        simulateRoxzone: Bool,
        startAt: Date,
        segments: [RaceSegment]
    ) {
        guard let session, session.activationState == .activated else { return }
        let segmentsArr: [Any]
        if let data = try? JSONEncoder().encode(segments),
           let arr = try? JSONSerialization.jsonObject(with: data) as? [Any] {
            segmentsArr = arr
        } else {
            segmentsArr = []
        }
        let startPayload: [String: Any] = [
            "raceId": raceId,
            "divisionKey": divisionKey,
            "template": template,
            "simulateRoxzone": simulateRoxzone,
            "startAt": startAt.timeIntervalSince1970 * 1000,
            "originDevice": "watch",
            "segments": segmentsArr,
        ]
        guard let payloadData = try? JSONSerialization.data(withJSONObject: startPayload),
              let payloadJson = String(data: payloadData, encoding: .utf8)
        else {
            print("[WC] sendRaceStart: failed to encode payload")
            return
        }
        let message: [String: Any] = [
            "kind": "race.start",
            "raceId": raceId,
            "payloadJson": payloadJson,
        ]
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { error in
                print("[WC] sendRaceStart failed: \(error.localizedDescription) — falling back to transferUserInfo")
                session.transferUserInfo(message)
            }
        } else {
            session.transferUserInfo(message)
        }
    }

    /// Watch → Phone: live race event (split/pause/resume/finish/cancel/
    /// enrichment). Same dual-transport strategy as `sendRaceStart`.
    func sendRaceEvent(
        kind: String,
        raceId: String,
        payload: [String: Any]
    ) {
        guard let session else { return }
        var merged = payload
        merged["raceId"] = raceId
        guard let data = try? JSONSerialization.data(withJSONObject: merged),
              let json = String(data: data, encoding: .utf8)
        else {
            print("[WC] sendRaceEvent: failed to encode payload for \(kind)")
            return
        }
        let message: [String: Any] = [
            "kind": kind,
            "raceId": raceId,
            "payloadJson": json,
        ]
        if session.activationState == .activated {
            dispatchOutboundEvent(session: session, message: message)
        } else {
            pendingOutboundEvents.append(message)
        }
    }

    /// Dispatch an outbound race event over WCSession, preferring
    /// `sendMessage` for low-latency delivery and falling back to
    /// `transferUserInfo` (which queues offline) on either unreachable
    /// state or sendMessage error.
    private func dispatchOutboundEvent(session: WCSession, message: [String: Any]) {
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { error in
                let kind = (message["kind"] as? String) ?? "?"
                print("[WC] sendRaceEvent(\(kind)) failed: \(error.localizedDescription) — falling back to transferUserInfo")
                session.transferUserInfo(message)
            }
        } else {
            session.transferUserInfo(message)
        }
    }

    /// Drain any race events queued while WCSession was activating.
    /// Called from the activation-complete delegate callback.
    @MainActor
    private func flushPendingOutboundEvents() {
        guard let session, session.activationState == .activated else { return }
        let queued = pendingOutboundEvents
        pendingOutboundEvents.removeAll()
        for message in queued {
            dispatchOutboundEvent(session: session, message: message)
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
        if activationState == .activated {
            Task { @MainActor in
                self.flushPendingOutboundEvents()
            }
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

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        Task { @MainActor in
            self.handleIncomingMessage(message)
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
            TodaySnapshotStore.shared.clear()
        }

        // Opportunistic Today snapshot push from the phone (spec §3.2
        // step 5). Phone assembles the same shape the Watch would
        // assemble from the three /today endpoints, so the Watch can
        // skip the HTTP round-trip and flip "logged ✓" within seconds
        // of the user logging on the iPhone.
        if let snapshotJson = ctx["todaySnapshot"] as? String {
            TodaySnapshotStore.shared.ingestFromApplicationContext(snapshotJson)
        }

        // Phone-initiated race start (bidirectional sync). The phone
        // packs the race definition + startAt into a JSON string on
        // `pendingRaceStart` so we can adopt it without bespoke
        // serializer infra. Apply at most once per raceId so cold
        // launches don't re-adopt a stale race.
        if let pendingJson = ctx["pendingRaceStart"] as? String,
           let data = pendingJson.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            applyRaceStart(obj, originDeviceLabel: "phone")
        }
    }

    @MainActor
    private func handleUserInfo(_ userInfo: [String: Any]) {
        let kind = userInfo["kind"] as? String
        if kind == "race.ack",
           let ackedId = userInfo["ackedRaceLocalId"] as? String {
            PendingRaceQueue.shared.clear(localId: ackedId)
            return
        }
        if let k = kind, k.hasPrefix("race.") {
            applyRaceEvent(kind: k, userInfo: userInfo)
            return
        }
    }

    @MainActor
    private func handleIncomingMessage(_ message: [String: Any]) {
        guard let kind = message["kind"] as? String else { return }
        if kind.hasPrefix("race.") {
            applyRaceEvent(kind: kind, userInfo: message)
        }
    }

    /// Apply a `race.start` from the phone (live mirror). Idempotent
    /// per raceId.
    @MainActor
    private func applyRaceStart(_ payload: [String: Any], originDeviceLabel: String) {
        guard let raceId = payload["raceId"] as? String else { return }
        if consumedRaceStartIds.contains(raceId) { return }
        consumedRaceStartIds.insert(raceId)

        guard let timer = raceTimer else { return }
        let divisionKey = payload["divisionKey"] as? String ?? "women_open"
        let templateRaw = payload["template"] as? String ?? "full"
        let template = RaceTemplate(rawValue: templateRaw) ?? .full
        let simulateRoxzone = payload["simulateRoxzone"] as? Bool ?? false
        let startAtMs = payload["startAt"] as? Double ?? Date().timeIntervalSince1970 * 1000
        let startAt = Date(timeIntervalSince1970: startAtMs / 1000)

        // Decode segments. Two encodings are supported: a nested array
        // (used by the phone bridge) or a top-level `segmentsJson`
        // string. Empty array means "fall back to factory defaults".
        var segments: [RaceSegment] = []
        if let arr = payload["segments"] as? [[String: Any]] {
            segments = decodeSegments(arr)
        } else if let segmentsJson = payload["segmentsJson"] as? String,
                  let data = segmentsJson.data(using: .utf8),
                  let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            segments = decodeSegments(arr)
        }
        if segments.isEmpty {
            switch template {
            case .full:
                segments = RaceSegmentFactory.buildFullRace(
                    divisionKey: divisionKey,
                    simulateRoxzone: simulateRoxzone
                )
            case .half:
                segments = RaceSegmentFactory.buildHalfRace(
                    divisionKey: divisionKey,
                    simulateRoxzone: simulateRoxzone
                )
            }
        }

        Task { @MainActor in
            await timer.adoptFromPhone(
                raceId: raceId,
                divisionKey: divisionKey,
                template: template,
                simulateRoxzone: simulateRoxzone,
                startAt: startAt,
                segments: segments
            )
        }
    }

    /// Apply a live race event (split/pause/resume/finish/cancel/
    /// enrichment) from the phone.
    @MainActor
    private func applyRaceEvent(kind: String, userInfo: [String: Any]) {
        // `race.start` arriving via message/userInfo (rather than
        // applicationContext) — used by the dual-transport fallback.
        if kind == "race.start" {
            if let payloadJson = userInfo["payloadJson"] as? String,
               let data = payloadJson.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                applyRaceStart(obj, originDeviceLabel: "phone")
            }
            return
        }

        guard let payloadJson = userInfo["payloadJson"] as? String,
              let data = payloadJson.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let raceId = payload["raceId"] as? String,
              let timer = raceTimer
        else { return }

        switch kind {
        case "race.split":
            let segmentOrder = payload["segmentOrder"] as? Int ?? 0
            let completedAtMs = payload["completedAt"] as? Double ?? 0
            let originRaw = payload["originDevice"] as? String ?? "phone"
            let origin = RaceSource(rawValue: originRaw) ?? .phone
            let distance = payload["distanceMeters"] as? Int
            timer.applyRemoteSplit(
                raceId: raceId,
                segmentOrder: segmentOrder,
                completedAt: Date(timeIntervalSince1970: completedAtMs / 1000),
                originDevice: origin,
                distanceMeters: distance
            )
        case "race.split.enrich":
            // The watch is where pace lives — it produces enrichments
            // but does not normally consume them. No-op.
            break
        case "race.pause":
            let atMs = payload["at"] as? Double ?? 0
            timer.applyRemotePause(
                raceId: raceId,
                at: Date(timeIntervalSince1970: atMs / 1000)
            )
        case "race.resume":
            let atMs = payload["at"] as? Double ?? 0
            timer.applyRemoteResume(
                raceId: raceId,
                at: Date(timeIntervalSince1970: atMs / 1000)
            )
        case "race.finish":
            let atMs = payload["at"] as? Double ?? 0
            timer.applyRemoteFinish(
                raceId: raceId,
                at: Date(timeIntervalSince1970: atMs / 1000)
            )
        case "race.cancel":
            timer.applyRemoteCancel(raceId: raceId)
        default:
            break
        }
    }

    private func decodeSegments(_ arr: [[String: Any]]) -> [RaceSegment] {
        arr.compactMap { dict -> RaceSegment? in
            guard
                let typeRaw = dict["segmentType"] as? String,
                let type = SegmentType(rawValue: typeRaw),
                let label = dict["label"] as? String
            else { return nil }
            let subtype: SegmentSubtype?
            if let s = dict["segmentSubtype"] as? String {
                subtype = SegmentSubtype(rawValue: s)
            } else {
                subtype = nil
            }
            return RaceSegment(
                id: (dict["id"] as? String) ?? UUID().uuidString,
                segmentType: type,
                segmentSubtype: subtype,
                label: label,
                distanceMeters: dict["distanceMeters"] as? Int,
                reps: dict["reps"] as? Int,
                weightLabel: dict["weightLabel"] as? String
            )
        }
    }
}
