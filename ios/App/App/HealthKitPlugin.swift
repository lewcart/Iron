import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getActiveCalories", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRecentWorkouts", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    @objc public func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false])
            return
        }

        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
              let basalEnergyType = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned),
              let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            call.reject("Failed to create HealthKit quantity types")
            return
        }

        let writeTypes: Set<HKSampleType> = [
            activeEnergyType,
            basalEnergyType,
            HKObjectType.workoutType()
        ]

        let readTypes: Set<HKObjectType> = [
            stepsType,
            activeEnergyType,
            HKObjectType.workoutType()
        ]

        healthStore.requestAuthorization(toShare: writeTypes, read: readTypes) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(["granted": success])
        }
    }

    @objc public func getSteps(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["value": 0])
            return
        }

        guard let stepsType = HKQuantityType.quantityType(forIdentifier: .stepCount) else {
            call.resolve(["value": 0])
            return
        }

        let startMs = call.getDouble("startTime") ?? startOfTodayMs()
        let endMs = call.getDouble("endTime") ?? Double(Date().timeIntervalSince1970 * 1000)
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let query = HKStatisticsQuery(quantityType: stepsType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, _ in
            let value = result?.sumQuantity()?.doubleValue(for: HKUnit.count()) ?? 0
            call.resolve(["value": Int(value)])
        }
        healthStore.execute(query)
    }

    @objc public func getActiveCalories(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["value": 0])
            return
        }

        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else {
            call.resolve(["value": 0])
            return
        }

        let startMs = call.getDouble("startTime") ?? startOfTodayMs()
        let endMs = call.getDouble("endTime") ?? Double(Date().timeIntervalSince1970 * 1000)
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let query = HKStatisticsQuery(quantityType: activeEnergyType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, _ in
            let value = result?.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
            call.resolve(["value": Int(value)])
        }
        healthStore.execute(query)
    }

    @objc public func getRecentWorkouts(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["workouts": []])
            return
        }

        let startMs = call.getDouble("startTime") ?? sevenDaysAgoMs()
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: Date(), options: .strictStartDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: 10, sortDescriptors: [sortDescriptor]) { _, samples, _ in
            let workouts = (samples as? [HKWorkout] ?? []).map { w -> [String: Any] in
                let durationMins = w.duration / 60.0
                let calories = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0
                return [
                    "startTime": w.startDate.timeIntervalSince1970 * 1000,
                    "endTime": w.endDate.timeIntervalSince1970 * 1000,
                    "durationMinutes": Int(durationMins),
                    "activeCalories": Int(calories),
                    "activityType": self.activityTypeName(w.workoutActivityType),
                ]
            }
            call.resolve(["workouts": workouts])
        }
        healthStore.execute(query)
    }

    @objc public func saveWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device")
            return
        }

        guard let activityTypeStr = call.getString("activityType"),
              let startTimeMs = call.getDouble("startTime"),
              let endTimeMs = call.getDouble("endTime") else {
            call.reject("Missing required parameters: activityType, startTime, endTime")
            return
        }

        let activityType: HKWorkoutActivityType
        switch activityTypeStr {
        case "walking":
            activityType = .walking
        default:
            activityType = .traditionalStrengthTraining
        }

        let startDate = Date(timeIntervalSince1970: startTimeMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endTimeMs / 1000.0)
        let activeEnergyKcal = call.getDouble("activeEnergyKcal") ?? 0.0

        guard let activeEnergyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else {
            call.reject("Failed to create activeEnergyBurned type")
            return
        }

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activityType
        configuration.locationType = .indoor

        let builder = HKWorkoutBuilder(healthStore: healthStore, configuration: configuration, device: .local())

        // Build metadata
        var metadata: [String: Any] = [:]
        if let uuid = call.getString("uuid") {
            metadata[HKMetadataKeyExternalUUID] = uuid
        }
        if let metadataJson = call.getString("metadata") {
            metadata["ironMetadata"] = metadataJson
        }

        builder.beginCollection(withStart: startDate) { [weak self] success, error in
            guard success, let self = self else {
                call.reject("Failed to begin workout collection: \(error?.localizedDescription ?? "unknown")")
                return
            }

            // Critical: add activeEnergyBurned samples BEFORE finishing
            // — this is what triggers activity ring credit
            let activeEnergy = HKQuantity(unit: .kilocalorie(), doubleValue: activeEnergyKcal)
            let activeSample = HKQuantitySample(
                type: activeEnergyType,
                quantity: activeEnergy,
                start: startDate,
                end: endDate
            )

            builder.add([activeSample]) { success, error in
                guard success else {
                    call.reject("Failed to add energy samples: \(error?.localizedDescription ?? "unknown")")
                    return
                }

                let finishCollection = {
                    builder.endCollection(withEnd: endDate) { success, error in
                        guard success else {
                            call.reject("Failed to end workout collection: \(error?.localizedDescription ?? "unknown")")
                            return
                        }

                        builder.finishWorkout { workout, error in
                            if let error = error {
                                call.reject("Failed to finish workout: \(error.localizedDescription)")
                                return
                            }
                            call.resolve(["saved": true])
                        }
                    }
                }

                if !metadata.isEmpty {
                    builder.addMetadata(metadata) { _, _ in
                        finishCollection()
                    }
                } else {
                    finishCollection()
                }
            }
        }
    }

    // MARK: - Helpers

    private func startOfTodayMs() -> Double {
        let cal = Calendar.current
        let start = cal.startOfDay(for: Date())
        return start.timeIntervalSince1970 * 1000
    }

    private func sevenDaysAgoMs() -> Double {
        let date = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        return date.timeIntervalSince1970 * 1000
    }

    private func activityTypeName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .traditionalStrengthTraining: return "Strength Training"
        case .functionalStrengthTraining: return "Functional Strength"
        case .running: return "Running"
        case .walking: return "Walking"
        case .hiking: return "Hiking"
        case .cycling: return "Cycling"
        case .swimming: return "Swimming"
        case .yoga: return "Yoga"
        case .highIntensityIntervalTraining: return "HIIT"
        case .crossTraining: return "Cross Training"
        case .elliptical: return "Elliptical"
        case .rowing: return "Rowing"
        default: return "Workout"
        }
    }
}
