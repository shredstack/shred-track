import Foundation

// TodaySnapshot — denormalized "what's programmed today" payload (spec §3.1).
//
// The Watch keeps the latest snapshot in `UserDefaults` between fetches
// and rebuilds it from the three /today endpoints on refresh. The phone
// optionally pushes a fresh snapshot through `WCSession.updateApplica-
// tionContext` after a user logs something on the iPhone, so the Watch's
// "logged ✓" checkmark flips within seconds instead of waiting for the
// next pull-to-refresh.
//
// Fields are deliberately short strings — the Watch UI doesn't need
// `prescription` JSON or per-movement breakdowns. The same shape is
// produced on both the Watch (from raw API JSON in TodayAPIClient) and
// the phone (from the WebView's `pushTodaySnapshotToWatch` helper).

struct TodaySnapshot: Codable, Equatable {
    let date: String          // YYYY-MM-DD (local to whoever assembled it)
    let generatedAt: Int      // seconds since epoch
    let hyrox: HyroxSection
    let crossfit: CrossfitSection
    let recovery: RecoverySection

    struct HyroxSection: Codable, Equatable {
        let planTitle: String?
        let phase: String?
        let week: Int?
        let dayLabel: String?
        let rest: Bool
        let sessions: [HyroxSessionRow]
    }

    struct HyroxSessionRow: Codable, Equatable, Identifiable {
        var id: String { sessionId }
        let sessionId: String
        let sessionType: String
        let title: String
        let summary: String
        let logged: Bool
    }

    struct CrossfitSection: Codable, Equatable {
        let workouts: [CrossfitWorkoutRow]
    }

    struct CrossfitWorkoutRow: Codable, Equatable, Identifiable {
        var id: String { workoutId }
        let workoutId: String
        let title: String
        let summary: String
        let communityName: String
        let logged: Bool
    }

    struct RecoverySection: Codable, Equatable {
        let items: [RecoveryItemRow]
    }

    struct RecoveryItemRow: Codable, Equatable, Identifiable {
        var id: String { scheduleId }
        let scheduleId: String
        let scheduleName: String
        let slotsSummary: String
        /// `scheduled` | `in_progress` | `completed`
        let status: String

        var isCompleted: Bool { status == "completed" }
    }

    /// True when nothing is programmed today and there's nothing for the
    /// athlete to do. Used by the rest-day empty state and to suppress the
    /// midday nudge.
    var isEmptyDay: Bool {
        hyrox.rest && hyrox.sessions.isEmpty
            && crossfit.workouts.isEmpty
            && recovery.items.isEmpty
    }

    /// True when every programmed item is logged/completed. Suppresses the
    /// midday nudge.
    var allLogged: Bool {
        let hyroxDone = hyrox.sessions.allSatisfy { $0.logged }
        let crossfitDone = crossfit.workouts.allSatisfy { $0.logged }
        let recoveryDone = recovery.items.allSatisfy { $0.isCompleted }
        return hyroxDone && crossfitDone && recoveryDone
    }
}
