import SwiftUI

// ShredTrackWatchApp — entry point for the independent watchOS target.
//
// "Independent" means: timer, splits, pace, persistence all live on the
// wrist. Phone is only the relay for post-race sync. This is the
// commitment in native-app spec §5.1 and the reason the timer keeps
// running even when the phone is in a locker / airplane mode / at home.
//
// As of the Today-view spec (watch_today_view_and_nudges_spec.md §6.1)
// we're back to a three-tab layout: Today / Timer / Settings. The
// previous reason for collapsing to a single TimerView ("Today was a
// placeholder that buried the headline") no longer applies — Today now
// fetches real, daily-changing content directly over HTTPS using the
// cached token the phone pushes.
//
// Default tab is Today: athletes glance at the wrist in the morning to
// see what's programmed. Timer is one swipe away, which is fine — it's
// a deliberate race-only action with its own START button.
//
// Tab style is `.page` (horizontal paging), NOT `.verticalPage`.
// Reason: TodayView wraps its content in a ScrollView. With
// `.verticalPage`, the Digital Crown is captured by the TabView for
// vertical tab switching, which conflicts with the ScrollView's own
// crown-driven scrolling — the result was an app that appeared frozen
// on Today (can't scroll the card list, can't swipe to Timer).
// Horizontal page swipes leave the Crown free for in-page scrolling.

@main
struct ShredTrackWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate
    @StateObject private var session = AuthSession.shared
    @StateObject private var watchConn = WatchConnectivityManager.shared
    @StateObject private var today = TodaySnapshotStore.shared

    @AppStorage("watch.lastTab") private var lastTab: Int = 0

    var body: some Scene {
        WindowGroup {
            TabView(selection: $lastTab) {
                TodayView()
                    .tag(0)
                TimerView()
                    .tag(1)
                SettingsView()
                    .tag(2)
            }
            .tabViewStyle(.page)
            .environmentObject(session)
            .environmentObject(watchConn)
            .environmentObject(today)
        }
    }
}
