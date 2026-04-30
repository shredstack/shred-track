import SwiftUI

// TodayView — at-a-glance card for today's HYROX session and CrossFit
// WOD. Per native-app spec §6.2 + spec §5.2 (Today is one of three
// top-level tabs).
//
// In v1 the Watch fetches both via the phone-relay rather than direct
// HTTPS — keeps auth out of the Watch entirely (native-app spec §5.4
// "Auth on the Watch"). When `WCSession.sendMessage` isn't reachable,
// we show a "reconnect to phone" placeholder. Once direct Watch → Server
// lands in v1.1+, this view starts hitting `/api/hyrox/plan/today` and
// `/api/crossfit/wod/today` on its own.

struct TodayView: View {
    @EnvironmentObject private var session: AuthSession
    @EnvironmentObject private var conn: WatchConnectivityManager
    @State private var isRefreshing = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Today")
                    .font(.headline)

                if !session.isSignedIn {
                    Card {
                        Text("Sign in on your iPhone to see your training today.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    return
                }

                if !conn.isReachable {
                    Card {
                        Label("Phone unreachable", systemImage: "iphone.slash")
                            .font(.caption)
                        Text("Open the ShredTrack iPhone app to refresh today's training.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    return
                }

                Card {
                    Label("HYROX", systemImage: "figure.run")
                        .font(.caption)
                        .foregroundStyle(.green)
                    Text("Today's session loads from your iPhone.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                Card {
                    Label("CrossFit WOD", systemImage: "dumbbell")
                        .font(.caption)
                        .foregroundStyle(.orange)
                    Text("Today's WOD loads from your iPhone.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

private struct Card<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            content
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.gray.opacity(0.15))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
