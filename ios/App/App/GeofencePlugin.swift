import Foundation
import Capacitor
import CoreLocation
import UserNotifications
import WatchConnectivity

// MARK: - GeofencePlugin

/// Capacitor plugin that monitors a CLCircularRegion for "home" and auto-ends the
/// active workout when the user arrives home and dwells for ≥30 s.
///
/// JS API:
///   GeofencePlugin.setHomeLocation({ lat, lon, radius? })
///   GeofencePlugin.removeHomeLocation()
///   GeofencePlugin.getStatus() → { monitoring: bool, lat?, lon?, radius? }
///   addListener('homeArrival', handler)   // fired after dwell threshold met
///
/// On home arrival the plugin also:
///   1. Sends a WatchConnectivity message { action: "endWorkout" } to the paired Watch
///   2. Posts a local notification: "Flow complete"

@objc(GeofencePlugin)
public class GeofencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GeofencePlugin"
    public let jsName = "Geofence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setHomeLocation",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeHomeLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus",        returnType: CAPPluginReturnPromise),
    ]

    // ── Constants ────────────────────────────────────────────────────────────
    private static let regionIdentifier = "com.rebirth.geofence.home"
    private static let defaultRadius: CLLocationDistance = 175  // metres
    private static let dwellThreshold: TimeInterval = 30        // seconds
    private static let homeArrivalNotificationId = "rebirth-home-arrival"
    private static let prefsKey = "GeofenceHomeLocation"        // UserDefaults

    // ── State ────────────────────────────────────────────────────────────────
    private lazy var locationManager: CLLocationManager = {
        let lm = CLLocationManager()
        lm.delegate = self
        lm.desiredAccuracy = kCLLocationAccuracyHundredMeters
        lm.allowsBackgroundLocationUpdates = true
        lm.pausesLocationUpdatesAutomatically = false
        return lm
    }()

    private var dwellTimer: Timer?
    private var isInsideRegion = false

    // ── Persist home coords so we can re-register after app relaunch ─────────
    private struct HomeLocation: Codable {
        let lat: Double
        let lon: Double
        let radius: Double
    }

    // MARK: - Public JS methods

    @objc func setHomeLocation(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else {
            call.reject("lat and lon are required")
            return
        }
        let radius = call.getDouble("radius") ?? GeofencePlugin.defaultRadius

        requestAlwaysAuthorization { [weak self] granted in
            guard let self else { return }
            if !granted {
                call.reject("Always location permission is required for geofence monitoring")
                return
            }
            let home = HomeLocation(lat: lat, lon: lon, radius: radius)
            self.persistHomeLocation(home)
            self.startMonitoring(home)
            call.resolve(["monitoring": true, "lat": lat, "lon": lon, "radius": radius])
        }
    }

    @objc func removeHomeLocation(_ call: CAPPluginCall) {
        stopMonitoring()
        clearPersistedHomeLocation()
        call.resolve(["monitoring": false])
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        if let home = loadPersistedHomeLocation() {
            call.resolve([
                "monitoring": true,
                "lat": home.lat,
                "lon": home.lon,
                "radius": home.radius
            ])
        } else {
            call.resolve(["monitoring": false])
        }
    }

    // MARK: - Setup on plugin load

    public override func load() {
        // Re-register any persisted region after app relaunch (including background relaunch).
        if let home = loadPersistedHomeLocation() {
            startMonitoring(home)
        }
        setupWatchConnectivity()
    }

    // MARK: - Region monitoring helpers

    private func startMonitoring(_ home: HomeLocation) {
        stopMonitoring()
        let center = CLLocationCoordinate2D(latitude: home.lat, longitude: home.lon)
        let region = CLCircularRegion(
            center: center,
            radius: home.radius,
            identifier: GeofencePlugin.regionIdentifier
        )
        region.notifyOnEntry = true
        region.notifyOnExit  = true
        locationManager.startMonitoring(for: region)
    }

    private func stopMonitoring() {
        cancelDwellTimer()
        for region in locationManager.monitoredRegions
            where region.identifier == GeofencePlugin.regionIdentifier {
            locationManager.stopMonitoring(for: region)
        }
        isInsideRegion = false
    }

    // MARK: - Dwell timer

    private func startDwellTimer() {
        cancelDwellTimer()
        // Timer must fire on the main run loop so it works even in background.
        dwellTimer = Timer.scheduledTimer(
            withTimeInterval: GeofencePlugin.dwellThreshold,
            repeats: false
        ) { [weak self] _ in
            self?.handleDwellConfirmed()
        }
        RunLoop.main.add(dwellTimer!, forMode: .common)
    }

    private func cancelDwellTimer() {
        dwellTimer?.invalidate()
        dwellTimer = nil
    }

    private func handleDwellConfirmed() {
        postHomeArrivalNotification()
        sendWatchEndWorkout()
        notifyListeners("homeArrival", data: [
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ])
    }

    // MARK: - Local notification

    private func postHomeArrivalNotification() {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = "Flow complete"
            content.body  = "Great work — you made it home."
            content.sound = .default
            let request = UNNotificationRequest(
                identifier: GeofencePlugin.homeArrivalNotificationId,
                content: content,
                trigger: nil  // deliver immediately
            )
            center.add(request)
        }
    }

    // MARK: - WatchConnectivity

    private func setupWatchConnectivity() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = WatchSessionDelegate.shared
        if WCSession.default.activationState != .activated {
            WCSession.default.activate()
        }
    }

    private func sendWatchEndWorkout() {
        guard WCSession.isSupported(),
              WCSession.default.activationState == .activated else { return }
        let message: [String: Any] = ["action": "endWorkout",
                                      "source": "geofence",
                                      "timestamp": Date().timeIntervalSince1970]
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(message, replyHandler: nil, errorHandler: { err in
                print("[GeofencePlugin] Watch message failed (reachable path): \(err)")
            })
        } else {
            // Watch not currently reachable — use application context so it
            // picks up the command next time it wakes.
            do {
                try WCSession.default.updateApplicationContext(message)
            } catch {
                print("[GeofencePlugin] Watch application context update failed: \(error)")
            }
        }
    }

    // MARK: - Permission helpers

    private func requestAlwaysAuthorization(completion: @escaping (Bool) -> Void) {
        let status = locationManager.authorizationStatus
        switch status {
        case .authorizedAlways:
            completion(true)
        case .notDetermined:
            // Store the completion and trigger the request; result handled in delegate.
            pendingAuthCompletion = completion
            locationManager.requestAlwaysAuthorization()
        default:
            // .authorizedWhenInUse or .denied — prompt to upgrade / denied
            completion(false)
        }
    }

    private var pendingAuthCompletion: ((Bool) -> Void)?

    // MARK: - Persistence (UserDefaults)

    private func persistHomeLocation(_ home: HomeLocation) {
        if let data = try? JSONEncoder().encode(home) {
            UserDefaults.standard.set(data, forKey: GeofencePlugin.prefsKey)
        }
    }

    private func loadPersistedHomeLocation() -> HomeLocation? {
        guard let data = UserDefaults.standard.data(forKey: GeofencePlugin.prefsKey),
              let home = try? JSONDecoder().decode(HomeLocation.self, from: data) else {
            return nil
        }
        return home
    }

    private func clearPersistedHomeLocation() {
        UserDefaults.standard.removeObject(forKey: GeofencePlugin.prefsKey)
    }
}

// MARK: - CLLocationManagerDelegate

extension GeofencePlugin: CLLocationManagerDelegate {

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let granted = manager.authorizationStatus == .authorizedAlways
        pendingAuthCompletion?(granted)
        pendingAuthCompletion = nil

        // If permission was upgraded to Always while monitoring WhenInUse, re-register.
        if granted, let home = loadPersistedHomeLocation() {
            startMonitoring(home)
        }
    }

    public func locationManager(_ manager: CLLocationManager,
                                 didEnterRegion region: CLRegion) {
        guard region.identifier == GeofencePlugin.regionIdentifier,
              !isInsideRegion else { return }
        isInsideRegion = true
        startDwellTimer()
    }

    public func locationManager(_ manager: CLLocationManager,
                                 didExitRegion region: CLRegion) {
        guard region.identifier == GeofencePlugin.regionIdentifier else { return }
        isInsideRegion = false
        cancelDwellTimer()
    }

    public func locationManager(_ manager: CLLocationManager,
                                 monitoringDidFailFor region: CLRegion?,
                                 withError error: Error) {
        print("[GeofencePlugin] Region monitoring failed: \(error)")
    }

    public func locationManager(_ manager: CLLocationManager,
                                 didDetermineState state: CLRegionState,
                                 for region: CLRegion) {
        guard region.identifier == GeofencePlugin.regionIdentifier else { return }
        // Called on app relaunch — if already inside region, start dwell immediately.
        if state == .inside && !isInsideRegion {
            isInsideRegion = true
            startDwellTimer()
        }
    }
}

// MARK: - WatchSessionDelegate (minimal singleton)

/// Lightweight WCSessionDelegate that handles activation only.
/// The actual workout-end logic lives on the Watch side.
private class WatchSessionDelegate: NSObject, WCSessionDelegate {
    static let shared = WatchSessionDelegate()

    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        if let error { print("[WatchSession] Activation error: \(error)") }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()  // re-activate on Apple Watch switch
    }
}
