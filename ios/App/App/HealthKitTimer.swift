import Foundation
import Capacitor
import HealthKit

// No HKWorkoutSession on iPhone: it requires iOS 17 and HKLiveWorkoutBuilder requires iOS 26. HKStatisticsQuery covers what the pace UI needs and works on iOS 15+. The watch app still runs a real workout session via its own service.

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

    private static var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    // MARK: - Permissions

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        guard Self.isAvailable else {
            call.resolve(["granted": false, "available": false])
            return
        }
        guard let distanceType = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) else {
            call.resolve(["granted": false, "available": true, "error": "distanceWalkingRunning unavailable"])
            return
        }
        healthStore.requestAuthorization(toShare: [], read: [distanceType]) { success, error in
            if let error = error {
                call.resolve(["granted": false, "available": true, "error": error.localizedDescription])
                return
            }
            // Apple blocks introspecting read-permission grants; empty distance reads at runtime are how the JS side detects denial.
            call.resolve(["granted": success, "available": true])
        }
    }

    // MARK: - Workout-session lifecycle (intentional no-ops; see file header)

    @objc func startWorkout(_ call: CAPPluginCall) {
        call.resolve(["started": true])
    }

    @objc func pauseWorkout(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func resumeWorkout(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func endWorkout(_ call: CAPPluginCall) {
        call.resolve()
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
