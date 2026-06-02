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
//   idle → countdown (start with countdownSeconds > 0)
//   countdown → running (auto-fire at countdownEndsAt)
//   idle → running  (start with countdownSeconds == 0)
//   running → paused (pause)         pause HKWorkoutSession too
//   paused → running (resume)        resume HKWorkoutSession too
//   running → running (split)        snapshot distance for the segment
//   running → complete (finish)      end HKWorkoutSession + persist + queue sync
//
// Per native-app spec §5.1, every method here must work with no phone
// and no network — the only place we hit the network is at finish-time
// via `WCSession.transferUserInfo` (which itself queues offline).
//
// Bidirectional sync: every local tap (start, split, pause, resume,
// finish) broadcasts an event over WCSession so the phone can mirror
// it. Incoming events from the phone are applied via the
// `applyRemote*` methods, which do NOT re-broadcast.

@MainActor
final class RaceTimerViewModel: ObservableObject {
    @Published var state: RaceState
    @Published var segmentElapsedMs: Double = 0
    @Published var totalElapsedMs: Double = 0
    @Published var countdownRemainingSec: Int = 0
    @Published var liveSegmentDistanceMeters: Double = 0
    /// Set true after the user taps Save on the complete screen. Drives
    /// the post-save layout (Syncing/Synced + Done) vs the pre-save
    /// layout (Save / Discard). Cleared on reset/configure.
    @Published var savedThisRace: Bool = false
    /// Set true when the phone broadcasts `race.saved` for this raceId
    /// — i.e., the server already has the race. Lets the watch show
    /// "Saved on iPhone ✓" + Done instead of prompting the user for a
    /// redundant save. Cleared on reset/configure.
    @Published var savedRemotely: Bool = false

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
    /// One-shot countdown auto-fire. Cancelled if the user taps Cancel
    /// or if the phone sends `race.cancel`.
    private var countdownTask: Task<Void, Never>?
    private var segmentStartedAt: Date?
    private let hk = HealthKitWorkoutService.shared

    /// `DateFormatter` is expensive to allocate; reuse one instance for
    /// the locale-stamped race title built on every finish.
    private static let titleFormatter: DateFormatter = {
        let df = DateFormatter()
        df.dateStyle = .short
        df.timeStyle = .short
        return df
    }()

    /// ISO 8601 timestamp formatter for `startedAt` / `completedAt`. Also
    /// expensive to allocate; lifted to a static so `buildSavePayload`
    /// doesn't churn one per race.
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

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
            raceId: nil,
            source: nil,
            divisionKey: divisionKey,
            template: template.rawValue,
            planSessionId: planSessionId,
            segments: segments,
            status: .idle
        )
        segmentElapsedMs = 0
        totalElapsedMs = 0
        countdownRemainingSec = 0
        liveSegmentDistanceMeters = 0
        cleanupAfterRace()
    }

    /// Configure the timer from a phone-synced custom template.
    /// `template.divisionKey` is reused so HK pacing still has a sensible
    /// run distance to compare against; if nil we fall back to the
    /// currently-selected default. Segments come straight from the
    /// template (no factory rebuild) so the watch races exactly what was
    /// saved on the phone.
    func configure(
        customTemplate template: SavedRaceTemplate,
        fallbackDivisionKey: String,
        planSessionId: String? = nil
    ) {
        let divisionKey = template.divisionKey ?? fallbackDivisionKey
        state = RaceState(
            raceId: nil,
            source: nil,
            divisionKey: divisionKey,
            template: "custom",
            planSessionId: planSessionId,
            segments: template.segments,
            status: .idle
        )
        segmentElapsedMs = 0
        totalElapsedMs = 0
        countdownRemainingSec = 0
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
        savedRemotely = false
        state.pendingSync = false
        countdownTask?.cancel()
        countdownTask = nil
    }

    // MARK: - Lifecycle

    /// Begin the race from this device. With `countdownSeconds > 0` the
    /// timer enters `.countdown` first and auto-transitions to
    /// `.running` when the deadline passes; the same `startAt` is
    /// pushed to the phone so both clocks tick from the same instant.
    func start(countdownSeconds: Int = 10) async {
        let now = Date()
        let startAt = now.addingTimeInterval(TimeInterval(countdownSeconds))
        let raceId = state.raceId ?? UUID().uuidString
        state.raceId = raceId
        state.source = .watch
        state.completedSegments = []
        state.currentSegmentIndex = 0
        state.totalPausedMs = 0
        state.pausedAt = nil
        liveSegmentDistanceMeters = 0
        segmentStartedAt = nil

        // Broadcast the start to the phone so it can adopt + show the
        // same countdown. Always uses a 10s countdown when initiated on
        // the watch (per product spec — the user has no time to fiddle
        // with a setting on their wrist).
        WatchConnectivityManager.shared.sendRaceStart(
            raceId: raceId,
            divisionKey: state.divisionKey,
            template: state.template,
            simulateRoxzone: state.segments.contains { $0.segmentSubtype == .roxzone },
            startAt: startAt,
            segments: state.segments
        )

        if countdownSeconds > 0 {
            state.status = .countdown
            state.countdownEndsAt = startAt
            countdownRemainingSec = countdownSeconds
            scheduleCountdownFire(at: startAt)
        } else {
            await beginRunning(at: now)
        }
    }

    /// Cancel a pre-race countdown. No-op outside `.countdown`. Notifies
    /// the phone so it can return its UI to setup too.
    func cancelCountdown() {
        guard state.status == .countdown else { return }
        let raceId = state.raceId
        countdownTask?.cancel()
        countdownTask = nil
        state.countdownEndsAt = nil
        state.status = .idle
        state.raceId = nil
        state.source = nil
        countdownRemainingSec = 0
        if let raceId {
            WatchConnectivityManager.shared.sendRaceEvent(
                kind: "race.cancel",
                raceId: raceId,
                payload: [:]
            )
        }
    }

    /// Schedules the one-shot transition from `.countdown` to `.running`
    /// at the given wall-clock instant. Uses `Task.sleep` rather than a
    /// Timer because Tasks survive suspended `await` points and play
    /// nicely with cancellation when the user taps Cancel.
    private func scheduleCountdownFire(at fireDate: Date) {
        countdownTask?.cancel()
        countdownTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let remaining = fireDate.timeIntervalSince(Date())
                if remaining <= 0 { break }
                // Update the on-screen number; tick every ~250ms so the
                // last second feels responsive without burning battery.
                self.countdownRemainingSec = max(0, Int(ceil(remaining)))
                let sleepNs = min(UInt64(remaining * 1_000_000_000), 250_000_000)
                try? await Task.sleep(nanoseconds: sleepNs)
            }
            if Task.isCancelled { return }
            guard let self else { return }
            if self.state.status == .countdown {
                await self.beginRunning(at: fireDate)
            }
        }
    }

    private func beginRunning(at startedAt: Date) async {
        state.status = .running
        state.raceStartedAt = startedAt
        state.countdownEndsAt = nil
        segmentStartedAt = startedAt
        liveSegmentDistanceMeters = 0
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
        let raceId = state.raceId
        let segmentOrder = state.currentSegmentIndex + 1
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

        // Broadcast outward so the phone can mirror. Local-origin event
        // — the receiving side will not echo back.
        if let raceId {
            var payload: [String: Any] = [
                "segmentOrder": segmentOrder,
                "completedAt": now.timeIntervalSince1970 * 1000,
                "originDevice": "watch",
            ]
            if let dist = runDistanceMeters { payload["distanceMeters"] = dist }
            WatchConnectivityManager.shared.sendRaceEvent(
                kind: "race.split",
                raceId: raceId,
                payload: payload
            )
        }

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
        let now = Date()
        state.status = .paused
        state.pausedAt = now
        hk.pause()
        stopTick()
        stopDistanceTick()
        if let raceId = state.raceId {
            WatchConnectivityManager.shared.sendRaceEvent(
                kind: "race.pause",
                raceId: raceId,
                payload: ["at": now.timeIntervalSince1970 * 1000]
            )
        }
    }

    func resume() {
        guard state.status == .paused, let pausedAt = state.pausedAt else { return }
        let now = Date()
        let pauseDuration = now.timeIntervalSince(pausedAt) * 1000
        state.totalPausedMs += pauseDuration
        state.pausedAt = nil
        state.status = .running
        // Shift segment start by the pause so segment time excludes it.
        if let segStart = segmentStartedAt {
            segmentStartedAt = segStart.addingTimeInterval(now.timeIntervalSince(pausedAt))
        }
        hk.resume()
        startTick()
        startDistanceTick()
        if let raceId = state.raceId {
            WatchConnectivityManager.shared.sendRaceEvent(
                kind: "race.resume",
                raceId: raceId,
                payload: ["at": now.timeIntervalSince1970 * 1000]
            )
        }
    }

    /// End the race timer. Stops ticks, closes the HealthKit session,
    /// and stashes the save payload — but does NOT enqueue. The user
    /// must explicitly tap Save (or Discard) on the complete screen.
    ///
    /// Re-entry guard: tapping FINISH on the last segment routes through
    /// `split()`, which queues a `Task { await finish() }` *without*
    /// advancing `currentSegmentIndex`. Without this guard, the queued
    /// task would re-enter, call `split()` again (since status is still
    /// `.running` during the outer awaits), and end HealthKit twice.
    func finish() async {
        guard state.status != .complete else { return }
        let finishAt = Date()
        // Implicit final split if the user taps Finish mid-segment. Skip
        // when every segment is already completed: the common case is
        // split() on the last segment queued this finish task *and*
        // already appended the completed segment. Calling split() again
        // would re-append the same segmentOrder, which the server's
        // UNIQUE (race_id, segment_order) constraint rejects with a 500.
        if state.status == .running
            && state.completedSegments.count < state.segments.count {
            split()
        }
        state.status = .complete
        stopTick()
        stopDistanceTick()
        await hk.end()
        pendingPayload = buildSavePayload()
        savedThisRace = false
        state.pendingSync = false
        if let raceId = state.raceId {
            WatchConnectivityManager.shared.sendRaceEvent(
                kind: "race.finish",
                raceId: raceId,
                payload: ["at": finishAt.timeIntervalSince1970 * 1000]
            )
        }
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
    /// view routes back to the setup screen. For a finished race, also
    /// notifies the phone so its mirror UI doesn't linger as a ghost
    /// (per watch_finish_owns_save_spec.md §9). Pre-finish discards
    /// don't reach here — those go through `cancelCountdown()` /
    /// `applyRemoteCancel()`.
    func discardRace() {
        let raceIdForBroadcast = (state.status == .complete) ? state.raceId : nil
        cleanupAfterRace()
        state.status = .idle
        state.raceId = nil
        state.source = nil
        segmentElapsedMs = 0
        totalElapsedMs = 0
        countdownRemainingSec = 0
        liveSegmentDistanceMeters = 0
        if let raceId = raceIdForBroadcast {
            WatchConnectivityManager.shared.sendRaceEvent(
                kind: "race.discard",
                raceId: raceId,
                payload: [:]
            )
        }
    }

    /// Used by the post-save "Done" button — same routing as discard,
    /// but the saved race remains in the pending queue until acked.
    func dismissCompleteScreen() {
        discardRace()
    }

    // MARK: - Remote (phone-originated) event ingress

    /// Adopt an in-progress race that originated on the phone. The watch
    /// shows the same countdown and clock; the phone retains save
    /// authority at finish-time.
    func adoptFromPhone(
        raceId: String,
        divisionKey: String,
        template: RaceTemplate,
        simulateRoxzone: Bool,
        startAt: Date,
        segments: [RaceSegment]
    ) async {
        // Don't clobber a race already in-flight with the same id
        // (could happen if the watch already started locally and the
        // phone is now reflecting it back).
        if state.raceId == raceId && state.status != .idle && state.status != .complete {
            return
        }
        state = RaceState(
            raceId: raceId,
            source: .phone,
            divisionKey: divisionKey,
            template: template.rawValue,
            planSessionId: nil,
            segments: segments,
            status: .idle
        )
        countdownRemainingSec = 0
        liveSegmentDistanceMeters = 0
        segmentElapsedMs = 0
        totalElapsedMs = 0

        let now = Date()
        if startAt > now {
            // Countdown still pending — show the same number on both
            // devices and auto-fire at the shared instant.
            state.status = .countdown
            state.countdownEndsAt = startAt
            countdownRemainingSec = Int(ceil(startAt.timeIntervalSince(now)))
            scheduleCountdownFire(at: startAt)
        } else {
            // Joined late — start the running clock with the original
            // startAt so elapsed time matches the phone's reading.
            await beginRunning(at: startAt)
        }
    }

    /// Apply a remote split. First-write-wins per `segmentOrder`: if the
    /// next-expected segment matches the incoming one, advance; otherwise
    /// drop the event (the local tap already moved us past it, or this
    /// is a duplicate).
    func applyRemoteSplit(
        raceId: String,
        segmentOrder: Int,
        completedAt: Date,
        originDevice: RaceSource,
        distanceMeters: Int?
    ) {
        guard state.raceId == raceId else { return }
        guard state.status == .running else { return }
        guard segmentOrder == state.currentSegmentIndex + 1 else { return }
        let segStart = segmentStartedAt ?? completedAt
        let elapsed = completedAt.timeIntervalSince(segStart)
        guard elapsed >= 0 else { return }
        let current = state.segments[state.currentSegmentIndex]

        // Run distance: prefer the value attached to the incoming
        // event; if the phone tapped this and didn't have a distance,
        // we'll backfill via HealthKit below and emit an enrichment.
        let runDistance: Int?
        if current.segmentType == .run {
            if let d = distanceMeters { runDistance = d }
            else { runDistance = Int(liveSegmentDistanceMeters.rounded()) }
        } else {
            runDistance = nil
        }

        let completed = CompletedSegment(
            segmentOrder: state.currentSegmentIndex,
            segmentType: current.segmentType,
            segmentSubtype: current.segmentSubtype,
            label: current.label,
            timeSeconds: elapsed,
            distanceMeters: runDistance,
            reps: current.reps
        )
        state.completedSegments.append(completed)

        // Pace backfill: phone-originated run splits arrive with no
        // distance because the phone has no wrist sensor. Use the
        // HealthKit reading the watch has and ship it back so the
        // phone's CompletedSegment gets pace data too.
        if current.segmentType == .run,
           originDevice == .phone,
           let raceId = state.raceId,
           let dist = runDistance,
           dist > 0 {
            WatchConnectivityManager.shared.sendRaceEvent(
                kind: "race.split.enrich",
                raceId: raceId,
                payload: [
                    "segmentOrder": segmentOrder,
                    "distanceMeters": dist,
                ]
            )
        }

        let nextIdx = state.currentSegmentIndex + 1
        if nextIdx >= state.segments.count {
            Task { await finishFromRemote(at: completedAt) }
        } else {
            state.currentSegmentIndex = nextIdx
            segmentStartedAt = completedAt
            liveSegmentDistanceMeters = 0
        }
    }

    func applyRemotePause(raceId: String, at: Date) {
        guard state.raceId == raceId, state.status == .running else { return }
        state.status = .paused
        state.pausedAt = at
        hk.pause()
        stopTick()
        stopDistanceTick()
    }

    func applyRemoteResume(raceId: String, at: Date) {
        guard state.raceId == raceId, state.status == .paused,
              let pausedAt = state.pausedAt else { return }
        let pauseDuration = at.timeIntervalSince(pausedAt) * 1000
        state.totalPausedMs += pauseDuration
        state.pausedAt = nil
        state.status = .running
        if let segStart = segmentStartedAt {
            segmentStartedAt = segStart.addingTimeInterval(at.timeIntervalSince(pausedAt))
        }
        hk.resume()
        startTick()
        startDistanceTick()
    }

    func applyRemoteFinish(raceId: String, at: Date) {
        guard state.raceId == raceId, state.status != .complete else { return }
        Task { await finishFromRemote(at: at) }
    }

    /// Phone broadcast: the server now has this race (POSTed under
    /// the shared client_race_id). Suppress the local Save? prompt
    /// and stop any in-flight watch-side sync — we don't want to
    /// fight the phone's ack pipeline. If the watch already enqueued
    /// its own save, leave the queue entry alone: the phone's ack
    /// path will clear it via `race.ack`, and server idempotency
    /// makes a duplicate POST a no-op either way.
    ///
    /// Note: queue-file cleanup runs through
    /// `WatchConnectivityManager.handleUserInfo` → `PendingRaceQueue.clear`,
    /// which is independent of the in-memory `queueObserver` sink. So
    /// even if the user taps Done and `cleanupAfterRace` cancels the
    /// observer before `race.ack` arrives, the file still gets removed
    /// when the ack lands.
    func applyRemoteSaved(raceId: String) {
        guard state.raceId == raceId else { return }
        savedRemotely = true
        // If we never tapped Save locally, there's no pending sync
        // to clear here — pendingSync is only set inside `saveRace`.
    }

    func applyRemoteCancel(raceId: String) {
        guard state.raceId == raceId else { return }
        countdownTask?.cancel()
        countdownTask = nil
        state = RaceState(
            divisionKey: state.divisionKey,
            template: state.template,
            segments: state.segments,
            status: .idle
        )
        countdownRemainingSec = 0
        liveSegmentDistanceMeters = 0
        segmentElapsedMs = 0
        totalElapsedMs = 0
    }

    /// Internal: closes out the race in response to a remote finish.
    /// Does NOT re-broadcast a finish event — that would echo back to
    /// the phone and double-fire.
    private func finishFromRemote(at: Date) async {
        guard state.status != .complete else { return }
        // Close the in-progress segment using the remote timestamp so
        // the timing reading matches the originating device.
        if state.status == .running,
           let segStart = segmentStartedAt,
           state.currentSegmentIndex < state.segments.count {
            let current = state.segments[state.currentSegmentIndex]
            let elapsed = max(0, at.timeIntervalSince(segStart))
            let runDistance: Int?
            if current.segmentType == .run {
                runDistance = Int(liveSegmentDistanceMeters.rounded())
            } else {
                runDistance = nil
            }
            state.completedSegments.append(
                CompletedSegment(
                    segmentOrder: state.currentSegmentIndex,
                    segmentType: current.segmentType,
                    segmentSubtype: current.segmentSubtype,
                    label: current.label,
                    timeSeconds: elapsed,
                    distanceMeters: runDistance,
                    reps: current.reps
                )
            )
        }
        state.status = .complete
        stopTick()
        stopDistanceTick()
        await hk.end()
        // Whichever device the user taps Finish on owns the save. We
        // always stash a payload so the watch can offer Save / Discard
        // regardless of origin — critical when the phone is out of
        // range at the finish line and would otherwise lose the race
        // if the watch app gets killed before reachability returns.
        // Server-side idempotency (client_race_id) protects against
        // duplicate POSTs if the phone also saves the same raceId.
        pendingPayload = buildSavePayload()
        savedThisRace = false
        state.pendingSync = false
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
        let totalMs = state.completedSegments.reduce(0.0) { $0 + ($1.timeSeconds * 1000) }
        let started = state.raceStartedAt ?? Date()
        let completed = Date()
        // Locale-formatted timestamp so the user has multiple watch
        // races in their history without collisions. The user can
        // rename later from the race detail page on web/phone.
        let title = "Watch Race · \(Self.titleFormatter.string(from: started))"
        return RaceSavePayload(
            raceId: state.raceId,
            title: title,
            notes: nil,
            divisionKey: state.divisionKey,
            template: state.template,
            raceType: "practice",
            source: "watch",
            planSessionId: state.planSessionId,
            totalTimeSeconds: totalMs / 1000.0,
            startedAt: Self.isoFormatter.string(from: started),
            completedAt: Self.isoFormatter.string(from: completed),
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

}
