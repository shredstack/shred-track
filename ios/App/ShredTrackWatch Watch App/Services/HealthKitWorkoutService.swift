import Foundation
import Combine
import HealthKit

// HealthKitWorkoutService — owns the `HKWorkoutSession` for the duration
// of a HYROX race on the Watch.
//
// Per running_pace_feature_spec.md §7:
//   - Race START → create session(.running, .unknown). `.unknown` lets
//     HealthKit choose GPS vs. indoor based on signal availability —
//     better than locking to `.outdoor` because most HYROX races are in
//     expo halls.
//   - Race PAUSE → session.pause(); pace freezes.
//   - Race RESUME → session.resume().
//   - Race END → session.end(); session.endActivity(); workout written
//     to HealthKit so it shows in Activity rings.
//
// Per-segment distance: `currentSegmentDistanceMeters(start:end:)` runs
// an `HKStatisticsQuery` over the segment window. Live pace queries
// from `segmentStartedAt` to "now" on a 1Hz timer — matches typical
// fitness app refresh rate; 60Hz is wasteful for a pace readout.

@MainActor
final class HealthKitWorkoutService: ObservableObject {
    static let shared = HealthKitWorkoutService()

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    @Published private(set) var permissionState: PermissionState = .notRequested
    @Published private(set) var isActive: Bool = false

    enum PermissionState {
        case notRequested
        case granted
        case denied
    }

    static var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    private init() {}

    // MARK: - Permissions

    func requestPermissions() async -> Bool {
        guard Self.isAvailable else {
            permissionState = .denied
            return false
        }
        let typesToShare: Set = [
            HKObjectType.workoutType(),
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
        ]
        let typesToRead: Set<HKObjectType> = [
            HKObjectType.workoutType(),
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
        ]
        do {
            try await healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead)
            // We can't read the actual decision (Apple blocks introspecting
            // read-permissions), so we treat lack-of-error as granted and
            // detect denial via empty distance reads below.
            permissionState = .granted
            return true
        } catch {
            permissionState = .denied
            return false
        }
    }

    // MARK: - Session lifecycle

    func start() async throws {
        guard Self.isAvailable else {
            throw NSError(
                domain: "ShredTrack.HealthKit",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "HealthKit not available"]
            )
        }
        let config = HKWorkoutConfiguration()
        config.activityType = .running
        config.locationType = .unknown  // see spec §7

        let session = try HKWorkoutSession(
            healthStore: healthStore,
            configuration: config
        )
        let builder = session.associatedWorkoutBuilder()
        builder.dataSource = HKLiveWorkoutDataSource(
            healthStore: healthStore,
            workoutConfiguration: config
        )

        self.session = session
        self.builder = builder

        let startDate = Date()
        session.startActivity(with: startDate)
        try await builder.beginCollection(at: startDate)
        isActive = true
    }

    func pause() {
        session?.pause()
    }

    func resume() {
        session?.resume()
    }

    func end() async {
        session?.end()
        let endDate = Date()
        do {
            try await builder?.endCollection(at: endDate)
            _ = try await builder?.finishWorkout()
        } catch {
            print("[HK] endCollection/finishWorkout error: \(error)")
        }
        session = nil
        builder = nil
        isActive = false
    }

    // MARK: - Distance queries

    /// Cumulative `distanceWalkingRunning` over `[start, end]` in meters.
    /// Returns 0 (not nil) when HealthKit returns no samples — caller
    /// can decide whether to show em-dash vs. zero.
    func distanceMeters(from start: Date, to end: Date) async -> Double {
        guard
            Self.isAvailable,
            let type = HKQuantityType.quantityType(
                forIdentifier: .distanceWalkingRunning
            )
        else {
            return 0
        }
        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: end,
            options: .strictStartDate
        )
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, statistics, _ in
                let meters = statistics?
                    .sumQuantity()?
                    .doubleValue(for: HKUnit.meter()) ?? 0
                continuation.resume(returning: meters)
            }
            healthStore.execute(query)
        }
    }
}
