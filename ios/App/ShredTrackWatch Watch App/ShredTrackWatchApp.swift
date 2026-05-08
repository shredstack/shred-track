import SwiftUI

// ShredTrackWatchApp — entry point for the independent watchOS target.
//
// "Independent" means: timer, splits, pace, persistence all live on the
// wrist. Phone is only the relay for post-race sync. This is the
// commitment in native-app spec §5.1 and the reason the timer keeps
// running even when the phone is in a locker / airplane mode / at home.
//
// Three top-level tabs (native-app spec §5.2):
//   1. Today — current HYROX session + CrossFit WOD
//   2. Timer — the race timer (the headline feature)
//   3. Settings — sign-in status, notification preferences

@main
struct ShredTrackWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate
    @StateObject private var session = AuthSession.shared
    @StateObject private var watchConn = WatchConnectivityManager.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(watchConn)
        }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Today", systemImage: "calendar") }

            TimerView()
                .tabItem { Label("Timer", systemImage: "timer") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gear") }
        }
    }
}
