import Foundation
import WatchConnectivity
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

/// Watch-side WCSessionDelegate. Reads the latest snapshot from App Group
/// UserDefaults on launch (the previous-session cache), and overwrites it
/// when the phone pushes a new one via `updateApplicationContext`.
@MainActor
final class WatchSessionStore: NSObject, ObservableObject, WCSessionDelegate {
    @Published var snapshot: ActiveWorkoutSnapshot?
    @Published var isActivating: Bool = true
    @Published var lastReceivedAt: Date?

    private let appGroup = RebirthAppGroup()
    private let log = RebirthWatchLog.shared

    func activate() {
        // Cold-start: read previous snapshot eagerly so UI is instant.
        loadFromAppGroup()

        #if WATCH_MOCK_SNAPSHOT
        if snapshot == nil {
            snapshot = MockSnapshot.midStrengthSession
            log.info("Loaded mock snapshot (WATCH_MOCK_SNAPSHOT)")
            isActivating = false
            return
        }
        #endif

        guard WCSession.isSupported() else {
            isActivating = false
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func loadFromAppGroup() {
        do {
            if let s = try appGroup.readSnapshot() {
                snapshot = s
                log.info("Loaded snapshot from app group, exercises=\(s.exercises.count)")
            }
        } catch {
            log.error("Failed to read snapshot: \(error)")
        }
    }

    /// Write the inbound envelope to App Group UserDefaults so cold-launches
    /// after a session have something to render. Mirrors the encoding the
    /// iOS plugin produces: `{ schema_version, body: <ActiveWorkoutSnapshot> }`.
    private func persistEnvelope(_ envelope: [String: Any]) {
        do {
            let data = try JSONSerialization.data(withJSONObject: envelope, options: [])
            appGroup.defaults?.set(data, forKey: RebirthAppGroup.snapshotKey)
        } catch {
            log.error("Failed to persist inbound envelope: \(error)")
        }
    }

    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in
            isActivating = false
            if let error {
                log.error("WC activation failed: \(error.localizedDescription)")
            } else {
                log.info("WC activated, state=\(activationState.rawValue)")
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in
            log.info("WC inbound applicationContext keys=\(applicationContext.keys.sorted())")
            persistEnvelope(applicationContext)
            loadFromAppGroup()
            lastReceivedAt = Date()
        }
    }
}
