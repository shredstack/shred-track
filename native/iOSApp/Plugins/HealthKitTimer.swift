import Foundation
import Capacitor
import HealthKit

// HealthKitTimer — Capacitor plugin that owns the iPhone-side
// `HKWorkoutSession` while a HYROX race runs in the WebView.
//
// The JS side calls these methods via:
//   Capacitor.Plugins.HealthKitTimer.requestPermissions()
//   Capacitor.Plugins.HealthKitTimer.startWorkout()
//   Capacitor.Plugins.HealthKitTimer.pauseWorkout()
//   Capacitor.Plugins.HealthKitTimer.resumeWorkout()
//   Capacitor.Plugins.HealthKitTimer.endWorkout()
//   Capacitor.Plugins.HealthKitTimer.getDistanceMeters({ from, to })
//
// Mirrors the watch-side `HealthKitWorkoutService.swift`. Same
// `HKWorkoutSession` lifecycle (.running, .unknown so HealthKit picks
// GPS vs. accelerometer based on signal availability), same
// per-window cumulative distance query via `HKStatisticsQuery`.

@objc(HealthKitTimer)
public class HealthKitTimer: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitTimer"
    public let jsName = "HealthKitTimer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resumeWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDistanceMeters", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    private static var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    // MARK: - Permissions

    @objc func requestPermissions(_ call: CAPPluginCall) {
        guard Self.isAvailable else {
            call.resolve(["granted": false, "available": false])
            return
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
        healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead) { success, error in
            if let error = error {
                call.resolve(["granted": false, "available": true, "error": error.localizedDescription])
                return
            }
            // Apple blocks introspecting read-permissions, so we report
            // success if the prompt didn't error. Empty distance reads at
            // run time are how the JS side detects denial.
            call.resolve(["granted": success, "available": true])
        }
    }

    // MARK: - Workout session lifecycle

    @objc func startWorkout(_ call: CAPPluginCall) {
        guard Self.isAvailable else {
            call.reject("HealthKit not available on this device")
            return
        }
        if session != nil {
            // Already running — idempotent.
            call.resolve()
            return
        }

        let config = HKWorkoutConfiguration()
        config.activityType = .running
        config.locationType = .unknown

        do {
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
            builder.beginCollection(withStart: startDate) { success, error in
                if let error = error {
                    call.reject("beginCollection failed: \(error.localizedDescription)")
                    return
                }
                call.resolve(["started": success])
            }
        } catch {
            call.reject("Failed to create workout session: \(error.localizedDescription)")
        }
    }

    @objc func pauseWorkout(_ call: CAPPluginCall) {
        session?.pause()
        call.resolve()
    }

    @objc func resumeWorkout(_ call: CAPPluginCall) {
        session?.resume()
        call.resolve()
    }

    @objc func endWorkout(_ call: CAPPluginCall) {
        guard let session = self.session, let builder = self.builder else {
            call.resolve()
            return
        }
        session.end()
        let endDate = Date()
        builder.endCollection(withEnd: endDate) { [weak self] _, _ in
            builder.finishWorkout { _, _ in
                self?.session = nil
                self?.builder = nil
                call.resolve()
            }
        }
    }

    // MARK: - Distance queries

    @objc func getDistanceMeters(_ call: CAPPluginCall) {
        guard
            Self.isAvailable,
            let type = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)
        else {
            call.resolve(["meters": 0])
            return
        }
        guard
            let fromMs = call.getDouble("from"),
            let toMs = call.getDouble("to")
        else {
            call.reject("Missing from/to (ms-since-epoch)")
            return
        }
        let start = Date(timeIntervalSince1970: fromMs / 1000.0)
        let end = Date(timeIntervalSince1970: toMs / 1000.0)
        let predicate = HKQuery.predicateForSamples(
            withStart: start,
            end: end,
            options: .strictStartDate
        )
        let query = HKStatisticsQuery(
            quantityType: type,
            quantitySamplePredicate: predicate,
            options: .cumulativeSum
        ) { _, statistics, _ in
            let meters = statistics?
                .sumQuantity()?
                .doubleValue(for: HKUnit.meter()) ?? 0
            call.resolve(["meters": meters])
        }
        healthStore.execute(query)
    }
}
