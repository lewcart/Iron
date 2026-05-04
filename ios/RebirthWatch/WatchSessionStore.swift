import Foundation
import WatchConnectivity
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

/// Watch-side WCSessionDelegate. Reads the latest snapshot from App Group
/// UserDefaults on launch, and updates state when the phone pushes a new one.
@MainActor
final class WatchSessionStore: NSObject, ObservableObject, WCSessionDelegate {
    @Published var snapshot: ActiveWorkoutSnapshot?
    @Published var isActivating: Bool = true

    private let appGroup = RebirthAppGroup()
    private let log = RebirthWatchLog.shared

    func activate() {
        // Try to read existing snapshot eagerly so cold-start UI is instant.
        loadFromAppGroup()
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
            // Phone pushes the snapshot encoded inside this dict; we wrote it
            // to the App Group on the iOS side, so just re-read from disk.
            loadFromAppGroup()
        }
    }
}
