import Foundation
import CoreLocation
import HealthKit
import UserNotifications

// MARK: - WalkGeofenceMonitor

/// App-launch-level owner of the morning-walk geofence monitoring.
///
/// Why this exists separately from `GeofencePlugin`:
/// iOS region monitoring relaunches a *terminated* app in the background to
/// deliver a boundary crossing. On that lightweight relaunch Capacitor does not
/// reliably boot the WKWebView bridge, so `GeofencePlugin.load()` (a Capacitor
/// plugin lifecycle hook) never runs — which previously meant the
/// `CLLocationManager` was never recreated, its delegate was never set, and the
/// `didExitRegion` callback was silently dropped. Net effect: the auto morning
/// walk never initiated after the app had been killed overnight, even though
/// everything was configured correctly.
///
/// This singleton is created and `bootstrapAtLaunch()`-ed from
/// `AppDelegate.didFinishLaunchingWithOptions`, so the location manager +
/// delegate are alive to receive the region callback regardless of whether the
/// Capacitor bridge is up. It mirrors `AppLaunchNotificationDelegate`: the
/// durable, bridge-independent half of the feature lives at app-launch scope and
/// operates purely on persisted `WalkTrackerState`; the plugin layer is optional
/// sugar that forwards JS calls here and observes state changes for the JS event
/// bridge.
final class WalkGeofenceMonitor: NSObject {

    static let shared = WalkGeofenceMonitor()

    // ── Event hooks for the (optional) plugin/JS bridge ──────────────────────
    // Nil on a background relaunch where the Capacitor bridge never booted. All
    // durable work goes through persisted state + iOS notifications, which do
    // not require the bridge; these closures only feed the live foreground UI.
    var onWalkStateChanged: (() -> Void)?
    var onHomeArrival: (() -> Void)?

    // ── Region identifiers ───────────────────────────────────────────────────
    static let homeRegionId = "com.rebirth.geofence.home"
    static let gymRegionId  = "com.rebirth.geofence.gym"

    static let defaultHomeRadius: CLLocationDistance = 175
    static let defaultGymRadius:  CLLocationDistance = 100
    private static let dwellThreshold: TimeInterval = 30

    // ── UserDefaults keys ────────────────────────────────────────────────────
    static let prefsHomeKey = "GeofenceHomeLocation"
    static let prefsGymKey  = "GeofenceGymLocation"
    static let prefsWindowsKey = "GeofenceDepartWindows"
    static let prefsAutoWalkKey = "GeofenceAutoWalkEnabled"

    // ── Notification IDs ─────────────────────────────────────────────────────
    private static let walkStartedNotifPrefix     = "rebirth-walk-started"
    private static let walkCompletedNotifPrefix   = "rebirth-walk-completed"
    private static let walkPartialNotifPrefix     = "rebirth-walk-partial"
    private static let walkSaveFailedNotifPrefix  = "rebirth-walk-save-failed"
    private static let permissionRevokedNotifId   = "rebirth-perm-revoked"

    // ── Notification action category ─────────────────────────────────────────
    static let walkActiveCategoryId = "REBIRTH_WALK_ACTIVE"
    static let cancelActionId = "REBIRTH_WALK_CANCEL"

    // ── State ────────────────────────────────────────────────────────────────
    private lazy var locationManager: CLLocationManager = {
        let lm = CLLocationManager()
        lm.delegate = self
        lm.desiredAccuracy = kCLLocationAccuracyHundredMeters
        lm.distanceFilter = 50
        lm.allowsBackgroundLocationUpdates = true
        lm.pausesLocationUpdatesAutomatically = false
        return lm
    }()

    private let walkTracker = WalkTracker()

    private var homeRegionEnteredAt: Date?
    private var isInsideHomeRegion = false
    private var pendingAuthCompletion: ((Bool) -> Void)?
    private var didBootstrap = false

    // MARK: - Codable models

    struct StoredRegion: Codable {
        let lat: Double
        let lon: Double
        let radius: Double
    }

    struct DepartWindow: Codable {
        let startHour: Int
        let startMinute: Int
        let endHour: Int
        let endMinute: Int
    }

    struct DepartWindows: Codable {
        let weekday: DepartWindow
        let weekend: DepartWindow

        static let defaults = DepartWindows(
            weekday: DepartWindow(startHour: 4, startMinute: 30, endHour: 6,  endMinute: 0),
            weekend: DepartWindow(startHour: 5, startMinute: 0,  endHour: 8,  endMinute: 0)
        )
    }

    private enum WalkLeg { case outbound, inbound }

    // MARK: - Launch bootstrap

    /// Idempotent. Called from AppDelegate at launch (so the delegate is live for
    /// background region relaunches) and again from `GeofencePlugin.load()` (a
    /// no-op the second time). This is the fix for the dropped-event bug.
    func bootstrapAtLaunch() {
        if didBootstrap { return }
        didBootstrap = true

        registerNotificationCategories()
        // The UNUserNotificationCenter.delegate is set by AppDelegate
        // (AppLaunchNotificationDelegate) so cold-launch notification actions work
        // without depending on plugin lifecycle.

        // Touch the lazy manager so its delegate is set before any region
        // callback can arrive in the background-relaunch window.
        _ = locationManager

        if let home = loadPersisted(StoredRegion.self, key: Self.prefsHomeKey) {
            startMonitoringHome(home)
        }
        if let gym = loadPersisted(StoredRegion.self, key: Self.prefsGymKey) {
            startMonitoringGym(gym)
        }

        recoverActiveWalkIfNeeded()
    }

    // MARK: - JS-facing operations (called by GeofencePlugin)

    func setHome(lat: Double, lon: Double, radius: Double,
                 completion: @escaping (_ resolve: [String: Any]?, _ reject: String?) -> Void) {
        requestAlwaysAuthorization { [weak self] granted in
            guard let self else { return }
            if !granted {
                completion(nil, "Always location permission is required for geofence monitoring")
                return
            }
            let home = StoredRegion(lat: lat, lon: lon, radius: radius)
            self.persist(home, key: Self.prefsHomeKey)
            self.startMonitoringHome(home)
            completion(["monitoring": true, "lat": lat, "lon": lon, "radius": radius], nil)
        }
    }

    func removeHome() {
        stopMonitoringRegion(id: Self.homeRegionId)
        clearPersisted(key: Self.prefsHomeKey)
    }

    func setGym(lat: Double, lon: Double, radius: Double,
                completion: @escaping (_ resolve: [String: Any]?, _ reject: String?) -> Void) {
        requestAlwaysAuthorization { [weak self] granted in
            guard let self else { return }
            if !granted {
                completion(nil, "Always location permission is required for gym geofence monitoring")
                return
            }
            let gym = StoredRegion(lat: lat, lon: lon, radius: radius)
            self.persist(gym, key: Self.prefsGymKey)
            self.startMonitoringGym(gym)
            completion(["monitoring": true, "lat": lat, "lon": lon, "radius": radius], nil)
        }
    }

    func removeGym() {
        stopMonitoringRegion(id: Self.gymRegionId)
        clearPersisted(key: Self.prefsGymKey)
    }

    /// Parse + persist depart windows. Returns false if the HH:mm strings are invalid.
    func setDepartWindows(weekdayStart: String, weekdayEnd: String,
                          weekendStart: String, weekendEnd: String) -> Bool {
        guard
            let weekdayWindow = parseWindow(start: weekdayStart, end: weekdayEnd),
            let weekendWindow = parseWindow(start: weekendStart, end: weekendEnd)
        else { return false }
        let windows = DepartWindows(weekday: weekdayWindow, weekend: weekendWindow)
        persist(windows, key: Self.prefsWindowsKey)
        return true
    }

    func setAutoWalkEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: Self.prefsAutoWalkKey)
    }

    func requestHKWriteAuth(completion: @escaping (Error?) -> Void) {
        walkTracker.requestHKWriteAuthorization { _, err in completion(err) }
    }

    /// Starts walk-2 immediately. Called from the JS finish-workout hook.
    func startWalkNow() -> [String: Any] {
        guard isAutoWalkEnabled() else {
            return ["started": false, "reason": "auto-walk disabled"]
        }
        let s = walkTracker.loadState()
        guard s.phase == .atGymWalkSaved || s.phase == .strengthActive else {
            return ["started": false, "reason": "phase not eligible: \(s.phase.rawValue)"]
        }
        if let started = s.startedAt, Date().timeIntervalSince(started) > 12 * 60 * 60 {
            return ["started": false, "reason": "stale flow (>12h old)"]
        }
        guard
            loadPersisted(StoredRegion.self, key: Self.prefsHomeKey) != nil,
            loadPersisted(StoredRegion.self, key: Self.prefsGymKey) != nil
        else {
            return ["started": false, "reason": "home or gym not configured"]
        }
        let _ = walkTracker.start(reason: .postWorkout)
        beginActiveWalkLocationUpdates()
        postWalkStartedNotification(leg: "Post-workout walk started")
        notifyWalkStateChanged()
        return ["started": true]
    }

    func cancelActiveWalk() {
        endActiveWalkLocationUpdates()
        walkTracker.cancel()
        notifyWalkStateChanged()
    }

    /// User-initiated finish for an active walk that didn't reach its terminal
    /// geofence. Leg-aware (see original GeofencePlugin doc).
    func finishActiveWalkNow(completion: @escaping (_ resolve: [String: Any]) -> Void) {
        let s = walkTracker.loadState()
        guard s.phase == .walkOutboundActive || s.phase == .walkInboundActive else {
            completion(["finished": false, "reason": "no active walk: phase=\(s.phase.rawValue)"])
            return
        }
        let leg: WalkLeg = (s.phase == .walkOutboundActive) ? .outbound : .inbound
        let optimisticDest: WalkPhase = (leg == .outbound) ? .atGymWalkSaved : .completed
        walkTracker.transition(to: optimisticDest)
        endActiveWalkLocationUpdates()
        walkTracker.finish(at: Date()) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                if leg == .inbound { self.postWalkCompletedNotification() }
                self.notifyWalkStateChanged()
                completion(["finished": true, "leg": leg == .outbound ? "outbound" : "inbound"])
            case .failure(let err):
                if case .noSamples = err {
                    self.walkTracker.cancel()
                    self.notifyWalkStateChanged()
                    completion(["finished": false, "reason": "no samples — cancelled instead"])
                    return
                }
                self.walkTracker.transition(to: .failedSaveAwaitingRetry)
                self.postWalkSaveFailedNotification(error: err)
                self.notifyWalkStateChanged()
                completion(["finished": false, "reason": "save failed"])
            }
        }
    }

    func activeWalkStateDict() -> [String: Any] {
        let snap = walkTracker.snapshot()
        return [
            "phase": snap.phase,
            "flowId": snap.flowId as Any,
            "startedAt": snap.startedAt as Any,
            "distanceMeters": snap.distanceMeters,
            "durationSeconds": snap.durationSeconds,
            "lastSampleAt": snap.lastSampleAt as Any,
            "hkWriteLikelyDenied": UserDefaults.standard.bool(forKey: WalkTracker.hkWriteLikelyDeniedKey)
        ]
    }

    func statusDict() -> [String: Any] {
        let home = loadPersisted(StoredRegion.self, key: Self.prefsHomeKey)
        let gym  = loadPersisted(StoredRegion.self, key: Self.prefsGymKey)
        var resp: [String: Any] = [
            "monitoring": home != nil,
            "homeMonitored": home != nil,
            "gymMonitored": gym != nil,
            "autoWalkEnabled": isAutoWalkEnabled(),
        ]
        if let h = home {
            resp["lat"] = h.lat; resp["lon"] = h.lon; resp["radius"] = h.radius
        }
        if let g = gym {
            resp["gymLat"] = g.lat; resp["gymLon"] = g.lon; resp["gymRadius"] = g.radius
        }
        return resp
    }

    func walkStateChangedDict() -> [String: Any] {
        let snap = walkTracker.snapshot()
        return [
            "phase": snap.phase,
            "flowId": snap.flowId as Any,
            "startedAt": snap.startedAt as Any,
            "distanceMeters": snap.distanceMeters,
            "durationSeconds": snap.durationSeconds,
            "lastSampleAt": snap.lastSampleAt as Any
        ]
    }

    /// Cancel via persisted state only (notification-action path, possibly cold launch).
    func cancelFromPersistedState() {
        endActiveWalkLocationUpdates()
        walkTracker.cancelFromPersistedState()
        notifyWalkStateChanged()
    }

    // MARK: - Region monitoring

    private func startMonitoringHome(_ home: StoredRegion) {
        stopMonitoringRegion(id: Self.homeRegionId)
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: home.lat, longitude: home.lon),
            radius: home.radius,
            identifier: Self.homeRegionId
        )
        region.notifyOnEntry = true
        region.notifyOnExit  = true
        locationManager.startMonitoring(for: region)
    }

    private func startMonitoringGym(_ gym: StoredRegion) {
        stopMonitoringRegion(id: Self.gymRegionId)
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: gym.lat, longitude: gym.lon),
            radius: gym.radius,
            identifier: Self.gymRegionId
        )
        region.notifyOnEntry = true
        region.notifyOnExit  = true
        locationManager.startMonitoring(for: region)
    }

    private func stopMonitoringRegion(id: String) {
        for region in locationManager.monitoredRegions where region.identifier == id {
            locationManager.stopMonitoring(for: region)
        }
        if id == Self.homeRegionId {
            isInsideHomeRegion = false
            homeRegionEnteredAt = nil
        }
    }

    // MARK: - Active-walk location updates

    private func beginActiveWalkLocationUpdates() {
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter  = 5
        locationManager.startUpdatingLocation()
    }

    private func endActiveWalkLocationUpdates() {
        locationManager.stopUpdatingLocation()
        locationManager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        locationManager.distanceFilter  = 50
    }

    // MARK: - Recovery

    private func recoverActiveWalkIfNeeded() {
        let state = walkTracker.loadState()
        guard state.phase == .walkOutboundActive || state.phase == .walkInboundActive else { return }
        let restored = walkTracker.restoreActiveWalkIfPersisted()
        guard restored else {
            walkTracker.transition(to: .idle)
            return
        }
        let now = Date()
        let fourHours: TimeInterval = 4 * 60 * 60
        if let started = state.startedAt, now.timeIntervalSince(started) >= fourHours {
            walkTracker.finish(at: now) { [weak self] result in
                self?.handleWalkFinishResult(result, leg: state.phase == .walkOutboundActive ? .outbound : .inbound, partial: true)
            }
        } else {
            beginActiveWalkLocationUpdates()
        }
    }

    // MARK: - Time-window gate

    func isWithinDepartWindow(_ now: Date = Date()) -> Bool {
        let windows = loadPersisted(DepartWindows.self, key: Self.prefsWindowsKey) ?? DepartWindows.defaults
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Australia/Brisbane") ?? .current
        let weekday = cal.component(.weekday, from: now)  // 1=Sun, 7=Sat
        let isWeekend = (weekday == 1 || weekday == 7)
        let window = isWeekend ? windows.weekend : windows.weekday
        let hour = cal.component(.hour, from: now)
        let minute = cal.component(.minute, from: now)
        let nowMinutes = hour * 60 + minute
        let startMinutes = window.startHour * 60 + window.startMinute
        let endMinutes   = window.endHour   * 60 + window.endMinute
        return nowMinutes >= startMinutes && nowMinutes < endMinutes
    }

    /// Pure decision: should a home-exit at `now` start a new outbound walk?
    /// Extracted so the gate is unit-testable without touching CLLocationManager
    /// or HealthKit. This is the exact set of conditions that silently produced
    /// "looks normal, never fires" when any one of them was off.
    func shouldInitiateOutboundWalk(at now: Date = Date()) -> Bool {
        guard isAutoWalkEnabled() else { return false }
        guard isWithinDepartWindow(now) else { return false }
        switch walkTracker.loadState().phase {
        case .idle, .completed, .partialMissedInbound, .permissionRevoked, .failedSaveAwaitingRetry:
            return true
        case .walkOutboundActive, .atGymWalkSaved, .strengthActive, .walkInboundActive:
            return false
        }
    }

    // MARK: - Handlers triggered by region transitions

    private func handleHomeExit(at: Date = Date()) {
        guard shouldInitiateOutboundWalk(at: at) else { return }
        let _ = walkTracker.start(reason: .departHome)
        beginActiveWalkLocationUpdates()
        postWalkStartedNotification(leg: "Morning walk started")
        notifyWalkStateChanged()
    }

    private func handleGymEntry(at: Date = Date()) {
        let s = walkTracker.loadState()
        guard s.phase == .walkOutboundActive else { return }
        walkTracker.transition(to: .atGymWalkSaved)
        endActiveWalkLocationUpdates()
        walkTracker.finish(at: at) { [weak self] result in
            self?.handleWalkFinishResult(result, leg: .outbound, partial: false)
        }
    }

    private func handleHomeEntry(at: Date = Date()) {
        let s = walkTracker.loadState()
        if s.phase == .walkInboundActive {
            walkTracker.transition(to: .completed)
            endActiveWalkLocationUpdates()
            walkTracker.finish(at: at) { [weak self] result in
                self?.handleWalkFinishResult(result, leg: .inbound, partial: false)
            }
        }
        homeRegionEnteredAt = at
        notifyHomeArrivalIfDwellPassed()
    }

    private func notifyHomeArrivalIfDwellPassed() {
        guard let entered = homeRegionEnteredAt else { return }
        let elapsed = Date().timeIntervalSince(entered)
        if elapsed >= Self.dwellThreshold {
            onHomeArrival?()
            homeRegionEnteredAt = nil
        } else {
            scheduleDwellRecheck(after: Self.dwellThreshold - elapsed)
        }
    }

    private func scheduleDwellRecheck(after seconds: TimeInterval) {
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.notifyHomeArrivalIfDwellPassed()
        }
    }

    private func handleWalkFinishResult(_ result: Result<HKWorkout, WalkSaveError>, leg: WalkLeg, partial: Bool) {
        switch result {
        case .success:
            if leg == .outbound {
                walkTracker.transition(to: .atGymWalkSaved)
            } else {
                if partial {
                    walkTracker.transition(to: .partialMissedInbound)
                    postWalkPartialNotification()
                } else {
                    walkTracker.transition(to: .completed)
                    postWalkCompletedNotification()
                }
            }
        case .failure(let err):
            walkTracker.transition(to: .failedSaveAwaitingRetry)
            postWalkSaveFailedNotification(error: err)
        }
        notifyWalkStateChanged()
    }

    private func notifyWalkStateChanged() {
        onWalkStateChanged?()
    }

    // MARK: - Notifications

    private func registerNotificationCategories() {
        let cancel = UNNotificationAction(
            identifier: Self.cancelActionId,
            title: "Cancel",
            options: [.destructive]
        )
        let category = UNNotificationCategory(
            identifier: Self.walkActiveCategoryId,
            actions: [cancel],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    private func postWalkStartedNotification(leg title: String) {
        requestNotifPermissionThen { [weak self] in
            guard let self else { return }
            let flowId = self.walkTracker.loadState().flowId ?? "no-flow"
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = "Tap Cancel if you didn't mean to start a walk."
            content.sound = .default
            content.categoryIdentifier = Self.walkActiveCategoryId
            let id = "\(Self.walkStartedNotifPrefix)-\(flowId)-\(UUID().uuidString.prefix(6))"
            let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
            UNUserNotificationCenter.current().add(req)
        }
    }

    private func postWalkCompletedNotification() {
        requestNotifPermissionThen { [weak self] in
            guard let self else { return }
            let flowId = self.walkTracker.loadState().flowId ?? "no-flow"
            let content = UNMutableNotificationContent()
            content.title = "Morning walks saved"
            content.body = "Both legs logged to Health."
            content.sound = .default
            let id = "\(Self.walkCompletedNotifPrefix)-\(flowId)"
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }

    private func postWalkPartialNotification() {
        requestNotifPermissionThen { [weak self] in
            guard let self else { return }
            let flowId = self.walkTracker.loadState().flowId ?? "no-flow"
            let content = UNMutableNotificationContent()
            content.title = "Morning flow incomplete"
            content.body = "The return walk wasn't fully captured. Open Rebirth to review."
            content.sound = .default
            let id = "\(Self.walkPartialNotifPrefix)-\(flowId)"
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }

    private func postWalkSaveFailedNotification(error: WalkSaveError) {
        requestNotifPermissionThen { [weak self] in
            guard let self else { return }
            let flowId = self.walkTracker.loadState().flowId ?? "no-flow"
            let content = UNMutableNotificationContent()
            content.title = "Could not save walk"
            content.body = "Tap to open Rebirth and retry."
            content.sound = .default
            let id = "\(Self.walkSaveFailedNotifPrefix)-\(flowId)"
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }

    private func postPermissionRevokedNotification() {
        requestNotifPermissionThen {
            let content = UNMutableNotificationContent()
            content.title = "Auto-walks paused"
            content.body = "Always-Location was disabled. Re-enable it in Settings to resume morning walks."
            content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: Self.permissionRevokedNotifId, content: content, trigger: nil))
        }
    }

    private func requestNotifPermissionThen(_ work: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            work()
        }
    }

    // MARK: - Permission helpers

    private func requestAlwaysAuthorization(completion: @escaping (Bool) -> Void) {
        let status = locationManager.authorizationStatus
        switch status {
        case .authorizedAlways:
            completion(true)
        case .notDetermined:
            pendingAuthCompletion = completion
            locationManager.requestAlwaysAuthorization()
        case .authorizedWhenInUse:
            pendingAuthCompletion = completion
            locationManager.requestAlwaysAuthorization()
        default:
            completion(false)
        }
    }

    private func isAutoWalkEnabled() -> Bool {
        UserDefaults.standard.bool(forKey: Self.prefsAutoWalkKey)
    }

    // MARK: - Persistence helpers

    private func persist<T: Codable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    private func loadPersisted<T: Codable>(_ type: T.Type, key: String) -> T? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func clearPersisted(key: String) {
        UserDefaults.standard.removeObject(forKey: key)
    }

    private func parseWindow(start: String, end: String) -> DepartWindow? {
        func parseHHmm(_ s: String) -> (Int, Int)? {
            let parts = s.split(separator: ":")
            guard parts.count == 2,
                  let h = Int(parts[0]),
                  let m = Int(parts[1]),
                  (0..<24).contains(h),
                  (0..<60).contains(m)
            else { return nil }
            return (h, m)
        }
        guard let s = parseHHmm(start), let e = parseHHmm(end) else { return nil }
        return DepartWindow(startHour: s.0, startMinute: s.1, endHour: e.0, endMinute: e.1)
    }
}

// MARK: - CLLocationManagerDelegate

extension WalkGeofenceMonitor: CLLocationManagerDelegate {

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        let granted = status == .authorizedAlways
        pendingAuthCompletion?(granted)
        pendingAuthCompletion = nil

        if granted {
            if let home = loadPersisted(StoredRegion.self, key: Self.prefsHomeKey) {
                startMonitoringHome(home)
            }
            if let gym = loadPersisted(StoredRegion.self, key: Self.prefsGymKey) {
                startMonitoringGym(gym)
            }
        } else if status == .denied || status == .authorizedWhenInUse || status == .restricted {
            stopMonitoringRegion(id: Self.homeRegionId)
            stopMonitoringRegion(id: Self.gymRegionId)
            let walkState = walkTracker.loadState()
            if walkState.phase == .walkOutboundActive || walkState.phase == .walkInboundActive {
                endActiveWalkLocationUpdates()
            }
            walkTracker.transition(to: .permissionRevoked)
            notifyWalkStateChanged()
            postPermissionRevokedNotification()
        }
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        switch region.identifier {
        case Self.homeRegionId:
            guard !isInsideHomeRegion else { return }
            isInsideHomeRegion = true
            handleHomeEntry()
        case Self.gymRegionId:
            handleGymEntry()
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        switch region.identifier {
        case Self.homeRegionId:
            isInsideHomeRegion = false
            homeRegionEnteredAt = nil
            handleHomeExit()
        case Self.gymRegionId:
            break  // walk-2 starts via the JS finishWorkout hook, not gym exit
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let s = walkTracker.loadState()
        guard s.phase == .walkOutboundActive || s.phase == .walkInboundActive else {
            notifyHomeArrivalIfDwellPassed()
            return
        }
        for loc in locations {
            walkTracker.ingest(location: loc)
        }
    }

    func locationManager(_ manager: CLLocationManager,
                         monitoringDidFailFor region: CLRegion?,
                         withError error: Error) {
        print("[WalkGeofenceMonitor] Region monitoring failed: \(error)")
    }

    func locationManager(_ manager: CLLocationManager,
                         didDetermineState state: CLRegionState,
                         for region: CLRegion) {
        if region.identifier == Self.homeRegionId, state == .inside, !isInsideHomeRegion {
            isInsideHomeRegion = true
            handleHomeEntry()
        }
    }
}
