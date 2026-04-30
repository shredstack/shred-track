import SwiftUI

// SettingsView — minimal Watch-side settings (native-app spec §5.2):
//   - sign-in status (mirrors phone)
//   - notification time (defaults to 7am local)
//   - HealthKit permission status
//
// Notification scheduling itself happens on the iOS shell via
// @capacitor/local-notifications (native-app spec §6.3); the Watch
// surfaces the current value so the athlete can sanity-check.

struct SettingsView: View {
    @EnvironmentObject private var session: AuthSession
    @EnvironmentObject private var conn: WatchConnectivityManager
    @StateObject private var hk = HealthKitWorkoutService.shared
    @State private var pendingCount: Int = 0

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                row(label: "Signed in", value: session.isSignedIn ? "Yes" : "No")
                row(
                    label: "Phone",
                    value: conn.isReachable ? "Reachable" : "Unreachable"
                )
                row(label: "Pending sync", value: "\(pendingCount)")
                row(label: "HealthKit", value: hkStatus)

                if pendingCount > 0 {
                    Button("Retry sync") {
                        PendingRaceQueue.shared.resendAll()
                    }
                }
            }
            .padding(.horizontal, 4)
        }
        .onAppear {
            pendingCount = PendingRaceQueue.shared.pending.count
        }
    }

    private var hkStatus: String {
        switch hk.permissionState {
        case .granted: return "Granted"
        case .denied: return "Denied"
        case .notRequested: return "Not asked"
        }
    }

    @ViewBuilder
    private func row(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
        }
    }
}
