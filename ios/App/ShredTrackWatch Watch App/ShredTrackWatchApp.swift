import SwiftUI

// ShredTrackWatchApp — entry point for the independent watchOS target.
//
// "Independent" means: timer, splits, pace, persistence all live on the
// wrist. Phone is only the relay for post-race sync. This is the
// commitment in native-app spec §5.1 and the reason the timer keeps
// running even when the phone is in a locker / airplane mode / at home.
//
// v1 surfaces a single screen — the HYROX race timer — with sign-in /
// phone-reachability tucked behind a toolbar gear in setup. The
// previous three-tab layout (Today / Timer / Settings) defaulted users
// to a "go to your iPhone" placeholder, which buried the headline
// feature. Today / additional features can come back once they have
// real value to deliver standalone on the wrist.

@main
struct ShredTrackWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate
    @StateObject private var session = AuthSession.shared
    @StateObject private var watchConn = WatchConnectivityManager.shared

    var body: some Scene {
        WindowGroup {
            TimerView()
                .environmentObject(session)
                .environmentObject(watchConn)
        }
    }
}
