import WatchKit
import Foundation

// Activates WatchConnectivity at launch so the phone can push tokens
// before the user even opens the auth-aware tabs. Without this the
// session check would race the WC handshake on first launch.
//
// Both `activate()` and `loadFromKeychain()` are dispatched off the
// main thread. On a fresh install the very first Keychain read and the
// first WCSession handshake can each take seconds, and surfacing that
// latency through the main actor caused the first user tap to hang for
// up to 60 s (the WCSession handshake timeout). Prewarming
// `UserDefaults` for the timer keys also avoids first-write churn.

/// Wall-clock time the app finished launching. Used by other modules to
/// log "@<n>s after launch" so we can correlate timing across the
/// keychain, WC activation, and user taps without parsing console
/// timestamps by hand.
enum LaunchClock {
    static var start: Date = .distantPast
    static func sinceLaunch() -> Double {
        Date().timeIntervalSince(start)
    }
}

final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        LaunchClock.start = Date()
        print("[Launch] applicationDidFinishLaunching @0.000s")

        prewarmTimerDefaults()

        Task { @MainActor in
            let wcStart = Date()
            WatchConnectivityManager.shared.activate()
            print(String(
                format: "[Launch] WC activate kicked off @%.3fs (took %.3fs)",
                LaunchClock.sinceLaunch(),
                Date().timeIntervalSince(wcStart)
            ))
        }

        Task.detached(priority: .userInitiated) {
            let kcStart = Date()
            await AuthSession.shared.loadFromKeychain()
            print(String(
                format: "[Launch] Keychain load completed @%.3fs (took %.3fs)",
                LaunchClock.sinceLaunch(),
                Date().timeIntervalSince(kcStart)
            ))
        }

        print(String(
            format: "[Launch] applicationDidFinishLaunching returned @%.3fs",
            LaunchClock.sinceLaunch()
        ))
    }

    // Touch the @AppStorage keys the TimerView reads so the very first
    // tap doesn't trigger a "register default + write" round-trip
    // against an empty defaults plist.
    private func prewarmTimerDefaults() {
        let defaults = UserDefaults.standard
        let keys: [(String, Any)] = [
            ("watch.timer.divisionKey", "women_open"),
            ("watch.timer.template", "full"),
            ("watch.timer.simulateRoxzone", false),
        ]
        for (key, fallback) in keys {
            if defaults.object(forKey: key) == nil {
                defaults.set(fallback, forKey: key)
            }
        }
    }
}
