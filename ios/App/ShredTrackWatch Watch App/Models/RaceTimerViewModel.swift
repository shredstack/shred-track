import Foundation
import Combine
import SwiftUI
import WatchKit

// RaceTimerViewModel — the wrist-side state machine for a HYROX race.
//
// Mirrors the TS hook at
// src/components/hyrox/race-timer/use-race-timer.ts but with HealthKit
// integration baked in (the web has no distance signal). State
// transitions:
//
//   idle → running  (start)
//   running → paused (pause)         pause HKWorkoutSession too
//   paused → running (resume)        resume HKWorkoutSession too
//   running → running (split)        snapshot distance for the segment
//   running → complete (finish)      end HKWorkoutSession + persist + queue sync
//
// Per native-app spec §5.1, every method here must work with no phone
// and no network — the only place we hit the network is at finish-time
// via `WCSession.transferUserInfo` (which itself queues offline).

@MainActor
final class RaceTimerViewModel: ObservableObject {
    @Published var state: RaceState
    @Published var segmentElapsedMs: Double = 0
    @Published var totalElapsedMs: Double = 0
    @Published var liveSegmentDistanceMeters: Double = 0
    /// Set true after the user taps Save on the complete screen. Drives
    /// the post-save layout (Syncing/Synced + Done) vs the pre-save
    /// layout (Save / Discard). Cleared on reset/configure.
    @Published var savedThisRace: Bool = false

    private var pendingPayload: RaceSavePayload?
    private var pendingLocalId: String?
    private var queueObserver: AnyCancellable?

    /// Live current pace, sec/km, recomputed off the 1Hz tick.
    var currentRunPaceSecPerKm: Double? {
        guard state.status == .running else { return nil }
        let segIdx = state.currentSegmentIndex
        guard segIdx < state.segments.count else { return nil }
        guard state.segments[segIdx].segmentType == .run else { return nil }
        return PaceComputation.currentRunPaceSecPerKm(
            segmentElapsedSeconds: segmentElapsedMs / 1000.0,
            liveDistanceMeters: liveSegmentDistanceMeters
        )
    }

    var avgRunPaceSecPerKm: Double? {
        // Skip Roxzone runs — they're 100m transition jogs, not training
        // runs. Mirrors the web logic in
        // `src/components/hyrox/race-timer/use-pace-from-healthkit.ts`.
        let runs = state.completedSegments
            .filter { $0.segmentType == .run && $0.segmentSubtype != .roxzone }
            .compactMap { c -> CompletedRunSegment? in
                guard let dist = c.distanceMeters, dist > 0 else { return nil }
                return CompletedRunSegment(
                    timeSeconds: c.timeSeconds,
                    distanceMeters: Double(dist)
                )
            }
        return PaceComputation.avgRunPaceSecPerKm(completedRuns: runs)
    }

    /// 10Hz wall-clock tick. Updates `segmentElapsedMs` /
    /// `totalElapsedMs` only and never awaits HealthKit, so the
    /// on-screen clock can't be frozen by a stalled HK query.
    private var tickTask: Task<Void, Never>?
    /// 1Hz distance refresh. Gated on `hk.isActive` so the HK
    /// statistics-query callback can never block the loop before the
    /// workout session is live (the cause of the wrist-side "timer
    /// doesn't tick" bug we hit when HK init was made parallel).
    private var distanceTask: Task<Void, Never>?
    private var segmentStartedAt: Date?
    private var extendedSession: WKExtendedRuntimeSession?
    private let hk = HealthKitWorkoutService.shared

    init(state: RaceState = RaceState()) {
        self.state = state
    }

    // MARK: - Setup

    func configure(
        divisionKey: String,
        template: RaceTemplate,
        simulateRoxzone: Bool = false,
        planSessionId: String? = nil
    ) {
        let segments: [RaceSegment]
        switch template {
        case .full:
            segments = RaceSegmentFactory.buildFullRace(
                divisionKey: divisionKey,
                simulateRoxzone: simulateRoxzone
            )
        case .half:
            segments = RaceSegmentFactory.buildHalfRace(
                divisionKey: divisionKey,
                simulateRoxzone: simulateRoxzone
            )
        }
        state = RaceState(
            divisionKey: divisionKey,
            template: template.rawValue,
            planSessionId: planSessionId,
            segments: segments,
            status: .idle
        )
        segmentElapsedMs = 0
        totalElapsedMs = 0
        liveSegmentDistanceMeters = 0
        cleanupAfterRace()
    }

    /// Wipes per-race transient state so the next configure/start begins
    /// from a clean slate. Idempotent.
    private func cleanupAfterRace() {
        pendingPayload = nil
        pendingLocalId = nil
        queueObserver?.cancel()
        queueObserver = nil
        savedThisRace = false
        state.pendingSync = false
    }

    // MARK: - Lifecycle

    /// Begin the race. Flips status to `.running` and starts the timer
    /// tick *before* awaiting HealthKit so the UI never appears
    /// unresponsive if HealthKit permission prompts or the workout
    /// session takes a moment to spin up. The timer is the source of
    /// truth — pace just degrades to em-dash if HealthKit is unavailable.
    func start() async {
        let now = Date()
        state.raceStartedAt = now
        segmentStartedAt = now
        liveSegmentDistanceMeters = 0
        state.status = .running
        startExtendedRuntimeSession()
        startTick()
        startDistanceTick()

        // Kick HealthKit off in the background. Any failure (denied
        // permissions, hardware unavailable, simulator) is logged and
        // ignored — pace cells will show "—".
        Task { [weak self] in
            guard let self else { return }
            if await self.hk.permissionState == .notRequested {
                _ = await self.hk.requestPermissions()
            }
            do {
                try await self.hk.start()
            } catch {
                print("[Timer] HealthKit start failed: \(error)")
            }
        }
    }

    func split() {
        guard state.status == .running else { return }
        guard state.currentSegmentIndex < state.segments.count else { return }
        let now = Date()
        let segStart = segmentStartedAt ?? now
        let elapsed = now.timeIntervalSince(segStart)
        let current = state.segments[state.currentSegmentIndex]

        // Snapshot HealthKit distance for this segment window. Stations
        // get nil — pace doesn't apply (pace spec §3).
        let runDistanceMeters: Int?
        if current.segmentType == .run {
            runDistanceMeters = Int(liveSegmentDistanceMeters.rounded())
        } else {
            runDistanceMeters = nil
        }

        let completed = CompletedSegment(
            segmentOrder: state.currentSegmentIndex,
            segmentType: current.segmentType,
            segmentSubtype: current.segmentSubtype,
            label: current.label,
            timeSeconds: elapsed,
            distanceMeters: runDistanceMeters,
            reps: current.reps
        )
        state.completedSegments.append(completed)

        let nextIdx = state.currentSegmentIndex + 1
        WKInterfaceDevice.current().play(.success)
        if nextIdx >= state.segments.count {
            Task { await finish() }
        } else {
            state.currentSegmentIndex = nextIdx
            segmentStartedAt = now
            liveSegmentDistanceMeters = 0
        }
    }

    func pause() {
        guard state.status == .running else { return }
        state.status = .paused
        state.pausedAt = Date()
        hk.pause()
        stopTick()
        stopDistanceTick()
    }

    func resume() {
        guard state.status == .paused, let pausedAt = state.pausedAt else { return }
        let pauseDuration = Date().timeIntervalSince(pausedAt) * 1000
        state.totalPausedMs += pauseDuration
        state.pausedAt = nil
        state.status = .running
        hk.resume()
        startTick()
        startDistanceTick()
    }

    /// End the race timer. Stops ticks, closes the HealthKit session,
    /// and stashes the save payload — but does NOT enqueue. The user
    /// must explicitly tap Save (or Discard) on the complete screen.
    func finish() async {
        if state.status == .running {
            // Implicit final split if the user taps Finish mid-segment.
            split()
        }
        state.status = .complete
        stopTick()
        stopDistanceTick()
        await hk.end()
        extendedSession?.invalidate()
        extendedSession = nil
        pendingPayload = buildSavePayload()
        savedThisRace = false
        state.pendingSync = false
    }

    /// Enqueue the finished race for sync to the phone, and start
    /// observing the queue so `state.pendingSync` flips to false once
    /// the phone acks (the local file is removed from `PendingRaceQueue`).
    /// Safe to call multiple times — only enqueues once per race.
    func saveRace() {
        guard let payload = pendingPayload, !savedThisRace else { return }
        savedThisRace = true
        state.pendingSync = true
        let localId = PendingRaceQueue.shared.enqueue(payload)
        pendingLocalId = localId
        queueObserver = PendingRaceQueue.shared.$pending
            .receive(on: RunLoop.main)
            .sink { [weak self] pending in
                guard let self, let id = self.pendingLocalId else { return }
                if !pending.contains(id) {
                    self.state.pendingSync = false
                }
            }
    }

    /// Drop the finished race without persisting. Returns to idle so the
    /// view routes back to the setup screen.
    func discardRace() {
        cleanupAfterRace()
        state.status = .idle
        segmentElapsedMs = 0
        totalElapsedMs = 0
        liveSegmentDistanceMeters = 0
    }

    /// Used by the post-save "Done" button — same routing as discard,
    /// but the saved race remains in the pending queue until acked.
    func dismissCompleteScreen() {
        discardRace()
    }

    // MARK: - Tick

    private func startTick() {
        stopTick()
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.tick()
                try? await Task.sleep(nanoseconds: 100_000_000) // 10Hz
            }
        }
    }

    private func stopTick() {
        tickTask?.cancel()
        tickTask = nil
    }

    private func tick() async {
        guard state.status == .running, let segStart = segmentStartedAt else { return }
        let now = Date()
        segmentElapsedMs = now.timeIntervalSince(segStart) * 1000
        if let raceStart = state.raceStartedAt {
            totalElapsedMs = (now.timeIntervalSince(raceStart) * 1000) - state.totalPausedMs
        }
    }

    private func startDistanceTick() {
        stopDistanceTick()
        distanceTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.refreshDistance()
                try? await Task.sleep(nanoseconds: 1_000_000_000) // 1Hz
            }
        }
    }

    private func stopDistanceTick() {
        distanceTask?.cancel()
        distanceTask = nil
    }

    private func refreshDistance() async {
        guard state.status == .running,
              hk.isActive,
              let segStart = segmentStartedAt
        else { return }
        let segIdx = state.currentSegmentIndex
        guard segIdx < state.segments.count,
              state.segments[segIdx].segmentType == .run
        else {
            liveSegmentDistanceMeters = 0
            return
        }
        let meters = await hk.distanceMeters(from: segStart, to: Date())
        // Re-check status after the await; user may have paused/finished
        // while the HK query was in flight.
        guard state.status == .running else { return }
        liveSegmentDistanceMeters = meters
    }

    // MARK: - Payload

    private func buildSavePayload() -> RaceSavePayload {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let totalMs = state.completedSegments.reduce(0.0) { $0 + ($1.timeSeconds * 1000) }
        let started = state.raceStartedAt ?? Date()
        let completed = Date()
        return RaceSavePayload(
            title: "Watch Race",
            notes: nil,
            divisionKey: state.divisionKey,
            template: state.template,
            raceType: "practice",
            source: "watch",
            planSessionId: state.planSessionId,
            totalTimeSeconds: totalMs / 1000.0,
            startedAt: iso.string(from: started),
            completedAt: iso.string(from: completed),
            splits: state.completedSegments.map {
                SplitPayload(
                    segmentOrder: $0.segmentOrder,
                    segmentType: $0.segmentType.rawValue,
                    segmentSubtype: $0.segmentSubtype?.rawValue,
                    segmentLabel: $0.label,
                    timeSeconds: $0.timeSeconds,
                    distanceMeters: $0.distanceMeters,
                    reps: $0.reps
                )
            }
        )
    }

    // MARK: - Background runtime

    private func startExtendedRuntimeSession() {
        let session = WKExtendedRuntimeSession()
        session.start()
        extendedSession = session
    }
}
