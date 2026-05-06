import Foundation
import Capacitor
import CoreLocation
import HealthKit
import UserNotifications

// MARK: - GeofencePlugin

/// Capacitor plugin that monitors CLCircularRegions for "home" and "gym" so the
/// app can auto-log a morning walk to/from the gym and end the active workout
/// on home arrival.
///
/// JS API:
///   GeofencePlugin.setHomeLocation({ lat, lon, radius? })
///   GeofencePlugin.removeHomeLocation()
///   GeofencePlugin.setGymLocation({ lat, lon, radius? })
///   GeofencePlugin.removeGymLocation()
///   GeofencePlugin.setDepartWindows({ weekday: { start, end }, weekend: { start, end } })
///   GeofencePlugin.setAutoWalkEnabled({ enabled })
///   GeofencePlugin.startWalkNow()                // arms walk-2 from JS finish hook
///   GeofencePlugin.cancelActiveWalk()            // user-cancellation
///   GeofencePlugin.finishActiveWalkNow()         // user-initiated finish (didn't reach gym/home)
///   GeofencePlugin.getActiveWalkState()          // pull on app foreground
///   GeofencePlugin.getStatus()                   // home + gym + flags
///   addListener('homeArrival', handler)          // fired after dwell threshold met
///   addListener('walkStateChanged', handler)     // fired on any phase transition

@objc(GeofencePlugin)
public class GeofencePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GeofencePlugin"
    public let jsName = "Geofence"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setHomeLocation",     returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeHomeLocation",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setGymLocation",      returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeGymLocation",   returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setDepartWindows",    returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAutoWalkEnabled",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWalkNow",        returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelActiveWalk",    returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishActiveWalkNow", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getActiveWalkState",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus",           returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestHKWriteAuth",  returnType: CAPPluginReturnPromise),
    ]

    // ── Region identifiers ───────────────────────────────────────────────────
    private static let homeRegionId = "com.rebirth.geofence.home"
    private static let gymRegionId  = "com.rebirth.geofence.gym"

    // Legacy identifier — migrated to homeRegionId on first load.
    private static let legacyHomeRegionId = "com.rebirth.geofence.home"

    private static let defaultHomeRadius: CLLocationDistance = 175
    private static let defaultGymRadius:  CLLocationDistance = 100
    private static let dwellThreshold: TimeInterval = 30

    // ── UserDefaults keys ────────────────────────────────────────────────────
    private static let prefsHomeKey = "GeofenceHomeLocation"
    private static let prefsGymKey  = "GeofenceGymLocation"
    private static let prefsWindowsKey = "GeofenceDepartWindows"
    private static let prefsAutoWalkKey = "GeofenceAutoWalkEnabled"

    // ── Notification IDs (per-flow + per-event so close-firing alerts don't clobber) ─
    private static let walkStartedNotifPrefix     = "rebirth-walk-started"
    private static let walkCompletedNotifPrefix   = "rebirth-walk-completed"
    private static let walkPartialNotifPrefix     = "rebirth-walk-partial"
    private static let walkSaveFailedNotifPrefix  = "rebirth-walk-save-failed"
    private static let permissionRevokedNotifId   = "rebirth-perm-revoked"

    // ── Notification action category ─────────────────────────────────────────
    private static let walkActiveCategoryId = "REBIRTH_WALK_ACTIVE"
    private static let cancelActionId = "REBIRTH_WALK_CANCEL"

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

    private lazy var walkTracker = WalkTracker()

    private var dwellTimer: Timer?
    private var homeRegionEnteredAt: Date?
    private var isInsideHomeRegion = false

    private var pendingAuthCompletion: ((Bool) -> Void)?

    // MARK: - Codable region model

    private struct StoredRegion: Codable {
        let lat: Double
        let lon: Double
        let radius: Double
    }

    private struct DepartWindow: Codable {
        let startHour: Int
        let startMinute: Int
        let endHour: Int
        let endMinute: Int
    }

    private struct DepartWindows: Codable {
        let weekday: DepartWindow
        let weekend: DepartWindow

        static let defaults = DepartWindows(
            weekday: DepartWindow(startHour: 4, startMinute: 30, endHour: 6,  endMinute: 0),
            weekend: DepartWindow(startHour: 5, startMinute: 0,  endHour: 8,  endMinute: 0)
        )
    }

    // MARK: - Public JS methods — home

    @objc func setHomeLocation(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else {
            call.reject("lat and lon are required")
            return
        }
        let radius = call.getDouble("radius") ?? GeofencePlugin.defaultHomeRadius

        requestAlwaysAuthorization { [weak self] granted in
            guard let self else { return }
            if !granted {
                call.reject("Always location permission is required for geofence monitoring")
                return
            }
            let home = StoredRegion(lat: lat, lon: lon, radius: radius)
            self.persist(home, key: GeofencePlugin.prefsHomeKey)
            self.startMonitoringHome(home)
            call.resolve(["monitoring": true, "lat": lat, "lon": lon, "radius": radius])
        }
    }

    @objc func removeHomeLocation(_ call: CAPPluginCall) {
        stopMonitoringRegion(id: GeofencePlugin.homeRegionId)
        clearPersisted(key: GeofencePlugin.prefsHomeKey)
        call.resolve(["monitoring": false])
    }

    // MARK: - Public JS methods — gym

    @objc func setGymLocation(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else {
            call.reject("lat and lon are required")
            return
        }
        let radius = call.getDouble("radius") ?? GeofencePlugin.defaultGymRadius

        requestAlwaysAuthorization { [weak self] granted in
            guard let self else { return }
            if !granted {
                call.reject("Always location permission is required for gym geofence monitoring")
                return
            }
            let gym = StoredRegion(lat: lat, lon: lon, radius: radius)
            self.persist(gym, key: GeofencePlugin.prefsGymKey)
            self.startMonitoringGym(gym)
            call.resolve(["monitoring": true, "lat": lat, "lon": lon, "radius": radius])
        }
    }

    @objc func removeGymLocation(_ call: CAPPluginCall) {
        stopMonitoringRegion(id: GeofencePlugin.gymRegionId)
        clearPersisted(key: GeofencePlugin.prefsGymKey)
        call.resolve(["monitoring": false])
    }

    // MARK: - Public JS methods — windows + master toggle

    @objc func setDepartWindows(_ call: CAPPluginCall) {
        guard
            let weekday = call.getObject("weekday"),
            let weekend = call.getObject("weekend"),
            let wdStart = weekday["start"] as? String,
            let wdEnd   = weekday["end"]   as? String,
            let weStart = weekend["start"] as? String,
            let weEnd   = weekend["end"]   as? String
        else {
            call.reject("weekday/weekend with start/end (HH:mm) required")
            return
        }
        guard
            let weekdayWindow = parseWindow(start: wdStart, end: wdEnd),
            let weekendWindow = parseWindow(start: weStart, end: weEnd)
        else {
            call.reject("Window times must be HH:mm")
            return
        }
        let windows = DepartWindows(weekday: weekdayWindow, weekend: weekendWindow)
        persist(windows, key: GeofencePlugin.prefsWindowsKey)
        call.resolve(["ok": true])
    }

    @objc func setAutoWalkEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        UserDefaults.standard.set(enabled, forKey: GeofencePlugin.prefsAutoWalkKey)
        call.resolve(["enabled": enabled])
    }

    /// Explicitly request HealthKit write permission. Called once when the
    /// user enables auto-walk so the iOS sheet appears at a sensible moment
    /// (not mid-simulate). Subsequent calls are no-ops if iOS remembers the
    /// answer; idempotent.
    @objc func requestHKWriteAuth(_ call: CAPPluginCall) {
        walkTracker.requestHKWriteAuthorization { _, err in
            if let err = err {
                call.reject(err.localizedDescription)
            } else {
                call.resolve(["requested": true])
            }
        }
    }


    // MARK: - Public JS methods — walk control

    /// Starts walk-2 immediately. Called from JS finish-workout hook.
    /// Gated on phase: only fires if today's flow already saved walk-1 at the
    /// gym (so we don't log every workout finish as a "walk home" — only
    /// genuine morning gym sessions that started with a depart-home walk).
    @objc func startWalkNow(_ call: CAPPluginCall) {
        guard isAutoWalkEnabled() else {
            call.resolve(["started": false, "reason": "auto-walk disabled"])
            return
        }
        let s = walkTracker.loadState()
        // Walk-1 must already be saved at gym (.atGymWalkSaved) OR strength is
        // marked active. Anything else (idle, completed, etc.) means this
        // finishWorkout call is NOT a morning-gym session — skip silently.
        guard s.phase == .atGymWalkSaved || s.phase == .strengthActive else {
            call.resolve(["started": false, "reason": "phase not eligible: \(s.phase.rawValue)"])
            return
        }
        // Same-day guard: the flow's startedAt must be within the last 12 hours.
        if let started = s.startedAt, Date().timeIntervalSince(started) > 12 * 60 * 60 {
            call.resolve(["started": false, "reason": "stale flow (>12h old)"])
            return
        }
        // Home + gym must both be configured (otherwise there's no flow context).
        guard
            loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsHomeKey) != nil,
            loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsGymKey) != nil
        else {
            call.resolve(["started": false, "reason": "home or gym not configured"])
            return
        }
        let _ = walkTracker.start(reason: .postWorkout)
        beginActiveWalkLocationUpdates()
        postWalkStartedNotification(leg: "Post-workout walk started")
        notifyWalkStateChanged()
        call.resolve(["started": true])
    }


    @objc func cancelActiveWalk(_ call: CAPPluginCall) {
        endActiveWalkLocationUpdates()
        walkTracker.cancel()
        notifyWalkStateChanged()
        call.resolve(["cancelled": true])
    }

    /// User-initiated finish for an active walk that didn't reach its
    /// terminal geofence (e.g. arrived at the gym before the geofence fired).
    /// Saves whatever route samples have been collected to HealthKit. Leg-aware:
    /// finishing the outbound leg leaves the flow in .atGymWalkSaved so walk-2
    /// can still auto-start when the user finishes their workout. Finishing the
    /// inbound leg ends the flow.
    @objc func finishActiveWalkNow(_ call: CAPPluginCall) {
        let s = walkTracker.loadState()
        guard s.phase == .walkOutboundActive || s.phase == .walkInboundActive else {
            call.resolve([
                "finished": false,
                "reason": "no active walk: phase=\(s.phase.rawValue)"
            ])
            return
        }
        let leg: WalkLeg = (s.phase == .walkOutboundActive) ? .outbound : .inbound
        // Optimistic transition mirrors the geofence path: outbound → atGymWalkSaved
        // (walk-2 still expected), inbound → completed (flow done).
        let optimisticDest: WalkPhase = (leg == .outbound) ? .atGymWalkSaved : .completed
        walkTracker.transition(to: optimisticDest)
        endActiveWalkLocationUpdates()
        walkTracker.finish(at: Date()) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success:
                // Outbound success is silent (Lou is unlocking phone to lift);
                // inbound success surfaces the "both walks saved" notification.
                if leg == .inbound {
                    self.postWalkCompletedNotification()
                }
                self.notifyWalkStateChanged()
                call.resolve([
                    "finished": true,
                    "leg": leg == .outbound ? "outbound" : "inbound"
                ])
            case .failure(let err):
                // No samples flushed yet — fall back to cancel so the tracker
                // doesn't sit in a terminal phase with stale state.
                if case .noSamples = err {
                    self.walkTracker.cancel()
                    self.notifyWalkStateChanged()
                    call.resolve([
                        "finished": false,
                        "reason": "no samples — cancelled instead"
                    ])
                    return
                }
                self.walkTracker.transition(to: .failedSaveAwaitingRetry)
                self.postWalkSaveFailedNotification(error: err)
                self.notifyWalkStateChanged()
                call.resolve(["finished": false, "reason": "save failed"])
            }
        }
    }

    @objc func getActiveWalkState(_ call: CAPPluginCall) {
        let snap = walkTracker.snapshot()
        call.resolve([
            "phase": snap.phase,
            "flowId": snap.flowId as Any,
            "startedAt": snap.startedAt as Any,
            "distanceMeters": snap.distanceMeters,
            "durationSeconds": snap.durationSeconds,
            "lastSampleAt": snap.lastSampleAt as Any,
            "hkWriteLikelyDenied": UserDefaults.standard.bool(forKey: WalkTracker.hkWriteLikelyDeniedKey)
        ])
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        let home = loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsHomeKey)
        let gym  = loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsGymKey)
        let homeMonitored = home != nil
        let gymMonitored  = gym  != nil

        var resp: [String: Any] = [
            "monitoring": homeMonitored,
            "homeMonitored": homeMonitored,
            "gymMonitored": gymMonitored,
            "autoWalkEnabled": isAutoWalkEnabled(),
        ]
        if let h = home {
            resp["lat"]    = h.lat
            resp["lon"]    = h.lon
            resp["radius"] = h.radius
        }
        if let g = gym {
            resp["gymLat"]    = g.lat
            resp["gymLon"]    = g.lon
            resp["gymRadius"] = g.radius
        }
        call.resolve(resp)
    }

    // MARK: - Setup on plugin load

    public override func load() {
        registerNotificationCategories()
        // The UNUserNotificationCenter.delegate is set by AppDelegate at app launch
        // (AppLaunchNotificationDelegate) so cold-launch notification actions work
        // without depending on plugin lifecycle.

        migrateLegacyRegionIfNeeded()

        if let home = loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsHomeKey) {
            startMonitoringHome(home)
        }
        if let gym = loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsGymKey) {
            startMonitoringGym(gym)
        }

        // On relaunch, recover any active walk state.
        recoverActiveWalkIfNeeded()
    }

    // MARK: - Region monitoring

    private func startMonitoringHome(_ home: StoredRegion) {
        stopMonitoringRegion(id: GeofencePlugin.homeRegionId)
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: home.lat, longitude: home.lon),
            radius: home.radius,
            identifier: GeofencePlugin.homeRegionId
        )
        region.notifyOnEntry = true
        region.notifyOnExit  = true
        locationManager.startMonitoring(for: region)
    }

    private func startMonitoringGym(_ gym: StoredRegion) {
        stopMonitoringRegion(id: GeofencePlugin.gymRegionId)
        let region = CLCircularRegion(
            center: CLLocationCoordinate2D(latitude: gym.lat, longitude: gym.lon),
            radius: gym.radius,
            identifier: GeofencePlugin.gymRegionId
        )
        region.notifyOnEntry = true
        region.notifyOnExit  = true
        locationManager.startMonitoring(for: region)
    }

    private func stopMonitoringRegion(id: String) {
        cancelDwellTimer()
        for region in locationManager.monitoredRegions where region.identifier == id {
            locationManager.stopMonitoring(for: region)
        }
        if id == GeofencePlugin.homeRegionId {
            isInsideHomeRegion = false
            homeRegionEnteredAt = nil
        }
    }

    /// One-time migration for users with the legacy single-region storage.
    private func migrateLegacyRegionIfNeeded() {
        // Storage key was already named GeofenceHomeLocation in the legacy
        // implementation, so no key migration needed. Region identifiers also
        // match. This is a no-op stub to make the migration intent explicit
        // and provide a hook if storage shape ever changes.
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
        // Hydrate in-memory accumulators from persisted state before doing
        // anything else. Without this, finish() and ingest() are no-ops.
        let restored = walkTracker.restoreActiveWalkIfPersisted()
        guard restored else {
            // Persisted phase says active but state is incoherent. Reset to idle.
            walkTracker.transition(to: .idle)
            return
        }
        let now = Date()
        let fourHours: TimeInterval = 4 * 60 * 60
        if let started = state.startedAt, now.timeIntervalSince(started) >= fourHours {
            // Stale — finalize partial save with whatever we have.
            walkTracker.finish(at: now) { [weak self] result in
                self?.handleWalkFinishResult(result, leg: state.phase == .walkOutboundActive ? .outbound : .inbound, partial: true)
            }
        } else {
            // Resume: re-arm location updates.
            beginActiveWalkLocationUpdates()
        }
    }

    // MARK: - Time-window gate

    private func isWithinDepartWindow(_ now: Date = Date()) -> Bool {
        let windows = loadPersisted(DepartWindows.self, key: GeofencePlugin.prefsWindowsKey) ?? DepartWindows.defaults
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

    // MARK: - Handlers triggered by region transitions

    private func handleHomeExit(at: Date = Date()) {
        guard isAutoWalkEnabled() else { return }
        guard isWithinDepartWindow(at) else { return }

        // Don't auto-start if a flow is already mid-progress in any way.
        // Allowed predecessor phases: .idle, .completed, .partialMissedInbound.
        // Anything else suggests contradictory state (e.g., geofence drift) and
        // we'd rather skip than overlap workouts in HealthKit.
        let s = walkTracker.loadState()
        switch s.phase {
        case .idle, .completed, .partialMissedInbound, .permissionRevoked, .failedSaveAwaitingRetry:
            break
        case .walkOutboundActive, .atGymWalkSaved, .strengthActive, .walkInboundActive:
            return
        }

        let _ = walkTracker.start(reason: .departHome)
        beginActiveWalkLocationUpdates()
        postWalkStartedNotification(leg: "Morning walk started")
        notifyWalkStateChanged()
    }

    private func handleGymEntry(at: Date = Date()) {
        let s = walkTracker.loadState()
        guard s.phase == .walkOutboundActive else { return }
        // Transition phase before async finish to block double-fire from a
        // second didEnterRegion event while the HK save is in flight.
        walkTracker.transition(to: .atGymWalkSaved)
        endActiveWalkLocationUpdates()
        walkTracker.finish(at: at) { [weak self] result in
            self?.handleWalkFinishResult(result, leg: .outbound, partial: false)
        }
    }

    private func handleHomeEntry(at: Date = Date()) {
        let s = walkTracker.loadState()
        if s.phase == .walkInboundActive {
            // Same double-fire guard as gym entry.
            walkTracker.transition(to: .completed)  // optimistic; failure handler corrects
            endActiveWalkLocationUpdates()
            walkTracker.finish(at: at) { [weak self] result in
                self?.handleWalkFinishResult(result, leg: .inbound, partial: false)
            }
        }
        // Existing home-arrival behavior: notify JS so any open strength workout
        // can be ended as a fallback. Use timestamp-based dwell rather than Timer
        // (Timer is unreliable when app is suspended in background).
        homeRegionEnteredAt = at
        notifyHomeArrivalIfDwellPassed()
    }

    private func notifyHomeArrivalIfDwellPassed() {
        guard let entered = homeRegionEnteredAt else { return }
        let elapsed = Date().timeIntervalSince(entered)
        if elapsed >= GeofencePlugin.dwellThreshold {
            // Notification is only posted by the walk-2 finish path (postWalkCompletedNotification)
            // when there's something meaningful to surface. The bare home-arrival event still
            // fires for the JS layer to use as a fallback to end any open strength workout.
            notifyListeners("homeArrival", data: [
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ])
            homeRegionEnteredAt = nil
        } else {
            // Re-check on next location update.
            scheduleDwellRecheck(after: GeofencePlugin.dwellThreshold - elapsed)
        }
    }

    private func scheduleDwellRecheck(after seconds: TimeInterval) {
        cancelDwellTimer()
        // Timer is inadequate when suspended; use a one-shot dispatch as a best-effort
        // wakeup while foregrounded. The home-entry handler will re-check on any
        // subsequent location update or app foreground.
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.notifyHomeArrivalIfDwellPassed()
        }
    }

    private enum WalkLeg { case outbound, inbound }

    private func handleWalkFinishResult(_ result: Result<HKWorkout, WalkSaveError>, leg: WalkLeg, partial: Bool) {
        switch result {
        case .success:
            if leg == .outbound {
                walkTracker.transition(to: .atGymWalkSaved)
                // Outbound success is silent — Lou is unlocking phone to lift.
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

    // MARK: - Notifications

    private func registerNotificationCategories() {
        let cancel = UNNotificationAction(
            identifier: GeofencePlugin.cancelActionId,
            title: "Cancel",
            options: [.destructive]
        )
        let category = UNNotificationCategory(
            identifier: GeofencePlugin.walkActiveCategoryId,
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
            content.categoryIdentifier = GeofencePlugin.walkActiveCategoryId
            let id = "\(GeofencePlugin.walkStartedNotifPrefix)-\(flowId)-\(UUID().uuidString.prefix(6))"
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
            let id = "\(GeofencePlugin.walkCompletedNotifPrefix)-\(flowId)"
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
            let id = "\(GeofencePlugin.walkPartialNotifPrefix)-\(flowId)"
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
            let id = "\(GeofencePlugin.walkSaveFailedNotifPrefix)-\(flowId)"
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }

    private func postPermissionRevokedNotification() {
        requestNotifPermissionThen {
            let content = UNMutableNotificationContent()
            content.title = "Auto-walks paused"
            content.body = "Always-Location was disabled. Re-enable it in Settings to resume morning walks."
            content.sound = .default
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: GeofencePlugin.permissionRevokedNotifId, content: content, trigger: nil))
        }
    }

    private func requestNotifPermissionThen(_ work: @escaping () -> Void) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            work()
        }
    }

    // MARK: - Cancel from notification (called by NotificationDelegate)

    fileprivate func handleCancelActionFromNotification() {
        endActiveWalkLocationUpdates()
        // Use cancelFromPersistedState so this works even if the plugin instance
        // is fresh (cold launch via notification action) and `activeFlowId` was
        // never hydrated.
        walkTracker.cancelFromPersistedState()
        notifyWalkStateChanged()
    }

    // MARK: - Push state to JS

    private func notifyWalkStateChanged() {
        let snap = walkTracker.snapshot()
        notifyListeners("walkStateChanged", data: [
            "phase": snap.phase,
            "flowId": snap.flowId as Any,
            "startedAt": snap.startedAt as Any,
            "distanceMeters": snap.distanceMeters,
            "durationSeconds": snap.durationSeconds,
            "lastSampleAt": snap.lastSampleAt as Any
        ])
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
            // User already granted WhileInUse (e.g., from navigator.geolocation
            // in JS land). Request the upgrade to Always — iOS shows a one-time
            // prompt asking "always allow?".
            pendingAuthCompletion = completion
            locationManager.requestAlwaysAuthorization()
        default:
            // .denied or .restricted — can't recover here; user must change
            // permission in iOS Settings.
            completion(false)
        }
    }

    private func isAutoWalkEnabled() -> Bool {
        UserDefaults.standard.bool(forKey: GeofencePlugin.prefsAutoWalkKey)
    }

    private func cancelDwellTimer() {
        dwellTimer?.invalidate()
        dwellTimer = nil
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

extension GeofencePlugin: CLLocationManagerDelegate {

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        let granted = status == .authorizedAlways
        pendingAuthCompletion?(granted)
        pendingAuthCompletion = nil

        if granted {
            if let home = loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsHomeKey) {
                startMonitoringHome(home)
            }
            if let gym = loadPersisted(StoredRegion.self, key: GeofencePlugin.prefsGymKey) {
                startMonitoringGym(gym)
            }
        } else if status == .denied || status == .authorizedWhenInUse || status == .restricted {
            // Always was downgraded or denied. Stop region monitoring (CL would
            // stop it anyway in the background) and surface to UI + notification.
            // Active walk gets cancelled — its route data is preserved in the JSONL
            // file so a future retry could in principle pick it up, but for v1 we
            // just transition cleanly and notify.
            stopMonitoringRegion(id: GeofencePlugin.homeRegionId)
            stopMonitoringRegion(id: GeofencePlugin.gymRegionId)
            let walkState = walkTracker.loadState()
            if walkState.phase == .walkOutboundActive || walkState.phase == .walkInboundActive {
                endActiveWalkLocationUpdates()
            }
            walkTracker.transition(to: .permissionRevoked)
            notifyWalkStateChanged()
            postPermissionRevokedNotification()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        switch region.identifier {
        case GeofencePlugin.homeRegionId:
            guard !isInsideHomeRegion else { return }
            isInsideHomeRegion = true
            handleHomeEntry()
        case GeofencePlugin.gymRegionId:
            handleGymEntry()
        default:
            break
        }
    }

    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        switch region.identifier {
        case GeofencePlugin.homeRegionId:
            isInsideHomeRegion = false
            homeRegionEnteredAt = nil
            cancelDwellTimer()
            handleHomeExit()
        case GeofencePlugin.gymRegionId:
            // Currently unused — walk-2 starts via the JS finishWorkout hook,
            // not gym exit. Left as a hook for v1.1.
            break
        default:
            break
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        // Active-walk path: route the high-accuracy samples to the tracker.
        let s = walkTracker.loadState()
        guard s.phase == .walkOutboundActive || s.phase == .walkInboundActive else {
            // Re-check dwell on any background location update.
            notifyHomeArrivalIfDwellPassed()
            return
        }
        for loc in locations {
            walkTracker.ingest(location: loc)
        }
    }

    public func locationManager(_ manager: CLLocationManager,
                                 monitoringDidFailFor region: CLRegion?,
                                 withError error: Error) {
        print("[GeofencePlugin] Region monitoring failed: \(error)")
    }

    public func locationManager(_ manager: CLLocationManager,
                                 didDetermineState state: CLRegionState,
                                 for region: CLRegion) {
        if region.identifier == GeofencePlugin.homeRegionId, state == .inside, !isInsideHomeRegion {
            isInsideHomeRegion = true
            handleHomeEntry()
        }
    }
}

// Note: notification action handling is in AppDelegate.swift
// (AppLaunchNotificationDelegate). It runs on cold launch independent of the
// plugin lifecycle, operating only on persisted WalkTrackerState.
