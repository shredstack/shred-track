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
        // Calorie-estimation feature: push ShredTrack's MET-based estimate to
        // Apple Health so rings/Move calories reflect CrossFit work.
        CAPPluginMethod(name: "requestWritePermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasOverlappingWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
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

    // MARK: - Workout writes (calorie estimation feature)

    private func activeEnergyType() -> HKQuantityType? {
        HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)
    }

    @objc func requestWritePermission(_ call: CAPPluginCall) {
        guard Self.isAvailable, let active = activeEnergyType() else {
            call.resolve(["granted": false, "available": false])
            return
        }
        let workoutType = HKObjectType.workoutType()
        healthStore.requestAuthorization(
            toShare: [workoutType, active],
            read: [workoutType, active]
        ) { success, error in
            if let error = error {
                call.resolve([
                    "granted": false, "available": true,
                    "error": error.localizedDescription,
                ])
                return
            }
            call.resolve(["granted": success, "available": true])
        }
    }

    @objc func hasOverlappingWorkout(_ call: CAPPluginCall) {
        guard Self.isAvailable else {
            call.resolve(["overlap": false])
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
            withStart: start, end: end, options: []
        )
        let query = HKSampleQuery(
            sampleType: HKObjectType.workoutType(),
            predicate: predicate,
            limit: 1,
            sortDescriptors: nil
        ) { _, samples, _ in
            call.resolve(["overlap": !(samples?.isEmpty ?? true)])
        }
        healthStore.execute(query)
    }

    @objc func saveWorkout(_ call: CAPPluginCall) {
        guard Self.isAvailable, let active = activeEnergyType() else {
            call.reject("HealthKit unavailable")
            return
        }
        guard
            let fromMs = call.getDouble("from"),
            let toMs = call.getDouble("to"),
            let activeKcal = call.getDouble("activeEnergyKcal")
        else {
            call.reject("Missing from/to/activeEnergyKcal")
            return
        }
        let start = Date(timeIntervalSince1970: fromMs / 1000.0)
        let end = Date(timeIntervalSince1970: toMs / 1000.0)
        let activityRaw = call.getInt("activityType") ?? Int(HKWorkoutActivityType.highIntensityIntervalTraining.rawValue)
        guard let activity = HKWorkoutActivityType(rawValue: UInt(activityRaw)) else {
            call.reject("Invalid activityType")
            return
        }

        // Server-built metadata describing the WOD (title, format, movements,
        // score, RPE, notes). JS sends string/number only; we coerce to the
        // NSString / NSNumber that HealthKit accepts.
        let metadata = sanitizedMetadata(call.getObject("metadata"))

        let config = HKWorkoutConfiguration()
        config.activityType = activity

        let builder = HKWorkoutBuilder(
            healthStore: healthStore,
            configuration: config,
            device: nil
        )
        builder.beginCollection(withStart: start) { beginOk, beginErr in
            guard beginOk else {
                call.reject(beginErr?.localizedDescription ?? "beginCollection failed")
                return
            }

            let finishCollection: () -> Void = {
                let energySample = HKQuantitySample(
                    type: active,
                    quantity: HKQuantity(unit: .kilocalorie(), doubleValue: activeKcal),
                    start: start,
                    end: end
                )
                builder.add([energySample]) { _, _ in
                    builder.endCollection(withEnd: end) { _, endErr in
                        if let endErr = endErr {
                            call.reject(endErr.localizedDescription)
                            return
                        }
                        builder.finishWorkout { workout, finishErr in
                            if let finishErr = finishErr {
                                call.reject(finishErr.localizedDescription)
                                return
                            }
                            call.resolve([
                                "workoutUuid": workout?.uuid.uuidString ?? "",
                            ])
                        }
                    }
                }
            }

            if metadata.isEmpty {
                finishCollection()
            } else {
                builder.addMetadata(metadata) { _, _ in
                    // Don't block the workout save on a metadata-attach
                    // failure — the energy sample is still useful on its own.
                    finishCollection()
                }
            }
        }
    }

    // HealthKit metadata values must be NSString / NSNumber / NSDate /
    // HKQuantity. Anything else gets dropped so a stray null / bool doesn't
    // poison the dict.
    private func sanitizedMetadata(_ raw: JSObject?) -> [String: Any] {
        guard let raw = raw else { return [:] }
        var out: [String: Any] = [:]
        for (key, value) in raw {
            if let s = value as? String {
                out[key] = s
            } else if let n = value as? NSNumber {
                out[key] = n
            }
        }
        return out
    }
}
