import Foundation

// MARK: - RaceModels
//
// Shared race data models — used by both the iOS phone target (when the
// phone runs the timer) and the watchOS target. Mirrors the TS model in
// `src/components/hyrox/race-timer/types.ts` and
// `src/components/hyrox/race-timer/race-segments.ts`.
//
// Network sync: `Codable` so we can write to Watch storage,
// `WCSession.transferUserInfo`, and the `POST /api/hyrox/practice-races`
// endpoint without bespoke serializers.

public enum SegmentType: String, Codable, Sendable {
    case run
    case station
}

public enum SegmentSubtype: String, Codable, Sendable {
    case prescribedRun = "prescribed_run"
    case roxzone
}

public struct RaceSegment: Codable, Identifiable, Sendable {
    public let id: String
    public let segmentType: SegmentType
    public let segmentSubtype: SegmentSubtype?
    public let label: String
    public let distanceMeters: Int?
    public let reps: Int?
    public let weightLabel: String?

    public init(
        id: String = UUID().uuidString,
        segmentType: SegmentType,
        segmentSubtype: SegmentSubtype? = nil,
        label: String,
        distanceMeters: Int? = nil,
        reps: Int? = nil,
        weightLabel: String? = nil
    ) {
        self.id = id
        self.segmentType = segmentType
        self.segmentSubtype = segmentSubtype
        self.label = label
        self.distanceMeters = distanceMeters
        self.reps = reps
        self.weightLabel = weightLabel
    }
}

public struct CompletedSegment: Codable, Identifiable, Sendable {
    public let id: String
    public let segmentOrder: Int
    public let segmentType: SegmentType
    public let segmentSubtype: SegmentSubtype?
    public let label: String
    public let timeSeconds: Double
    /// Measured distance from HealthKit. Run segments only; nil for
    /// stations and for any segment captured before the pace feature
    /// shipped (web-saved races stay nil too).
    public let distanceMeters: Int?
    public let reps: Int?

    public init(
        id: String = UUID().uuidString,
        segmentOrder: Int,
        segmentType: SegmentType,
        segmentSubtype: SegmentSubtype? = nil,
        label: String,
        timeSeconds: Double,
        distanceMeters: Int? = nil,
        reps: Int? = nil
    ) {
        self.id = id
        self.segmentOrder = segmentOrder
        self.segmentType = segmentType
        self.segmentSubtype = segmentSubtype
        self.label = label
        self.timeSeconds = timeSeconds
        self.distanceMeters = distanceMeters
        self.reps = reps
    }
}

public enum RaceTimerStatus: String, Codable, Sendable {
    case idle
    case countdown
    case running
    case paused
    case complete
}

/// Which device originally started the current race. Save authority
/// stays with the origin device — the other side is a live mirror.
public enum RaceSource: String, Codable, Sendable {
    case phone
    case watch
}

/// Snapshot of an in-progress or completed race. Persisted to Watch
/// local storage; sent up to the server via `transferUserInfo` once the
/// phone is reachable.
public struct RaceState: Codable, Sendable {
    /// Stable identifier for the race, shared between phone and watch.
    /// Used to dedupe sync events and decide save authority. Nil while
    /// idle.
    public var raceId: String?
    /// Which device started this race.
    public var source: RaceSource?
    public var divisionKey: String
    public var template: String  // "full" | "half"
    public var planSessionId: String?
    public var segments: [RaceSegment]
    public var completedSegments: [CompletedSegment]
    public var currentSegmentIndex: Int
    public var status: RaceTimerStatus
    public var raceStartedAt: Date?
    /// When the running clock should begin. While status == .countdown
    /// this is in the future; the view-model transitions to .running
    /// automatically when the deadline passes.
    public var countdownEndsAt: Date?
    public var pausedAt: Date?
    public var totalPausedMs: Double
    /// Pending-save flag: true once the user taps Finish but the phone
    /// hasn't acked the splits sync yet. Cleared by the phone-relay ack.
    public var pendingSync: Bool

    public init(
        raceId: String? = nil,
        source: RaceSource? = nil,
        divisionKey: String = "women_open",
        template: String = "full",
        planSessionId: String? = nil,
        segments: [RaceSegment] = [],
        completedSegments: [CompletedSegment] = [],
        currentSegmentIndex: Int = 0,
        status: RaceTimerStatus = .idle,
        raceStartedAt: Date? = nil,
        countdownEndsAt: Date? = nil,
        pausedAt: Date? = nil,
        totalPausedMs: Double = 0,
        pendingSync: Bool = false
    ) {
        self.raceId = raceId
        self.source = source
        self.divisionKey = divisionKey
        self.template = template
        self.planSessionId = planSessionId
        self.segments = segments
        self.completedSegments = completedSegments
        self.currentSegmentIndex = currentSegmentIndex
        self.status = status
        self.raceStartedAt = raceStartedAt
        self.countdownEndsAt = countdownEndsAt
        self.pausedAt = pausedAt
        self.totalPausedMs = totalPausedMs
        self.pendingSync = pendingSync
    }
}

// MARK: - Server payloads

public struct SplitPayload: Codable, Sendable {
    public let segmentOrder: Int
    public let segmentType: String
    public let segmentSubtype: String?
    public let segmentLabel: String
    public let timeSeconds: Double
    public let distanceMeters: Int?
    public let reps: Int?
}

public struct RaceSavePayload: Codable, Sendable {
    /// Client-supplied race id, shared between phone and watch from the
    /// moment a race starts. Sent so the server can dedupe across
    /// watch + phone saves of the same race (the server enforces
    /// UNIQUE on user_id + client_race_id). Nil for legacy queue
    /// entries that pre-date this field.
    public let raceId: String?
    public let title: String
    public let notes: String?
    public let divisionKey: String?
    public let template: String?
    public let raceType: String  // "practice" | "actual"
    public let source: String     // "watch" | "phone" | "web"
    public let planSessionId: String?
    public let totalTimeSeconds: Double
    public let startedAt: String  // ISO-8601
    public let completedAt: String
    public let splits: [SplitPayload]
}
