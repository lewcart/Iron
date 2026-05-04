import Foundation
import Capacitor
import WatchConnectivity

/// Capacitor plugin that bridges JS → WatchConnectivity. Phone-side mirror of
/// the watch app. Two write modes:
///
///   - `pushActiveWorkout(snapshot)` → WCSession.updateApplicationContext
///     (overwrite-only, latest-wins, reaches both reachable and unreachable
///     watches as soon as they wake)
///   - `pushSetMutation(mutation)` → WCSession.transferUserInfo (FIFO queue)
///
/// JS API (see `src/lib/watch.ts`):
///   WatchConnectivity.pushActiveWorkout({ snapshot })
///   WatchConnectivity.pushSetMutation({ mutation })
///   WatchConnectivity.getWatchPaired() → { isPaired, isReachable, isWatchAppInstalled }
///
/// Activation is async. Calls before activation completes are buffered (last
/// snapshot wins) and flushed on `session(_:activationDidCompleteWith:error:)`.
/// Without this gate, pre-activation `updateApplicationContext` calls fail
/// silently — no exception, no callback.
@objc(WatchConnectivityPlugin)
public class WatchConnectivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchConnectivityPlugin"
    public let jsName = "WatchConnectivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pushActiveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushSetMutation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWatchPaired", returnType: CAPPluginReturnPromise),
    ]

    private let coordinator = WCSessionCoordinator()

    public override func load() {
        coordinator.activate()
    }

    @objc func pushActiveWorkout(_ call: CAPPluginCall) {
        guard let snapshot = call.getObject("snapshot") else {
            call.reject("missing snapshot")
            return
        }
        coordinator.pushApplicationContext(snapshot) { result in
            switch result {
            case .success:
                call.resolve(["delivered": true])
            case .failure(let err):
                call.reject("WC application context push failed: \(err.localizedDescription)")
            }
        }
    }

    @objc func pushSetMutation(_ call: CAPPluginCall) {
        guard let mutation = call.getObject("mutation") else {
            call.reject("missing mutation")
            return
        }
        coordinator.transferUserInfo(["kind": "setMutation", "payload": mutation]) { result in
            switch result {
            case .success:
                call.resolve(["queued": true])
            case .failure(let err):
                call.reject("WC transferUserInfo failed: \(err.localizedDescription)")
            }
        }
    }

    @objc func getWatchPaired(_ call: CAPPluginCall) {
        let info = coordinator.pairingInfo()
        call.resolve([
            "isPaired": info.isPaired,
            "isReachable": info.isReachable,
            "isWatchAppInstalled": info.isWatchAppInstalled,
        ])
    }
}

// MARK: - Coordinator

private final class WCSessionCoordinator: NSObject, WCSessionDelegate {
    private var pendingSnapshot: [String: Any]?
    private var pendingTransfers: [(payload: [String: Any], completion: (Result<Void, Error>) -> Void)] = []
    private var activated = false
    private let lock = NSLock()

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func pairingInfo() -> (isPaired: Bool, isReachable: Bool, isWatchAppInstalled: Bool) {
        guard WCSession.isSupported() else { return (false, false, false) }
        let session = WCSession.default
        return (session.isPaired, session.isReachable, session.isWatchAppInstalled)
    }

    func pushApplicationContext(_ context: [String: Any], completion: @escaping (Result<Void, Error>) -> Void) {
        lock.lock()
        if !activated {
            pendingSnapshot = context
            lock.unlock()
            completion(.success(()))   // optimistic — flushed on activation
            return
        }
        lock.unlock()
        do {
            try WCSession.default.updateApplicationContext(context)
            completion(.success(()))
        } catch {
            completion(.failure(error))
        }
    }

    func transferUserInfo(_ payload: [String: Any], completion: @escaping (Result<Void, Error>) -> Void) {
        lock.lock()
        if !activated {
            pendingTransfers.append((payload, completion))
            lock.unlock()
            return
        }
        lock.unlock()
        WCSession.default.transferUserInfo(payload)
        completion(.success(()))
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        lock.lock()
        activated = (activationState == .activated)
        let snapshot = pendingSnapshot
        let transfers = pendingTransfers
        pendingSnapshot = nil
        pendingTransfers.removeAll()
        lock.unlock()

        if activated {
            if let snapshot {
                try? WCSession.default.updateApplicationContext(snapshot)
            }
            for transfer in transfers {
                WCSession.default.transferUserInfo(transfer.payload)
                transfer.completion(.success(()))
            }
        } else {
            for transfer in transfers {
                transfer.completion(.failure(error ?? NSError(domain: "WatchConnectivityPlugin", code: -1)))
            }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        // Re-activate to support multi-watch pairing changes.
        WCSession.default.activate()
    }

    // Inbound: watch acks (e.g., set synced from watch). Forward via Capacitor event.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if let kind = userInfo["kind"] as? String {
            NotificationCenter.default.post(
                name: .watchInboundMessage,
                object: nil,
                userInfo: ["kind": kind, "payload": userInfo["payload"] ?? [:]]
            )
        }
    }
}

extension Notification.Name {
    public static let watchInboundMessage = Notification.Name("app.rebirth.watch.inbound")
}
