import WatchKit

// Activates WatchConnectivity at launch so the phone can push tokens
// before the user even opens the auth-aware tabs. Without this the
// session check would race the WC handshake on first launch.

final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        WatchConnectivityManager.shared.activate()
        AuthSession.shared.loadFromKeychain()
    }
}
