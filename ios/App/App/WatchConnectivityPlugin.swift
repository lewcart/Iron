import Foundation
import Capacitor
import WatchConnectivity
import RebirthAppGroup
import RebirthModels
import RebirthWatchLog

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
        // Bridge inbound watch messages → Capacitor event so JS can react.
        // The watch fires transferUserInfo with kind="watchWroteSet" when the
        // user confirms a set on the watch; phone applies it via Dexie and
        // pushes the next snapshot back so the watch reflects the new state.
        NotificationCenter.default.addObserver(
            forName: .watchInboundMessage,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let info = notification.userInfo else { return }
            self?.notifyListeners("watchInbound", data: [
                "kind": info["kind"] ?? "",
                "payload": info["payload"] ?? [:],
            ])
        }
    }

    @objc func pushActiveWorkout(_ call: CAPPluginCall) {
        guard let snapshot = call.getObject("snapshot") else {
            call.reject("missing snapshot")
            return
        }

        // Wrap as { schema_version, body } so the watch's RebirthAppGroup
        // .readSnapshot() can decode the same envelope. The watch writes this
        // to ITS App Group container on receipt — App Groups are per-device,
        // not shared phone↔watch, so iPhone-side persistence here would not
        // reach the watch.
        //
        // CRITICAL: WCSession.updateApplicationContext only accepts property-
        // list types (String/Number/Date/Data/Array/Dictionary/Bool). NSNull
        // (from JS `null` values) is NOT allowed and throws
        // "payload contains unsupported type". Capacitor's getObject preserves
        // JS nulls as NSNull, so we recursively strip NSNull keys before
        // passing to WC. Watch-side decoders use decodeIfPresent for all
        // optionals, so missing keys decode as nil correctly.
        let envelope: [String: Any] = [
            "schema_version": SchemaVersion.current,
            "body": snapshot,
        ]
        let cleaned = (Self.stripNulls(envelope) as? [String: Any]) ?? [:]

        coordinator.pushApplicationContext(cleaned) { result in
            switch result {
            case .success:
                call.resolve(["delivered": true])
            case .failure(let err):
                call.reject("WC application context push failed: \(err.localizedDescription)")
            }
        }
    }

    /// Recursively remove NSNull values from a nested dict/array so the result
    /// is property-list-safe for WCSession.updateApplicationContext.
    private static func stripNulls(_ value: Any) -> Any? {
        if value is NSNull { return nil }
        if let dict = value as? [String: Any] {
            var result: [String: Any] = [:]
            for (k, v) in dict {
                if let cleaned = stripNulls(v) { result[k] = cleaned }
            }
            return result
        }
        if let arr = value as? [Any] {
            return arr.compactMap { stripNulls($0) }
        }
        return value
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

    // Inbound: watch messages (e.g., set completion from watch). Forward via
    // Capacitor event. Pass the FULL inbound dict as the payload — the watch
    // doesn't wrap fields under a "payload" key (it puts kind + row at the
    // top level), so we must forward verbatim minus the kind we already
    // extracted.
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        guard let kind = userInfo["kind"] as? String else { return }
        var payload = userInfo
        payload.removeValue(forKey: "kind")
        NotificationCenter.default.post(
            name: .watchInboundMessage,
            object: nil,
            userInfo: ["kind": kind, "payload": payload]
        )
    }
}

extension Notification.Name {
    public static let watchInboundMessage = Notification.Name("app.rebirth.watch.inbound")
}
