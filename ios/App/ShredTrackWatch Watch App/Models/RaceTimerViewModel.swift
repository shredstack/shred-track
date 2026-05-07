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
        let runs = state.completedSegments
            .filter { $0.segmentType == .run }
            .compactMap { c -> CompletedRunSegment? in
                guard let dist = c.distanceMeters, dist > 0 else { return nil }
                return CompletedRunSegment(
                    timeSeconds: c.timeSeconds,
                    distanceMeters: Double(dist)
                )
            }
        return PaceComputation.avgRunPaceSecPerKm(completedRuns: runs)
    }

    private var tickTask: Task<Void, Never>?
    private var segmentStartedAt: Date?
    private var lastDistanceRefreshSecond: Int = -1
    private var extendedSession: WKExtendedRuntimeSession?
    private let hk = HealthKitWorkoutService.shared

    init(state: RaceState = RaceState()) {
        self.state = state
    }

    // MARK: - Setup

    func configure(divisionKey: String, template: RaceTemplate, planSessionId: String? = nil) {
        let segments: [RaceSegment]
        switch template {
        case .full: segments = RaceSegmentFactory.buildFullRace(divisionKey: divisionKey)
        case .half: segments = RaceSegmentFactory.buildHalfRace(divisionKey: divisionKey)
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
    }

    // MARK: - Lifecycle

    func start() async {
        // Request HealthKit on first race start, not at install (less scary,
        // per pace spec §7).
        if hk.permissionState == .notRequested {
            _ = await hk.requestPermissions()
        }
        do {
            try await hk.start()
        } catch {
            // Timer still works without HealthKit; pace cells just degrade
            // to em-dash. Do not block race start.
            print("[Timer] HealthKit start failed: \(error)")
        }
        startExtendedRuntimeSession()
        let now = Date()
        state.raceStartedAt = now
        segmentStartedAt = now
        lastDistanceRefreshSecond = -1
        state.status = .running
        startTick()
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
            lastDistanceRefreshSecond = -1
            liveSegmentDistanceMeters = 0
        }
    }

    func pause() {
        guard state.status == .running else { return }
        state.status = .paused
        state.pausedAt = Date()
        hk.pause()
        stopTick()
    }

    func resume() {
        guard state.status == .paused, let pausedAt = state.pausedAt else { return }
        let pauseDuration = Date().timeIntervalSince(pausedAt) * 1000
        state.totalPausedMs += pauseDuration
        state.pausedAt = nil
        state.status = .running
        hk.resume()
        startTick()
    }

    func finish() async {
        if state.status == .running {
            // Implicit final split if the user taps Finish mid-segment.
            split()
        }
        state.status = .complete
        stopTick()
        await hk.end()
        extendedSession?.invalidate()
        extendedSession = nil
        let payload = buildSavePayload()
        state.pendingSync = true
        _ = PendingRaceQueue.shared.enqueue(payload)
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
        // Refresh distance only on run segments and only at 1Hz to keep
        // the cost down (HealthKit queries aren't free).
        let segIdx = state.currentSegmentIndex
        if segIdx < state.segments.count, state.segments[segIdx].segmentType == .run {
            let currentSecond = Int(segmentElapsedMs / 1000)
            if currentSecond != lastDistanceRefreshSecond {
                lastDistanceRefreshSecond = currentSecond
                liveSegmentDistanceMeters = await hk.distanceMeters(from: segStart, to: now)
            }
        } else {
            liveSegmentDistanceMeters = 0
        }
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
