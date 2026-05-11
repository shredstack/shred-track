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
// On the iOS side, every call funnels through
// `WCSession.updateApplicationContext(_:)` (queued, replays when the
// Watch becomes reachable) — never `sendMessage`, which is the wrong
// primitive for asynchronous, durable updates.

@objc(WatchBridge)
public class WatchBridge: CAPPlugin, CAPBridgedPlugin, WCSessionDelegate {
    public let identifier = "WatchBridge"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackRaceSync", returnType: CAPPluginReturnPromise),
    ]

    private var session: WCSession?

    public override func load() {
        guard WCSession.isSupported() else { return }
        session = WCSession.default
        session?.delegate = self
        session?.activate()
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

        var ctx: [String: Any] = [
            "accessToken": accessToken,
            "userId": userId,
        ]
        if let expiresAt {
            ctx["expiresAt"] = expiresAt
        }

        do {
            try session?.updateApplicationContext(ctx)
            call.resolve()
        } catch {
            call.reject("Failed to push to Watch: \(error.localizedDescription)")
        }
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        do {
            try session?.updateApplicationContext(["signOut": true])
            call.resolve()
        } catch {
            call.reject("Failed to push sign-out to Watch: \(error.localizedDescription)")
        }
    }

    @objc func ackRaceSync(_ call: CAPPluginCall) {
        guard let raceLocalId = call.getString("raceLocalId") else {
            call.reject("Missing raceLocalId")
            return
        }
        do {
            try session?.updateApplicationContext(["ackedRaceLocalId": raceLocalId])
            call.resolve()
        } catch {
            call.reject("Failed to push race ack to Watch: \(error.localizedDescription)")
        }
    }

    // MARK: - Splits sync from Watch

    public func session(
        _ session: WCSession,
        didReceiveUserInfo userInfo: [String: Any] = [:]
    ) {
        guard
            userInfo["kind"] as? String == "race.save",
            let raceLocalId = userInfo["raceLocalId"] as? String,
            let payloadJson = userInfo["payloadJson"] as? String
        else { return }

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

    public func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        if let error {
            print("[WatchBridge] activation error: \(error)")
        }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}
    public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }
}
