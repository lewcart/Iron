import Foundation
import Capacitor

// MARK: - GeofencePlugin

/// Thin Capacitor bridge over `WalkGeofenceMonitor`. All monitoring state,
/// region handling, and the CLLocationManager live in the monitor singleton so
/// they survive a background region-relaunch where this plugin's `load()` never
/// runs (see WalkGeofenceMonitor for the full rationale). This class only:
///   1. forwards JS method calls to the monitor, and
///   2. wires the monitor's event hooks to `notifyListeners` for the live UI.
///
/// JS API (unchanged):
///   GeofencePlugin.setHomeLocation({ lat, lon, radius? })
///   GeofencePlugin.removeHomeLocation()
///   GeofencePlugin.setGymLocation({ lat, lon, radius? })
///   GeofencePlugin.removeGymLocation()
///   GeofencePlugin.setDepartWindows({ weekday: { start, end }, weekend: { start, end } })
///   GeofencePlugin.setAutoWalkEnabled({ enabled })
///   GeofencePlugin.startWalkNow()
///   GeofencePlugin.cancelActiveWalk()
///   GeofencePlugin.finishActiveWalkNow()
///   GeofencePlugin.getActiveWalkState()
///   GeofencePlugin.getStatus()
///   addListener('homeArrival', handler)
///   addListener('walkStateChanged', handler)

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

    private var monitor: WalkGeofenceMonitor { WalkGeofenceMonitor.shared }

    public override func load() {
        // AppDelegate already bootstrapped the monitor at launch; this is an
        // idempotent no-op for the location wiring. We only (re)attach the JS
        // event bridge so the foreground UI gets live updates.
        monitor.bootstrapAtLaunch()
        monitor.onWalkStateChanged = { [weak self] in
            self?.notifyListeners("walkStateChanged", data: WalkGeofenceMonitor.shared.walkStateChangedDict())
        }
        monitor.onHomeArrival = { [weak self] in
            self?.notifyListeners("homeArrival", data: [
                "timestamp": ISO8601DateFormatter().string(from: Date())
            ])
        }
    }

    // MARK: - Home

    @objc func setHomeLocation(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else {
            call.reject("lat and lon are required")
            return
        }
        let radius = call.getDouble("radius") ?? WalkGeofenceMonitor.defaultHomeRadius
        monitor.setHome(lat: lat, lon: lon, radius: radius) { resolve, reject in
            if let resolve = resolve { call.resolve(resolve) }
            else { call.reject(reject ?? "setHomeLocation failed") }
        }
    }

    @objc func removeHomeLocation(_ call: CAPPluginCall) {
        monitor.removeHome()
        call.resolve(["monitoring": false])
    }

    // MARK: - Gym

    @objc func setGymLocation(_ call: CAPPluginCall) {
        guard let lat = call.getDouble("lat"), let lon = call.getDouble("lon") else {
            call.reject("lat and lon are required")
            return
        }
        let radius = call.getDouble("radius") ?? WalkGeofenceMonitor.defaultGymRadius
        monitor.setGym(lat: lat, lon: lon, radius: radius) { resolve, reject in
            if let resolve = resolve { call.resolve(resolve) }
            else { call.reject(reject ?? "setGymLocation failed") }
        }
    }

    @objc func removeGymLocation(_ call: CAPPluginCall) {
        monitor.removeGym()
        call.resolve(["monitoring": false])
    }

    // MARK: - Windows + master toggle

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
        let ok = monitor.setDepartWindows(
            weekdayStart: wdStart, weekdayEnd: wdEnd,
            weekendStart: weStart, weekendEnd: weEnd
        )
        if ok { call.resolve(["ok": true]) }
        else { call.reject("Window times must be HH:mm") }
    }

    @objc func setAutoWalkEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        monitor.setAutoWalkEnabled(enabled)
        call.resolve(["enabled": enabled])
    }

    @objc func requestHKWriteAuth(_ call: CAPPluginCall) {
        monitor.requestHKWriteAuth { err in
            if let err = err { call.reject(err.localizedDescription) }
            else { call.resolve(["requested": true]) }
        }
    }

    // MARK: - Walk control

    @objc func startWalkNow(_ call: CAPPluginCall) {
        call.resolve(monitor.startWalkNow())
    }

    @objc func cancelActiveWalk(_ call: CAPPluginCall) {
        monitor.cancelActiveWalk()
        call.resolve(["cancelled": true])
    }

    @objc func finishActiveWalkNow(_ call: CAPPluginCall) {
        monitor.finishActiveWalkNow { resolve in call.resolve(resolve) }
    }

    @objc func getActiveWalkState(_ call: CAPPluginCall) {
        call.resolve(monitor.activeWalkStateDict())
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(monitor.statusDict())
    }
}

// Note: notification action handling is in AppDelegate.swift
// (AppLaunchNotificationDelegate). It runs on cold launch independent of the
// plugin lifecycle, operating on the shared WalkGeofenceMonitor / persisted state.
