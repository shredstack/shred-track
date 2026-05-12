import Foundation
import Capacitor
import WatchConnectivity

// WatchBridge — Capacitor plugin that exposes the iOS-side
// WatchConnectivity surface to the JavaScript layer.
//
// The WebView calls these methods via:
//   Capacitor.Plugins.WatchBridge.setToken({ accessToken, expiresAt, userId })
//   Capacitor.Plugins.WatchBridge.clearToken()
//   Capacitor.Plugins.WatchBridge.relaySplits({ raceLocalId, payloadJson })
//
// Token pushes use `WCSession.updateApplicationContext(_:)` (latest
// value wins — fine for a single current token). Race-sync acks use
// `WCSession.transferUserInfo(_:)` because each ack must be delivered
// independently: if the user saves two races offline, an
// applicationContext-based ack for the first would be clobbered by the
// second before the Watch ever sees it.

@objc(WatchBridge)
public class WatchBridge: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchBridge"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackRaceSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushTodaySnapshot", returnType: CAPPluginReturnPromise),
    ]

    private var session: WCSession?

    /// Last-known context keys. Merged across `setToken` / `clearToken` /
    /// `pushTodaySnapshot` calls so that:
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

    // MARK: - Splits sync from Watch

    public func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        print("[WatchBridge] didReceiveUserInfo keys=\(Array(userInfo.keys)) kind=\(userInfo["kind"] ?? "nil")")
        guard
            userInfo["kind"] as? String == "race.save",
            let raceLocalId = userInfo["raceLocalId"] as? String,
            let payloadJson = userInfo["payloadJson"] as? String
        else {
            print("[WatchBridge] dropping userInfo — not a race.save or missing fields")
            return
        }

        print("[WatchBridge] forwarding splitsFromWatch raceLocalId=\(raceLocalId) bytes=\(payloadJson.count)")
        // Forward the payload to the JS layer. The JS handler does the
        // bearer-auth POST and then calls back into a future
        // `WatchBridge.ackRaceSync(raceLocalId)` method to clear the
        // pending save on the Watch. For the v1 ship the WebView listens
        // on a custom event:
        notifyListeners(
            "splitsFromWatch",
            data: [
                "raceLocalId": raceLocalId,
                "payloadJson": payloadJson,
            ]
        )
    }

    /// "Open on iPhone" tap from the Watch's TodayDetailView (spec §6.2).
    /// The Watch sends `{kind: "openItem", type, id}` via sendMessage and
    /// we forward it to the WebView. JS picks the relevant deep link
    /// (e.g. /hyrox/plan/sessions/<id>) and `router.push`es it.
    public func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any]
    ) {
        guard
            message["kind"] as? String == "openItem",
            let type = message["type"] as? String,
            let id = message["id"] as? String
        else { return }
        DispatchQueue.main.async {
            self.notifyListeners(
                "openItemFromWatch",
                data: ["type": type, "id": id]
            )
        }
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
