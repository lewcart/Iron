import Foundation
import Capacitor
import HealthKit

@objc(HealthKitPlugin)
public class HealthKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthKitPlugin"
    public let jsName = "HealthKit"
    public let pluginMethods: [CAPPluginMethod] = [
        // Core
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRequestStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMedicationsEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestMedicationsAuthorization", returnType: CAPPluginReturnPromise),
        // Legacy reads (kept for backwards compat with existing TS callers)
        CAPPluginMethod(name: "getSteps", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getActiveCalories", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRecentWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getHeartRate", returnType: CAPPluginReturnPromise),
        // New anchored / aggregated reads
        CAPPluginMethod(name: "fetchDailyAggregates", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchSleepNights", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchWorkouts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchMedicationRecords", returnType: CAPPluginReturnPromise),
        // Writes
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveNutrition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBodyComposition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteSamples", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    // MARK: - Availability

    @objc public func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    // MARK: - Authorization

    @objc public override func requestPermissions(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false])
            return
        }

        let (readTypes, writeTypes) = HealthKitTypes.allRequestedTypes()

        healthStore.requestAuthorization(toShare: writeTypes, read: readTypes) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(["granted": success])
        }
    }

    /// Returns whether iOS thinks there's anything left to ask the user about.
    /// .shouldRequest → call requestPermissions, the system sheet WILL appear (at minimum
    ///                  for newly-added types). Use this to decide when to show the
    ///                  "Request Authorization" button vs. routing the user to Settings.
    /// .unnecessary   → user has already answered for every type in the current request set.
    ///                  iOS will NOT show the sheet again. Show "Manage in Health app" instead.
    /// .unknown       → iOS couldn't determine status (rare, treat like .shouldRequest).
    @objc public func getRequestStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["status": "unknown", "shouldRequest": false])
            return
        }
        let (readTypes, writeTypes) = HealthKitTypes.allRequestedTypes()
        healthStore.getRequestStatusForAuthorization(toShare: writeTypes, read: readTypes) { status, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            let str: String
            switch status {
            case .shouldRequest: str = "shouldRequest"
            case .unnecessary: str = "unnecessary"
            case .unknown: str = "unknown"
            @unknown default: str = "unknown"
            }
            call.resolve([
                "status": str,
                "shouldRequest": status != .unnecessary
            ])
        }
    }

    /// Returns sharing auth status per tracked type. iOS hides READ status for privacy;
    /// read types always return 'notDetermined'. Write types reflect real status.
    @objc public func checkPermissionStatus(_ call: CAPPluginCall) {
        var statuses: [String: String] = [:]
        for key in HealthKitTypes.allTsKeys {
            if HealthKitTypes.writeTsKeys.contains(key), let t = HealthKitTypes.objectType(forTsKey: key) {
                statuses[key] = Self.authStatusString(healthStore.authorizationStatus(for: t))
            } else {
                // Read-only or unavailable on this iOS version — iOS hides read auth status by design.
                statuses[key] = "notDetermined"
            }
        }
        call.resolve(["statuses": statuses])
    }

    /// Sets the runtime feature flag that gates iOS 26 Medications reads, and
    /// (when enabling) automatically triggers the per-object authorization sheet
    /// so the user can pick which medications Rebirth can read. One-call UX.
    @objc public func setMedicationsEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        UserDefaults.standard.set(enabled, forKey: "rebirth.medications.enabled")

        guard enabled else {
            call.resolve(["enabled": false, "authorized": false])
            return
        }
        guard #available(iOS 26.0, *) else {
            call.resolve(["enabled": true, "authorized": false, "reason": "ios_too_old"])
            return
        }
        let medType = HKObjectType.userAnnotatedMedicationType()
        healthStore.requestPerObjectReadAuthorization(for: medType, predicate: nil) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(["enabled": true, "authorized": success])
        }
    }

    /// Requests per-object read authorization for iOS 26 Medications.
    ///
    /// Medications use a DIFFERENT authorization model than the rest of HealthKit. Putting
    /// HKUserAnnotatedMedicationType (or HKMedicationDoseEventType) into the standard
    /// requestAuthorization(toShare:read:) call throws NSException
    /// "AuthorizationDisallowedForSharing" and aborts the process. Apple is explicit about
    /// this in the requestPerObjectReadAuthorization docs.
    ///
    /// The right path: HKHealthStore.requestPerObjectReadAuthorization(for:predicate:)
    /// shows a per-medication chooser sheet. The user picks which meds the app can read.
    /// Subsequent fetchMedicationRecords queries return only the chosen meds' dose events.
    ///
    /// Call from JS once setMedicationsEnabled(true) has been set, e.g. via a "connect
    /// medications" button in the permissions sheet.
    @objc public func requestMedicationsAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false, "reason": "not_available"])
            return
        }
        guard #available(iOS 26.0, *) else {
            call.resolve(["granted": false, "reason": "ios_too_old"])
            return
        }
        let medType = HKObjectType.userAnnotatedMedicationType()
        healthStore.requestPerObjectReadAuthorization(for: medType, predicate: nil) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            call.resolve(["granted": success])
        }
    }

    // MARK: - Legacy reads (backwards-compat with pre-expansion TS bridge)

    @objc public func getSteps(_ call: CAPPluginCall) {
        quantitySum(call: call, identifier: .stepCount, unit: HKUnit.count())
    }

    @objc public func getActiveCalories(_ call: CAPPluginCall) {
        quantitySum(call: call, identifier: .activeEnergyBurned, unit: .kilocalorie())
    }

    @objc public func getRecentWorkouts(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["workouts": []])
            return
        }
        let startMs = call.getDouble("startTime") ?? sevenDaysAgoMs()
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: Date(), options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate,
                                  limit: 10, sortDescriptors: [sort]) { [weak self] _, samples, _ in
            let workouts = (samples as? [HKWorkout] ?? []).map { self?.workoutToLegacyDict($0) ?? [:] }
            call.resolve(["workouts": workouts])
        }
        healthStore.execute(query)
    }

    @objc public func getWorkouts(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["workouts": []])
            return
        }
        let startMs = call.getDouble("startTime") ?? sevenDaysAgoMs()
        let endMs = call.getDouble("endTime") ?? Date().timeIntervalSince1970 * 1000
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { [weak self] _, samples, _ in
            let workouts = (samples as? [HKWorkout] ?? []).map { self?.workoutToLegacyDict($0) ?? [:] }
            call.resolve(["workouts": workouts])
        }
        healthStore.execute(query)
    }

    @objc public func getHeartRate(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["samples": []])
            return
        }
        guard let hrType = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            call.resolve(["samples": []])
            return
        }
        let startMs = call.getDouble("startTime") ?? Date().addingTimeInterval(-3600).timeIntervalSince1970 * 1000
        let endMs = call.getDouble("endTime") ?? Date().timeIntervalSince1970 * 1000
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: hrType, predicate: predicate,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, _ in
            let bpmUnit = HKUnit.count().unitDivided(by: .minute())
            let out = (samples as? [HKQuantitySample] ?? []).map { s -> [String: Any] in
                [
                    "bpm": Int(s.quantity.doubleValue(for: bpmUnit)),
                    "timestamp": s.startDate.timeIntervalSince1970 * 1000
                ]
            }
            call.resolve(["samples": out])
        }
        healthStore.execute(query)
    }

    // MARK: - New: fetchDailyAggregates (quantity metrics only, NO anchor)

    /// Fetch daily aggregate stats for one or more quantity metrics over a date window.
    ///
    /// Per-metric aggregation option:
    ///   cumulativeSum: steps, active_energy, basal_energy, exercise_minutes
    ///   discreteAverage+min+max: heart_rate, hrv, resting_hr, vo2_max
    ///
    /// HRV and resting HR are filtered to Apple Watch / iPhone native sources
    /// (bundleIdentifier starting "com.apple.") — averaging Whoop/Watch HRV
    /// with different methodology produces meaningless numbers.
    ///
    /// No anchor — HKStatisticsCollectionQuery has no anchor API. Call site
    /// supplies a 2-day overlap window via `startTime` to cover late edits.
    @objc public func fetchDailyAggregates(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["results": []])
            return
        }
        guard let metricsArray = call.getArray("metrics") as? [String],
              let startMs = call.getDouble("startTime") as Double?,
              let endMs = call.getDouble("endTime") as Double? else {
            call.reject("metrics, startTime, endTime required")
            return
        }
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

        // Day boundaries use device calendar. v1.5: configurable user timezone.
        let cal = Calendar.current
        let anchor = cal.startOfDay(for: startDate)

        let group = DispatchGroup()
        var rows: [[String: Any]] = []
        let rowsLock = NSLock()
        var firstError: String?

        for metric in metricsArray {
            guard let spec = Self.metricSpec(metric) else { continue }
            group.enter()

            let predicateForStart = cal.startOfDay(for: startDate)
            let basePredicate = HKQuery.predicateForSamples(withStart: predicateForStart, end: endDate, options: .strictStartDate)

            // Note on source filtering: HealthKit rejects generic NSPredicate key
            // paths like "sourceRevision.source.bundleIdentifier" at query init
            // (throws NSException → SIGABRT, crashing the whole process). The only
            // legal source filter is HKQuery.predicateForObjects(from: Set<HKSource>),
            // which requires an async HKSourceQuery first. Deferred to v1.5; for
            // v1 we accept all sources. Single-device users (Apple Watch only) are
            // unaffected. Revisit if multi-source HRV drift becomes a real issue.
            let predicate = basePredicate

            let query = HKStatisticsCollectionQuery(
                quantityType: spec.type,
                quantitySamplePredicate: predicate,
                options: spec.options,
                anchorDate: anchor,
                intervalComponents: DateComponents(day: 1)
            )
            query.initialResultsHandler = { _, results, err in
                defer { group.leave() }
                if let err = err {
                    firstError = err.localizedDescription
                    return
                }
                guard let results = results else { return }
                results.enumerateStatistics(from: anchor, to: endDate) { stats, _ in
                    let dateStr = Self.ymdString(stats.startDate, calendar: cal)
                    var row: [String: Any] = [
                        "metric": metric,
                        "date": dateStr
                    ]
                    if spec.options.contains(.cumulativeSum),
                       let sumQ = stats.sumQuantity() {
                        row["value_sum"] = sumQ.doubleValue(for: spec.unit)
                    }
                    if spec.options.contains(.discreteAverage),
                       let avgQ = stats.averageQuantity() {
                        row["value_avg"] = avgQ.doubleValue(for: spec.unit)
                    }
                    if spec.options.contains(.discreteMin),
                       let minQ = stats.minimumQuantity() {
                        row["value_min"] = minQ.doubleValue(for: spec.unit)
                    }
                    if spec.options.contains(.discreteMax),
                       let maxQ = stats.maximumQuantity() {
                        row["value_max"] = maxQ.doubleValue(for: spec.unit)
                    }
                    // count: HK doesn't expose per-bucket sample count directly on
                    // HKStatistics; approximate as "had data" (1) vs "no data" (0).
                    row["count"] = (stats.sumQuantity() != nil || stats.averageQuantity() != nil) ? 1 : 0
                    row["source_primary"] = Self.primarySourceId(stats)
                    rowsLock.lock()
                    rows.append(row)
                    rowsLock.unlock()
                }
            }
            healthStore.execute(query)
        }

        group.notify(queue: .main) {
            if let err = firstError {
                call.reject(err)
                return
            }
            call.resolve(["results": rows])
        }
    }

    // MARK: - New: fetchSleepNights (anchored, HKCategoryType)

    /// Anchored incremental fetch of sleep samples, grouped into nights.
    /// A "night" is a contiguous run of sleep/inBed samples with <14h gap,
    /// keyed to the wake date.
    @objc public func fetchSleepNights(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable(),
              let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.resolve(["nights": [], "deleted": [], "nextAnchor": ""])
            return
        }
        let startMs = call.getDouble("startTime") ?? Date().addingTimeInterval(-90*24*3600).timeIntervalSince1970 * 1000
        let endMs = call.getDouble("endTime") ?? Date().timeIntervalSince1970 * 1000
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

        let anchor = Self.decodeAnchor(call.getString("anchor"))
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])

        let query = HKAnchoredObjectQuery(
            type: sleepType,
            predicate: predicate,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, deleted, newAnchor, err in
            guard let self = self else { return }
            if let err = err {
                call.reject(err.localizedDescription)
                return
            }
            let catSamples = (samples as? [HKCategorySample]) ?? []
            let nights = self.groupSleepIntoNights(catSamples)
            let deletedUuids = (deleted ?? []).map { $0.uuid.uuidString }
            let anchorString = Self.encodeAnchor(newAnchor)
            call.resolve([
                "nights": nights,
                "deleted": deletedUuids,
                "nextAnchor": anchorString
            ])
        }
        healthStore.execute(query)
    }

    // MARK: - New: fetchWorkouts (anchored)

    /// Anchored incremental fetch of workouts. Returns new + deleted since anchor.
    @objc public func fetchWorkouts(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["workouts": [], "deleted": [], "nextAnchor": ""])
            return
        }
        let startMs = call.getDouble("startTime") ?? Date().addingTimeInterval(-90*24*3600).timeIntervalSince1970 * 1000
        let endMs = call.getDouble("endTime") ?? Date().timeIntervalSince1970 * 1000
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

        let anchor = Self.decodeAnchor(call.getString("anchor"))
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])

        let query = HKAnchoredObjectQuery(
            type: HKObjectType.workoutType(),
            predicate: predicate,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, deleted, newAnchor, err in
            guard let self = self else { return }
            if let err = err {
                call.reject(err.localizedDescription)
                return
            }
            let workouts = ((samples as? [HKWorkout]) ?? []).map { self.workoutToFullDict($0) }
            let deletedUuids = (deleted ?? []).map { $0.uuid.uuidString }
            let anchorString = Self.encodeAnchor(newAnchor)
            call.resolve([
                "workouts": workouts,
                "deleted": deletedUuids,
                "nextAnchor": anchorString
            ])
        }
        healthStore.execute(query)
    }

    // MARK: - New: fetchMedicationRecords (iOS 26+ Medications feature)
    //
    // Gated by:
    //   1. iOS 26+ (HKMedicationDoseEvent symbol availability — older OS no-ops)
    //   2. UserDefaults flag "rebirth.medications.enabled" (default false until
    //      Lou verifies the iOS 26 launch crash is fixed on a real device)
    //
    // To enable on device: HealthKit.setMedicationsEnabled({enabled: true}) from
    // the JS bridge, then relaunch. The flag is read at requestAuthorization time
    // so the iOS sheet will then surface a Medications toggle on next prompt.
    @objc public func fetchMedicationRecords(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["medications": [], "deleted": [], "nextAnchor": ""])
            return
        }

        guard #available(iOS 26.0, *) else {
            call.resolve(["medications": [], "deleted": [], "nextAnchor": ""])
            return
        }

        guard UserDefaults.standard.bool(forKey: "rebirth.medications.enabled") else {
            call.resolve(["medications": [], "deleted": [], "nextAnchor": ""])
            return
        }

        let medicationType = HKObjectType.medicationDoseEventType()

        let startMs = call.getDouble("startTime") ?? Date().addingTimeInterval(-365*24*3600).timeIntervalSince1970 * 1000
        let endMs = call.getDouble("endTime") ?? Date().timeIntervalSince1970 * 1000
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)

        let anchor = Self.decodeAnchor(call.getString("anchor"))
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: [])

        // Two-phase fetch:
        //   1. HKUserAnnotatedMedicationQuery → list of named medications (nickname,
        //      schedule, archived state). Emitted as the `annotatedMedications` array.
        //   2. HKAnchoredObjectQuery on HKMedicationDoseEvent → the dose events
        //      themselves with timestamps and log_status. Emitted as `medications`.
        //
        // We CAN'T link a dose to its parent medication on iOS 26.3.1 — see
        // docs/healthkit-medications-name-linkage.md for the full investigation.
        // Per-dose `medication_name` stays "Unknown medication" until Apple closes
        // the API gap. Callers should aggregate per-medication metrics from the
        // two arrays separately.
        var annotatedMedications: [[String: Any]] = []
        let nameQuery = HKUserAnnotatedMedicationQuery(
            predicate: nil,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, med, done, _ in
            guard let self = self else { return }
            if let med = med {
                let name = med.nickname ?? med.medication.displayText
                annotatedMedications.append([
                    "name": name,
                    "is_archived": med.isArchived,
                    "has_schedule": med.hasSchedule,
                    "concept_display_text": med.medication.displayText,
                ])
            }
            if done {
                let doseQuery = HKAnchoredObjectQuery(
                    type: medicationType,
                    predicate: predicate,
                    anchor: anchor,
                    limit: HKObjectQueryNoLimit
                ) { _, samples, deleted, newAnchor, err in
                    if let err = err {
                        call.reject(err.localizedDescription)
                        return
                    }
                    let doseSamples = (samples as? [HKMedicationDoseEvent]) ?? []
                    let medications: [[String: Any]] = doseSamples.map { dose in
                        let doseString = Self.formatDoseString(dose: dose)
                        let scheduledMs: Double? = dose.scheduledDate.map { $0.timeIntervalSince1970 * 1000.0 }
                        let logStatusStr = Self.logStatusString(dose.logStatus)
                        let scheduleTypeStr = Self.scheduleTypeString(dose.scheduleType)
                        let metaJsonString = Self.jsonString([
                            "log_status": logStatusStr,
                            "schedule_type": scheduleTypeStr,
                            "unit": dose.unit.unitString,
                        ])
                        var dict: [String: Any] = [
                            "hk_uuid": dose.uuid.uuidString,
                            "medication_name": "Unknown medication",
                            "taken_at": dose.startDate.timeIntervalSince1970 * 1000.0,
                            "source_name": dose.sourceRevision.source.name,
                            "source_bundle_id": dose.sourceRevision.source.bundleIdentifier,
                            "metadata_json": metaJsonString,
                        ]
                        if let doseString = doseString { dict["dose_string"] = doseString }
                        if let scheduledMs = scheduledMs { dict["scheduled_at"] = scheduledMs }
                        return dict
                    }
                    let deletedUuids = (deleted ?? []).map { $0.uuid.uuidString }
                    let anchorString = Self.encodeAnchor(newAnchor)
                    call.resolve([
                        "medications": medications,
                        "deleted": deletedUuids,
                        "nextAnchor": anchorString,
                        "annotatedMedications": annotatedMedications,
                    ])
                }
                self.healthStore.execute(doseQuery)
            }
        }
        healthStore.execute(nameQuery)
    }

    /// "<qty> <unit>" — falls back to the scheduled quantity if the actual
    /// dose isn't recorded (e.g. for an upcoming scheduled dose).
    @available(iOS 26.0, *)
    private static func formatDoseString(dose: HKMedicationDoseEvent) -> String? {
        let qty = dose.doseQuantity ?? dose.scheduledDoseQuantity
        guard let qty = qty else { return nil }
        return "\(qty) \(dose.unit.unitString)"
    }

    @available(iOS 26.0, *)
    private static func logStatusString(_ status: HKMedicationDoseEvent.LogStatus) -> String {
        switch status {
        case .notInteracted: return "not_interacted"
        case .notificationNotSent: return "notification_not_sent"
        case .snoozed: return "snoozed"
        case .taken: return "taken"
        case .skipped: return "skipped"
        case .notLogged: return "not_logged"
        @unknown default: return "unknown"
        }
    }

    @available(iOS 26.0, *)
    private static func scheduleTypeString(_ type: HKMedicationDoseEvent.ScheduleType) -> String {
        switch type {
        case .asNeeded: return "as_needed"
        case .schedule: return "schedule"
        @unknown default: return "unknown"
        }
    }

    // MARK: - Workout write (existing)

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

        var metadata: [String: Any] = [:]
        if let uuid = call.getString("uuid") {
            metadata[HKMetadataKeyExternalUUID] = uuid
            metadata["REBIRTH_WORKOUT_UUID"] = uuid
        }
        if let metadataJson = call.getString("metadata") {
            metadata["rebirthMetadata"] = metadataJson
        }

        builder.beginCollection(withStart: startDate) { success, error in
            guard success else {
                call.reject("Failed to begin workout collection: \(error?.localizedDescription ?? "unknown")")
                return
            }

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
                            call.resolve([
                                "saved": true,
                                "hk_uuid": workout?.uuid.uuidString ?? ""
                            ])
                        }
                    }
                }

                if !metadata.isEmpty {
                    builder.addMetadata(metadata) { _, _ in finishCollection() }
                } else {
                    finishCollection()
                }
            }
        }
    }

    // MARK: - New: saveNutrition (atomic multi-sample)

    /// Writes dietary samples (energy + protein + carbs + fat + water) atomically.
    /// Nil/missing fields are skipped so partial meals still work.
    @objc public func saveNutrition(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available")
            return
        }
        guard let tsMs = call.getDouble("timestamp"),
              let mealUuid = call.getString("mealUuid") else {
            call.reject("timestamp and mealUuid required")
            return
        }
        let date = Date(timeIntervalSince1970: tsMs / 1000.0)
        let metadata: [String: Any] = [
            HKMetadataKeyExternalUUID: mealUuid,
            "REBIRTH_MEAL_UUID": mealUuid
        ]

        var samples: [HKSample] = []
        var typeTags: [String] = []

        func addQuantity(_ identifier: HKQuantityTypeIdentifier, _ unit: HKUnit, _ value: Double?, _ tag: String) {
            guard let v = value, v > 0, let type = HKQuantityType.quantityType(forIdentifier: identifier) else { return }
            let qty = HKQuantity(unit: unit, doubleValue: v)
            let s = HKQuantitySample(type: type, quantity: qty, start: date, end: date, metadata: metadata)
            samples.append(s)
            typeTags.append(tag)
        }

        addQuantity(.dietaryEnergyConsumed, .kilocalorie(), call.getDouble("kcal"), "dietary_energy")
        addQuantity(.dietaryProtein, .gram(), call.getDouble("proteinG"), "dietary_protein")
        addQuantity(.dietaryCarbohydrates, .gram(), call.getDouble("carbsG"), "dietary_carbs")
        addQuantity(.dietaryFatTotal, .gram(), call.getDouble("fatG"), "dietary_fat")
        addQuantity(.dietaryWater, .literUnit(with: .milli), call.getDouble("waterMl"), "dietary_water")

        if samples.isEmpty {
            call.resolve(["saved": true, "samples": []])
            return
        }

        healthStore.save(samples) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            if !success {
                call.reject("HKHealthStore.save returned false")
                return
            }
            let out: [[String: String]] = zip(samples, typeTags).map { (sample, tag) in
                return ["hk_uuid": sample.uuid.uuidString, "hk_type": tag]
            }
            call.resolve(["saved": true, "samples": out])
        }
    }

    // MARK: - New: saveBodyComposition

    /// Writes body mass / body fat % / lean mass atomically.
    @objc public func saveBodyComposition(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available")
            return
        }
        guard let tsMs = call.getDouble("timestamp"),
              let inbodyUuid = call.getString("inbodyUuid") else {
            call.reject("timestamp and inbodyUuid required")
            return
        }
        let date = Date(timeIntervalSince1970: tsMs / 1000.0)
        // Note: HealthKit has no public "body mass measurement source" metadata key.
        // Stamping a Rebirth-owned key for our own round-trip tracking.
        let metadata: [String: Any] = [
            HKMetadataKeyExternalUUID: inbodyUuid,
            "REBIRTH_INBODY_UUID": inbodyUuid,
            "REBIRTH_SOURCE": "inbody_570_bioelectrical_impedance"
        ]

        var samples: [HKSample] = []
        var typeTags: [String] = []

        if let kg = call.getDouble("weightKg"), kg > 0,
           let type = HKQuantityType.quantityType(forIdentifier: .bodyMass) {
            let qty = HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: kg)
            samples.append(HKQuantitySample(type: type, quantity: qty, start: date, end: date, metadata: metadata))
            typeTags.append("body_mass")
        }
        if let pct = call.getDouble("bodyFatPct"), pct >= 0,
           let type = HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage) {
            // bodyFatPercentage uses percent as 0..1
            let qty = HKQuantity(unit: HKUnit.percent(), doubleValue: pct / 100.0)
            samples.append(HKQuantitySample(type: type, quantity: qty, start: date, end: date, metadata: metadata))
            typeTags.append("body_fat_percentage")
        }
        if let leanKg = call.getDouble("leanKg"), leanKg > 0,
           let type = HKQuantityType.quantityType(forIdentifier: .leanBodyMass) {
            let qty = HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: leanKg)
            samples.append(HKQuantitySample(type: type, quantity: qty, start: date, end: date, metadata: metadata))
            typeTags.append("lean_body_mass")
        }

        if samples.isEmpty {
            call.resolve(["saved": true, "samples": []])
            return
        }

        healthStore.save(samples) { success, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            if !success {
                call.reject("HKHealthStore.save returned false")
                return
            }
            let out: [[String: String]] = zip(samples, typeTags).map { (sample, tag) in
                return ["hk_uuid": sample.uuid.uuidString, "hk_type": tag]
            }
            call.resolve(["saved": true, "samples": out])
        }
    }

    // MARK: - New: deleteSamples

    /// Deletes HealthKit samples by UUID. Used to clean up our prior writes on
    /// meal/scan edits. Failures are soft — caller marks pending_delete and retries.
    @objc public func deleteSamples(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["deleted": 0, "failed": []])
            return
        }
        guard let uuidStrings = call.getArray("uuids") as? [String] else {
            call.reject("uuids array required")
            return
        }
        if uuidStrings.isEmpty {
            call.resolve(["deleted": 0, "failed": []])
            return
        }

        let uuids = uuidStrings.compactMap { UUID(uuidString: $0) }
        let predicate = NSPredicate(format: "%K IN %@", HKPredicateKeyPathUUID, uuids)

        // We have to query each relevant type and delete matching objects — HK
        // doesn't offer a type-agnostic deletion API.
        let typesToSearch: [HKSampleType] = HealthKitTypes.allWritableTypesForDelete()
        let group = DispatchGroup()
        var deletedCount = 0
        var failed: [String] = []
        let lock = NSLock()

        for type in typesToSearch {
            group.enter()
            let q = HKSampleQuery(sampleType: type, predicate: predicate,
                                  limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, found, err in
                guard let self = self else { group.leave(); return }
                if err != nil || (found?.isEmpty ?? true) { group.leave(); return }
                self.healthStore.delete(found ?? []) { success, _ in
                    lock.lock()
                    if success {
                        deletedCount += (found?.count ?? 0)
                    } else {
                        failed.append(contentsOf: (found ?? []).map { $0.uuid.uuidString })
                    }
                    lock.unlock()
                    group.leave()
                }
            }
            healthStore.execute(q)
        }

        group.notify(queue: .main) {
            call.resolve(["deleted": deletedCount, "failed": failed])
        }
    }

    // MARK: - Helpers

    private func quantitySum(call: CAPPluginCall, identifier: HKQuantityTypeIdentifier, unit: HKUnit) {
        guard HKHealthStore.isHealthDataAvailable(),
              let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
            call.resolve(["value": 0])
            return
        }
        let startMs = call.getDouble("startTime") ?? startOfTodayMs()
        let endMs = call.getDouble("endTime") ?? Date().timeIntervalSince1970 * 1000
        let startDate = Date(timeIntervalSince1970: startMs / 1000.0)
        let endDate = Date(timeIntervalSince1970: endMs / 1000.0)
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate, options: .strictStartDate)
        let q = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate,
                                  options: .cumulativeSum) { _, result, _ in
            let value = result?.sumQuantity()?.doubleValue(for: unit) ?? 0
            call.resolve(["value": Int(value)])
        }
        healthStore.execute(q)
    }

    /// Group HKCategorySample[] into nights. A "night" is a contiguous group of
    /// sleep/inBed samples with no gap >14h between them. Night key is the
    /// calendar date of the last wake time.
    private func groupSleepIntoNights(_ samples: [HKCategorySample]) -> [[String: Any]] {
        guard !samples.isEmpty else { return [] }
        let sorted = samples.sorted { $0.startDate < $1.startDate }

        // Cluster samples by gap
        var clusters: [[HKCategorySample]] = []
        var current: [HKCategorySample] = []
        var lastEnd: Date?
        let clusterGap: TimeInterval = 14 * 3600
        for s in sorted {
            if let le = lastEnd, s.startDate.timeIntervalSince(le) > clusterGap {
                if !current.isEmpty { clusters.append(current) }
                current = []
            }
            current.append(s)
            lastEnd = max(lastEnd ?? s.endDate, s.endDate)
        }
        if !current.isEmpty { clusters.append(current) }

        let cal = Calendar.current
        return clusters.map { cluster -> [String: Any] in
            var asleep = 0.0, rem = 0.0, deep = 0.0, core = 0.0, awake = 0.0, inBed = 0.0
            let start = cluster.first?.startDate ?? Date()
            let end = cluster.last?.endDate ?? Date()
            for s in cluster {
                let mins = s.endDate.timeIntervalSince(s.startDate) / 60.0
                if #available(iOS 16, *) {
                    switch s.value {
                    case HKCategoryValueSleepAnalysis.asleepREM.rawValue: rem += mins; asleep += mins
                    case HKCategoryValueSleepAnalysis.asleepDeep.rawValue: deep += mins; asleep += mins
                    case HKCategoryValueSleepAnalysis.asleepCore.rawValue: core += mins; asleep += mins
                    case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue: asleep += mins
                    case HKCategoryValueSleepAnalysis.awake.rawValue: awake += mins
                    case HKCategoryValueSleepAnalysis.inBed.rawValue: inBed += mins
                    default: break
                    }
                } else {
                    // iOS 15 only had asleep / inBed / awake
                    switch s.value {
                    case HKCategoryValueSleepAnalysis.inBed.rawValue: inBed += mins
                    case HKCategoryValueSleepAnalysis.awake.rawValue: awake += mins
                    default: asleep += mins
                    }
                }
            }
            // inBed samples typically span the whole night and overlap with asleep
            // samples from Watch. Keep them separate — caller can choose.
            let wakeDate = Self.ymdString(end, calendar: cal)
            return [
                "date": wakeDate,
                "start_at": start.timeIntervalSince1970 * 1000,
                "end_at": end.timeIntervalSince1970 * 1000,
                "asleep_min": Int(asleep),
                "rem_min": Int(rem),
                "deep_min": Int(deep),
                "core_min": Int(core),
                "awake_min": Int(awake),
                "in_bed_min": Int(inBed)
            ]
        }
    }

    private func workoutToLegacyDict(_ w: HKWorkout) -> [String: Any] {
        let durationMins = w.duration / 60.0
        let calories = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()) ?? 0
        let distance = w.totalDistance?.doubleValue(for: .meter()) ?? 0
        return [
            "startTime": w.startDate.timeIntervalSince1970 * 1000,
            "endTime": w.endDate.timeIntervalSince1970 * 1000,
            "durationMinutes": Int(durationMins),
            "activeCalories": Int(calories),
            "distanceMeters": Int(distance),
            "activityType": Self.activityTypeName(w.workoutActivityType),
        ]
    }

    private func workoutToFullDict(_ w: HKWorkout) -> [String: Any] {
        // Only include keys with real values. Capacitor's JSCore bridge does not
        // safely serialize NSNull in nested dicts, so missing optionals are omitted
        // entirely — the TS side treats missing as null.
        var meta: [String: Any] = [:]
        for (k, v) in w.metadata ?? [:] {
            if let str = v as? String { meta[k] = str }
            else if let num = v as? NSNumber { meta[k] = num }
        }
        let rebirthUuid = (meta["REBIRTH_WORKOUT_UUID"] as? String) ?? (meta[HKMetadataKeyExternalUUID] as? String)
        var dict: [String: Any] = [
            "hk_uuid": w.uuid.uuidString,
            "activity_type": Self.activityTypeName(w.workoutActivityType),
            "start_at": w.startDate.timeIntervalSince1970 * 1000,
            "end_at": w.endDate.timeIntervalSince1970 * 1000,
            "duration_s": Int(w.duration),
            "source_name": w.sourceRevision.source.name,
            "source_bundle_id": w.sourceRevision.source.bundleIdentifier,
            "metadata_json": Self.jsonString(meta),
        ]
        if let energy = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()) {
            dict["total_energy_kcal"] = energy
        }
        if let distance = w.totalDistance?.doubleValue(for: .meter()) {
            dict["total_distance_m"] = distance
        }
        if let r = rebirthUuid { dict["rebirth_workout_uuid"] = r }
        return dict
    }

    // MARK: - Anchor codec

    private static func encodeAnchor(_ anchor: HKQueryAnchor?) -> String {
        guard let anchor = anchor else { return "" }
        do {
            let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
            return data.base64EncodedString()
        } catch {
            return ""
        }
    }

    private static func decodeAnchor(_ str: String?) -> HKQueryAnchor? {
        guard let str = str, !str.isEmpty, let data = Data(base64Encoded: str) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    // MARK: - Metric spec

    private struct MetricSpec {
        let type: HKQuantityType
        let unit: HKUnit
        let options: HKStatisticsOptions
    }

    private static func metricSpec(_ metric: String) -> MetricSpec? {
        switch metric {
        case "steps":
            guard let t = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return nil }
            return MetricSpec(type: t, unit: .count(), options: [.cumulativeSum])
        case "active_energy":
            guard let t = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) else { return nil }
            return MetricSpec(type: t, unit: .kilocalorie(), options: [.cumulativeSum])
        case "basal_energy":
            guard let t = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned) else { return nil }
            return MetricSpec(type: t, unit: .kilocalorie(), options: [.cumulativeSum])
        case "exercise_minutes":
            guard let t = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) else { return nil }
            return MetricSpec(type: t, unit: .minute(), options: [.cumulativeSum])
        case "heart_rate":
            guard let t = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return nil }
            return MetricSpec(type: t, unit: HKUnit.count().unitDivided(by: .minute()),
                              options: [.discreteAverage, .discreteMin, .discreteMax])
        case "hrv":
            guard let t = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN) else { return nil }
            return MetricSpec(type: t, unit: .secondUnit(with: .milli),
                              options: [.discreteAverage, .discreteMin, .discreteMax])
        case "resting_hr":
            guard let t = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) else { return nil }
            return MetricSpec(type: t, unit: HKUnit.count().unitDivided(by: .minute()),
                              options: [.discreteAverage, .discreteMin, .discreteMax])
        case "vo2_max":
            guard let t = HKQuantityType.quantityType(forIdentifier: .vo2Max) else { return nil }
            return MetricSpec(type: t,
                              unit: HKUnit(from: "ml/kg*min"),
                              options: [.discreteAverage, .discreteMin, .discreteMax])
        default:
            return nil
        }
    }

    private static func primarySourceId(_ stats: HKStatistics) -> String {
        let sources = stats.sources ?? []
        return sources.first?.bundleIdentifier ?? ""
    }

    // MARK: - Permission type sets

    // The request set + per-key resolution lives in HealthKitTypes, generated
    // from src/lib/healthkit-types.json by scripts/gen-healthkit-types.mjs.
    // The CI drift test (src/lib/healthkit-drift.test.ts) verifies the generated
    // file is up to date on every push to main.

    private static func authStatusString(_ status: HKAuthorizationStatus) -> String {
        switch status {
        case .sharingAuthorized: return "granted"
        case .sharingDenied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "notDetermined"
        }
    }

    // MARK: - Misc

    private func startOfTodayMs() -> Double {
        Calendar.current.startOfDay(for: Date()).timeIntervalSince1970 * 1000
    }

    private func sevenDaysAgoMs() -> Double {
        (Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()).timeIntervalSince1970 * 1000
    }

    private static func ymdString(_ date: Date, calendar: Calendar) -> String {
        let comps = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", comps.year ?? 0, comps.month ?? 0, comps.day ?? 0)
    }

    private static func jsonString(_ obj: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              let str = String(data: data, encoding: .utf8) else { return "{}" }
        return str
    }

    private static func activityTypeName(_ type: HKWorkoutActivityType) -> String {
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
        case .mixedCardio: return "Mixed Cardio"
        case .coreTraining: return "Core Training"
        default: return "Workout"
        }
    }
}
