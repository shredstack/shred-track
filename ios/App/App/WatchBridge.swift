import Foundation
import Capacitor
import WatchConnectivity

// WatchBridge — Capacitor plugin that exposes the iOS-side
// WatchConnectivity surface to the JavaScript layer.
//
// The WebView calls these methods via:
//   Capacitor.Plugins.WatchBridge.setToken({ accessToken, expiresAt, userId })
//   Capacitor.Plugins.WatchBridge.clearToken()
//   Capacitor.Plugins.WatchBridge.pushTodaySnapshot({ json })
//   Capacitor.Plugins.WatchBridge.ackRaceSync({ raceLocalId })
//   Capacitor.Plugins.WatchBridge.sendRaceStart({ raceId, divisionKey,
//     template, simulateRoxzone, startAt, segments })
//   Capacitor.Plugins.WatchBridge.sendRaceEvent({ raceId, kind, payloadJson })
//
// Token pushes use `WCSession.updateApplicationContext(_:)` (latest
// value wins — fine for a single current token). Race-sync acks use
// `WCSession.transferUserInfo(_:)` because each ack must be delivered
// independently: if the user saves two races offline, an
// applicationContext-based ack for the first would be clobbered by the
// second before the Watch ever sees it.
//
// In-race events (`sendRaceEvent`) prefer `sendMessage` for low-latency
// delivery while the watch app is in the foreground, with a
// `transferUserInfo` fallback when the watch is not reachable so a tap
// is never silently lost.

@objc(WatchBridge)
public class WatchBridge: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchBridge"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackRaceSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushTodaySnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendRaceStart", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendRaceEvent", returnType: CAPPluginReturnPromise),
    ]

    private var session: WCSession?

    /// Last-known context keys. Merged across `setToken` / `clearToken` /
    /// `pushTodaySnapshot` / `sendRaceStart` calls so that:
    ///   1. If a call arrives before `WCSession` finishes activating, we
    ///      can flush the pending context once `activationDidCompleteWith`
    ///      fires with `.activated` instead of dropping it on the floor.
    ///      (Without this queueing, the very common case "user signed in
    ///      on phone before the WCSession handshake completed" results in
    ///      the Watch never seeing the token — `updateApplicationContext`
    ///      throws when called pre-activation, and the JS bootstrap
    ///      `void`s the promise so the rejection is invisible.)
    ///   2. A later partial update (e.g. just `todaySnapshot`) doesn't
    ///      wipe the existing token from the Watch's view of the context.
    ///      `WCSession.updateApplicationContext` is whole-dictionary
    ///      replace; merging preserves prior keys.
    private var lastContext: [String: Any] = [:]
    private let contextLock = NSLock()

    public override func load() {
        guard WCSession.isSupported() else { return }
        session = WCSession.default
        session?.delegate = self
        session?.activate()
    }

    /// Merges keys into `lastContext` (set or remove) and pushes the
    /// merged dictionary to the Watch if the session is already
    /// activated. If not, the next `activationDidCompleteWith(.activated)`
    /// will flush the merged context.
    private func updateContext(
        sets: [String: Any] = [:],
        removes: [String] = [],
        from caller: String
    ) -> Result<Void, Error> {
        contextLock.lock()
        for (k, v) in sets { lastContext[k] = v }
        for k in removes { lastContext.removeValue(forKey: k) }
        let snapshot = lastContext
        contextLock.unlock()

        guard let session, session.activationState == .activated else {
            print("[WatchBridge] \(caller): WCSession not activated yet — queued, will flush on activation")
            return .success(())
        }
        do {
            try session.updateApplicationContext(snapshot)
            return .success(())
        } catch {
            print("[WatchBridge] \(caller): updateApplicationContext failed: \(error.localizedDescription)")
            return .failure(error)
        }
    }

    @objc func setToken(_ call: CAPPluginCall) {
        guard
            let accessToken = call.getString("accessToken"),
            let userId = call.getString("userId")
        else {
            call.reject("Missing accessToken or userId")
            return
        }
        let expiresAt = call.getDouble("expiresAt")

        var sets: [String: Any] = [
            "accessToken": accessToken,
            "userId": userId,
        ]
        if let expiresAt {
            sets["expiresAt"] = expiresAt
        }
        // Drop any prior sign-out flag — the user is signed back in.
        let removes: [String] = ["signOut"]

        switch updateContext(sets: sets, removes: removes, from: "setToken") {
        case .success: call.resolve()
        case .failure(let error):
            call.reject("Failed to push to Watch: \(error.localizedDescription)")
        }
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        // Wipe the cached token keys and set the sign-out flag so the
        // Watch's handleApplicationContext path clears AuthSession on
        // next delivery.
        switch updateContext(
            sets: ["signOut": true],
            removes: ["accessToken", "userId", "expiresAt"],
            from: "clearToken"
        ) {
        case .success: call.resolve()
        case .failure(let error):
            call.reject("Failed to push sign-out to Watch: \(error.localizedDescription)")
        }
    }

    /// Optional optimization (spec §3.2 step 5 / §5.2): after a score-log
    /// mutation succeeds in the WebView, push the freshly assembled
    /// "today" snapshot to the Watch so the green checkmark flips within
    /// seconds instead of waiting for the Watch's next pull-to-refresh.
    ///
    /// Snapshot is sent as a JSON **string** — `updateApplicationContext`
    /// requires plist-safe types and the nested structure is easier to
    /// round-trip as text. The Watch decodes it on receipt.
    @objc func pushTodaySnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing json"); return
        }
        switch updateContext(sets: ["todaySnapshot": json], from: "pushTodaySnapshot") {
        case .success: call.resolve()
        case .failure(let error):
            call.reject("Failed to push snapshot: \(error.localizedDescription)")
        }
    }

    @objc func ackRaceSync(_ call: CAPPluginCall) {
        guard let raceLocalId = call.getString("raceLocalId") else {
            call.reject("Missing raceLocalId")
            return
        }
        session?.transferUserInfo([
            "kind": "race.ack",
            "ackedRaceLocalId": raceLocalId,
        ])
        call.resolve()
    }

    // MARK: - Bidirectional race sync

    /// Phone → Watch: hand off a freshly-started race so the watch app
    /// can adopt it and start showing the same countdown + clock.
    /// Delivered via `updateApplicationContext` (whole-snapshot,
    /// latest-value-wins) so a stale in-flight "start" can't clobber a
    /// fresher one. The watch reads the snapshot under the
    /// `pendingRaceStart` key on receipt.
    @objc func sendRaceStart(_ call: CAPPluginCall) {
        guard let raceId = call.getString("raceId") else {
            call.reject("Missing raceId"); return
        }
        // Serialize the start payload as JSON inside the context so we
        // don't have to flatten/unflatten plist-incompatible structures.
        var startPayload: [String: Any] = [
            "raceId": raceId,
            "divisionKey": call.getString("divisionKey") ?? "women_open",
            "template": call.getString("template") ?? "full",
            "simulateRoxzone": call.getBool("simulateRoxzone") ?? false,
            "startAt": call.getDouble("startAt") ?? Double(Date().timeIntervalSince1970 * 1000),
            "originDevice": "phone",
        ]
        if let segments = call.getArray("segments") {
            // Round-trip via JSONSerialization to strip non-plist types
            // before stuffing the JSON-string into the context.
            if let data = try? JSONSerialization.data(withJSONObject: segments) {
                startPayload["segmentsJson"] = String(data: data, encoding: .utf8) ?? "[]"
            }
        }
        guard let payloadData = try? JSONSerialization.data(withJSONObject: startPayload),
              let payloadString = String(data: payloadData, encoding: .utf8)
        else {
            call.reject("Failed to encode race start payload"); return
        }
        switch updateContext(
            sets: ["pendingRaceStart": payloadString],
            from: "sendRaceStart"
        ) {
        case .success: call.resolve()
        case .failure(let error):
            call.reject("Failed to send race start: \(error.localizedDescription)")
        }
    }

    /// Phone → Watch: live race event (split / pause / resume / finish /
    /// cancel / enrichment). Prefer `sendMessage` for low-latency
    /// delivery while both apps are in the foreground; fall back to
    /// `transferUserInfo` when the watch isn't reachable so a tap can't
    /// be silently lost during a brief connectivity dip.
    @objc func sendRaceEvent(_ call: CAPPluginCall) {
        guard
            let raceId = call.getString("raceId"),
            let kind = call.getString("kind"),
            let payloadJson = call.getString("payloadJson")
        else {
            call.reject("Missing raceId, kind, or payloadJson")
            return
        }
        let message: [String: Any] = [
            "kind": kind,
            "raceId": raceId,
            "payloadJson": payloadJson,
        ]
        guard let session, session.activationState == .activated else {
            print("[WatchBridge] sendRaceEvent: WCSession not activated — dropping \(kind)")
            call.resolve()
            return
        }
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { error in
                print("[WatchBridge] sendMessage(\(kind)) failed: \(error.localizedDescription) — falling back to transferUserInfo")
                session.transferUserInfo(message)
            }
        } else {
            session.transferUserInfo(message)
        }

        // Clear `pendingRaceStart` from the applicationContext when the
        // race ends. Otherwise the stale start would replay on the next
        // watch cold launch — applicationContext is whole-snapshot
        // latest-wins and persists on the watch until overwritten, so a
        // raceId already finished/cancelled here would re-trigger
        // `adoptFromPhone` weeks later and start a phantom race.
        if kind == "race.finish" || kind == "race.cancel" {
            _ = updateContext(removes: ["pendingRaceStart"], from: "sendRaceEvent(\(kind))")
        }

        call.resolve()
    }

    // MARK: - Splits sync from Watch

    public func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        print("[WatchBridge] didReceiveUserInfo keys=\(Array(userInfo.keys)) kind=\(userInfo["kind"] ?? "nil")")
        let kind = userInfo["kind"] as? String

        // Existing race-save flow: watch enqueues finished race for
        // server-side persistence via the JS relay.
        if kind == "race.save",
           let raceLocalId = userInfo["raceLocalId"] as? String,
           let payloadJson = userInfo["payloadJson"] as? String {
            print("[WatchBridge] forwarding splitsFromWatch raceLocalId=\(raceLocalId) bytes=\(payloadJson.count)")
            notifyListeners(
                "splitsFromWatch",
                data: [
                    "raceLocalId": raceLocalId,
                    "payloadJson": payloadJson,
                ]
            )
            return
        }

        // Live race events forwarded from the watch (split, pause,
        // resume, finish, enrichment, start when the user started the
        // race on the watch). Route them through the same JS event so
        // the orchestrator's `setRaceSyncHandlers` handles both
        // delivery modes (sendMessage + transferUserInfo) uniformly.
        if let k = kind, k.hasPrefix("race.") {
            forwardRaceEvent(userInfo)
            return
        }

        print("[WatchBridge] dropping userInfo — unhandled kind=\(kind ?? "nil")")
    }

    /// "Open on iPhone" tap from the Watch's TodayDetailView (spec §6.2).
    /// The Watch sends `{kind: "openItem", type, id}` via sendMessage and
    /// we forward it to the WebView. JS picks the relevant deep link
    /// (e.g. /hyrox/plan/sessions/<id>) and `router.push`es it.
    public func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        let kind = message["kind"] as? String
        if kind == "openItem",
           let type = message["type"] as? String,
           let id = message["id"] as? String {
            DispatchQueue.main.async {
                self.notifyListeners(
                    "openItemFromWatch",
                    data: ["type": type, "id": id]
                )
            }
            return
        }
        if let k = kind, k.hasPrefix("race.") {
            DispatchQueue.main.async {
                self.forwardRaceEvent(message)
            }
            return
        }
    }

    /// Common forwarding helper for watch-originated race events. Both
    /// the `sendMessage` and `transferUserInfo` delegate paths land
    /// here so the JS layer sees a single event regardless of transport.
    private func forwardRaceEvent(_ info: [String: Any]) {
        guard
            let kind = info["kind"] as? String,
            let payloadJson = info["payloadJson"] as? String
        else { return }
        notifyListeners(
            "raceEventFromWatch",
            data: [
                "kind": kind,
                "payloadJson": payloadJson,
            ]
        )
    }

    public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error {
            print("[WatchBridge] activation error: \(error)")
        }
        guard activationState == .activated else { return }

        // Flush any context that arrived before activation completed.
        // This is the common case on cold launch: NativeBootstrap's
        // useEffect runs and calls setToken before WCSession finishes
        // its handshake, so the very first push would otherwise throw
        // and the Watch would never see the token.
        contextLock.lock()
        let pending = lastContext
        contextLock.unlock()
        guard !pending.isEmpty else { return }
        do {
            try session.updateApplicationContext(pending)
            print("[WatchBridge] flushed pending context on activation: keys=\(Array(pending.keys))")
        } catch {
            print("[WatchBridge] flush-on-activation failed: \(error.localizedDescription)")
        }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
}
