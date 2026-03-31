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
              let basalEnergyType = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned) else {
            call.reject("Failed to create HealthKit quantity types")
            return
        }

        let writeTypes: Set<HKSampleType> = [
            activeEnergyType,
            basalEnergyType,
            HKObjectType.workoutType()
        ]

        healthStore.requestAuthorization(toShare: writeTypes, read: nil) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(["granted": success])
        }
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
}
