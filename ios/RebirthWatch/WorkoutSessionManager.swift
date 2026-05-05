import Foundation
import HealthKit
import RebirthWatchLog

/// Manages the watch-side HKWorkoutSession + HKLiveWorkoutBuilder lifecycle
/// for strength workouts. Replaces the iOS-side 6kcal/min stub with real HR
/// + active energy collection from the watch's sensors.
///
/// State machine:
///   .idle → .requestingAuth → .running → .saving → .saved | .failed
///
/// Lou-facing semantics:
///   - Session starts the first time a set is approved within a workout
///     (auto-start; no extra tap needed).
///   - Session ends when the user taps "Finish & Save" on the Day 10
///     session-end screen, OR when this manager's `endSession()` is called
///     from outside.
///   - On finish, an HKMetadataKeyExternalUUID is stamped with the Rebirth
///     workout UUID so phone-side `fetchWorkouts` can dedup against the
///     phone's `workouts.healthkit_uuid` once we round-trip the HK uuid back.
@MainActor
final class WorkoutSessionManager: NSObject, ObservableObject {
    enum State: Equatable {
        case idle
        case requestingAuth
        case running
        case saving
        case saved(rebirthUUID: String, hkUUID: String?)
        case failed(String)
    }

    @Published var state: State = .idle
    @Published var currentHeartRate: Int?
    @Published var elapsedSeconds: Int = 0
    @Published var activeEnergyKcal: Double = 0

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let log = RebirthWatchLog.shared

    private(set) var rebirthWorkoutUUID: String?
    private var startedAt: Date?
    private var elapsedTimer: Timer?

    // MARK: - Lifecycle

    /// Begin a strength session for the given Rebirth workout UUID. Idempotent
    /// while a session is running for the same workout. Returns immediately;
    /// observes state via @Published.
    func beginSession(rebirthWorkoutUUID: String) {
        if case .running = state, self.rebirthWorkoutUUID == rebirthWorkoutUUID {
            return
        }
        guard HKHealthStore.isHealthDataAvailable() else {
            log.error("HealthKit not available on this device")
            state = .failed("HK unavailable")
            return
        }
        state = .requestingAuth
        Task { await requestAuthAndStart(rebirthWorkoutUUID: rebirthWorkoutUUID) }
    }

    private func requestAuthAndStart(rebirthWorkoutUUID: String) async {
        let typesToShare: Set<HKSampleType> = [
            HKObjectType.workoutType(),
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
        ]
        let typesToRead: Set<HKObjectType> = [
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
        ]
        do {
            try await healthStore.requestAuthorization(toShare: typesToShare, read: typesToRead)
        } catch {
            log.error("HK auth request failed: \(error.localizedDescription)")
            state = .failed("HK auth failed")
            return
        }

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)
            session.delegate = self
            builder.delegate = self
            self.session = session
            self.builder = builder
            self.rebirthWorkoutUUID = rebirthWorkoutUUID
            self.startedAt = Date()

            session.startActivity(with: Date())
            try await builder.beginCollection(at: Date())

            // Stamp the external UUID so phone-side fetchWorkouts can dedup.
            let metadata: [String: Any] = [
                HKMetadataKeyExternalUUID: rebirthWorkoutUUID,
            ]
            try await builder.addMetadata(metadata)

            state = .running
            startElapsedTimer()
            log.info("HKWorkoutSession started for \(rebirthWorkoutUUID)")
        } catch {
            log.error("Begin session failed: \(error.localizedDescription)")
            state = .failed("session begin failed")
        }
    }

    /// End the current session, finishing the workout and writing it to
    /// HealthKit. On success, transitions to `.saved` with the assigned
    /// HK UUID — caller can then push it to the phone via WC.
    func endSession() async {
        guard let session, let builder, let rebirthUUID = rebirthWorkoutUUID else { return }
        state = .saving
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        do {
            session.end()
            try await builder.endCollection(at: Date())
            let workout = try await builder.finishWorkout()
            let hkUUID = workout?.uuid.uuidString
            log.info("HKWorkout saved: rebirth=\(rebirthUUID) hk=\(hkUUID ?? "nil")")
            state = .saved(rebirthUUID: rebirthUUID, hkUUID: hkUUID)
        } catch {
            log.error("End session failed: \(error.localizedDescription)")
            state = .failed("save failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Internals

    private func startElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let started = self.startedAt else { return }
                self.elapsedSeconds = Int(Date().timeIntervalSince(started))
            }
        }
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WorkoutSessionManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        Task { @MainActor in
            self.log.info("Session state \(fromState.rawValue) → \(toState.rawValue)")
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in
            self.log.error("Session error: \(error.localizedDescription)")
            self.state = .failed("session error")
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WorkoutSessionManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let quantity = type as? HKQuantityType else { continue }
            let stat = workoutBuilder.statistics(for: quantity)
            if quantity.identifier == HKQuantityTypeIdentifier.heartRate.rawValue {
                let mostRecent = stat?.mostRecentQuantity()
                let unit = HKUnit.count().unitDivided(by: .minute())
                if let bpm = mostRecent?.doubleValue(for: unit) {
                    Task { @MainActor in self.currentHeartRate = Int(bpm.rounded()) }
                }
            }
            if quantity.identifier == HKQuantityTypeIdentifier.activeEnergyBurned.rawValue {
                let total = stat?.sumQuantity()?.doubleValue(for: .kilocalorie())
                if let kcal = total {
                    Task { @MainActor in self.activeEnergyKcal = kcal }
                }
            }
        }
    }
}
