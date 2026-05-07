import Foundation

// MARK: - PaceComputation
//
// Pure logic shared between the iOS phone target and the watchOS target.
// No HealthKit imports here — this file does math only. UI and HealthKit
// callers feed it elapsed time + measured distance and read back a
// pace number, then format it via `format(secPerKm:unit:)`.
//
// Mirrors the spec at
// claude_code_instructions/native_app/running_pace_feature_spec.md §6.

public enum PaceUnit: String, Sendable {
    case kilometer
    case mile

    public var suffix: String {
        switch self {
        case .kilometer: return "km"
        case .mile: return "mi"
        }
    }
}

public struct CompletedRunSegment: Sendable {
    public let timeSeconds: Double
    public let distanceMeters: Double

    public init(timeSeconds: Double, distanceMeters: Double) {
        self.timeSeconds = timeSeconds
        self.distanceMeters = distanceMeters
    }
}

public enum PaceComputation {

    /// Current run pace in seconds/km, or nil if not on a run / no
    /// distance covered yet.
    ///
    /// Uses cumulative-from-segment-start rather than a 5s rolling
    /// window — the watch metaphor for "your pace on this segment so
    /// far," matching the spec's recommendation in §9 q2.
    public static func currentRunPaceSecPerKm(
        segmentElapsedSeconds: Double,
        liveDistanceMeters: Double
    ) -> Double? {
        guard liveDistanceMeters > 0, segmentElapsedSeconds > 0 else {
            return nil
        }
        return (segmentElapsedSeconds / liveDistanceMeters) * 1000.0
    }

    /// Average run pace across completed runs in seconds/km, or nil if
    /// no runs are done. Weighted by measured distance per run, not the
    /// division's nominal `runDistanceM` — race courses sometimes vary.
    public static func avgRunPaceSecPerKm(
        completedRuns: [CompletedRunSegment]
    ) -> Double? {
        guard !completedRuns.isEmpty else { return nil }
        let totalSeconds = completedRuns.reduce(0.0) { $0 + $1.timeSeconds }
        let totalMeters = completedRuns.reduce(0.0) { $0 + $1.distanceMeters }
        guard totalMeters > 0 else { return nil }
        return (totalSeconds / totalMeters) * 1000.0
    }

    /// Format `secPerKm` in the user's preferred display unit.
    /// Returns "—" for nil / non-finite / zero values so callers can
    /// drop the result straight into a SwiftUI Text without branching.
    public static func format(secPerKm: Double?, unit: PaceUnit) -> String {
        guard let secPerKm, secPerKm.isFinite, secPerKm > 0 else {
            return "—"
        }
        let perUnit: Double
        switch unit {
        case .kilometer:
            perUnit = secPerKm
        case .mile:
            perUnit = secPerKm * 1.609344
        }
        let minutes = Int(perUnit / 60.0)
        let seconds = Int(perUnit.truncatingRemainder(dividingBy: 60.0).rounded())
        // Handle the rounding edge case where `seconds` rounds up to 60.
        if seconds == 60 {
            return String(format: "%d:00 /%@", minutes + 1, unit.suffix)
        }
        return String(format: "%d:%02d /%@", minutes, seconds, unit.suffix)
    }
}
