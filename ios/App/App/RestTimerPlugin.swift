import Foundation
import Capacitor
import ActivityKit

/// Capacitor plugin that bridges the rest-timer JS layer to ActivityKit so
/// the countdown appears on the Lock Screen and Dynamic Island.
///
/// JS API (see `src/lib/native/rest-timer-activity.ts`):
///   RestTimer.start({ endTime, duration, exerciseName?, setNumber?, overtimeStart? })
///   RestTimer.update({ endTime?, paused?, overtimeStart? | overtimeStartNull? })
///   RestTimer.end()
///
/// `overtimeStart` (epoch ms) switches the widget into red count-UP mode.
/// Pass `overtimeStartNull: true` on update to clear it back to countdown.
///
/// Missing support (simulator, iOS < 16.2, user disabled Live Activities in
/// Settings) is treated as silent success — the web UI still works; we just
/// don't decorate the Lock Screen.
@objc(RestTimerPlugin)
public class RestTimerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RestTimerPlugin"
    public let jsName = "RestTimer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentActivity", returnType: CAPPluginReturnPromise),
    ]

    // Type-erased holder so we don't need to gate the property itself on
    // availability. ActivityKit APIs are gated on iOS 16.2+.
    fileprivate static var currentActivityAny: Any?

    /// End the running Live Activity from native code paths. Used by the
    /// WatchConnectivityPlugin's NativeInboundProcessor when a watch
    /// stopRest message arrives — without this, the iOS Dynamic Island
    /// lingers until JS wakes up and processes the same event (~10s).
    @available(iOS 16.2, *)
    static func endCurrentActivityNatively() {
        guard let activity = currentActivityAny as? Activity<RestTimerAttributes> else {
            return
        }
        Task {
            await activity.end(nil, dismissalPolicy: .immediate)
            currentActivityAny = nil
        }
    }

    // MARK: - start

    @objc func start(_ call: CAPPluginCall) {
        let endTimeMs = call.getDouble("endTime") ?? call.getDouble("endTimeMs") ?? 0
        let duration = call.getInt("duration") ?? 0
        let exerciseName = call.getString("exerciseName") ?? "Rest"
        let setNumber = call.getInt("setNumber") ?? 0
        let overtimeStartMs = call.getDouble("overtimeStart")

        guard endTimeMs > 0 else {
            call.reject("endTime (epoch ms) is required")
            return
        }

        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                // User disabled Live Activities for this app or globally. The phone
                // in-app rest UI + watch snapshot remain authoritative — Live
                // Activity is decoration only. Surface the disabled state so the
                // JS layer knows ActivityKit didn't take.
                call.resolve(["started": false, "reason": "disabled"])
                return
            }

            let endDate = Date(timeIntervalSince1970: endTimeMs / 1000.0)
            let attributes = RestTimerAttributes(
                exerciseName: exerciseName,
                setNumber: setNumber
            )
            let overtimeStart = overtimeStartMs.map { Date(timeIntervalSince1970: $0 / 1000.0) }
            let initialState = RestTimerAttributes.ContentState(
                endDate: endDate,
                duration: duration,
                paused: false,
                overtimeStart: overtimeStart
            )

            Task {
                // If there's already an activity (e.g. JS restarted mid-rest),
                // end it first so we don't accumulate stacked banners.
                if let existing = RestTimerPlugin.currentActivityAny as? Activity<RestTimerAttributes> {
                    await existing.end(nil, dismissalPolicy: .immediate)
                    RestTimerPlugin.currentActivityAny = nil
                }

                do {
                    let content = ActivityContent(
                        state: initialState,
                        staleDate: endDate.addingTimeInterval(60)
                    )
                    let activity = try Activity<RestTimerAttributes>.request(
                        attributes: attributes,
                        content: content,
                        pushType: nil
                    )
                    RestTimerPlugin.currentActivityAny = activity
                    call.resolve(["started": true])
                } catch {
                    CAPLog.print("[RestTimerPlugin] start failed:", error.localizedDescription)
                    call.resolve(["started": false, "reason": "request_failed"])
                }
            }
        } else {
            // Live Activities unsupported on this OS — JS state remains authoritative.
            call.resolve(["started": false, "reason": "unsupported"])
        }
    }

    // MARK: - currentActivity
    //
    // Hydration helper for the JS rest-timer-state store. On Capacitor JS
    // revive (e.g. after a process kill mid-rest), the store reads
    // localStorage AND queries this method to detect orphaned ActivityKit
    // Activities the JS layer didn't know about. If the persisted store
    // doesn't reference an active Activity, the JS layer calls end() to clear.

    @objc func currentActivity(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            guard let activity = RestTimerPlugin.currentActivityAny as? Activity<RestTimerAttributes> else {
                call.resolve(["active": false])
                return
            }
            let state = activity.content.state
            let endAtMs = state.endDate.timeIntervalSince1970 * 1000.0
            var result: [String: Any] = [
                "active": true,
                "end_at_ms": endAtMs,
                "duration_sec": state.duration,
                "paused": state.paused,
            ]
            if let overtimeStart = state.overtimeStart {
                result["overtime_start_ms"] = overtimeStart.timeIntervalSince1970 * 1000.0
            }
            call.resolve(result)
        } else {
            call.resolve(["active": false])
        }
    }

    // MARK: - update

    @objc func update(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            guard let activity = RestTimerPlugin.currentActivityAny as? Activity<RestTimerAttributes> else {
                // Nothing to update → treat as success.
                call.resolve()
                return
            }

            let current = activity.content.state
            let endTimeMs = call.getDouble("endTime") ?? call.getDouble("endTimeMs")
            let endDate = endTimeMs.map { Date(timeIntervalSince1970: $0 / 1000.0) } ?? current.endDate
            let paused = call.getBool("paused") ?? current.paused
            let duration = call.getInt("duration") ?? current.duration

            // overtimeStart: set a new value, clear it with `overtimeStartNull: true`,
            // or omit to preserve the existing value.
            let overtimeStart: Date?
            if call.getBool("overtimeStartNull") == true {
                overtimeStart = nil
            } else if let ms = call.getDouble("overtimeStart") {
                overtimeStart = Date(timeIntervalSince1970: ms / 1000.0)
            } else {
                overtimeStart = current.overtimeStart
            }

            let newState = RestTimerAttributes.ContentState(
                endDate: endDate,
                duration: duration,
                paused: paused,
                overtimeStart: overtimeStart
            )

            Task {
                // Overtime widgets should stay fresh indefinitely; countdown widgets
                // become stale a minute after endDate.
                let staleDate = overtimeStart == nil
                    ? endDate.addingTimeInterval(60)
                    : Date().addingTimeInterval(60 * 60) // 1h
                let content = ActivityContent(state: newState, staleDate: staleDate)
                await activity.update(content)
                call.resolve()
            }
        } else {
            call.resolve()
        }
    }

    // MARK: - end

    @objc func end(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            guard let activity = RestTimerPlugin.currentActivityAny as? Activity<RestTimerAttributes> else {
                call.resolve()
                return
            }
            Task {
                await activity.end(nil, dismissalPolicy: .immediate)
                RestTimerPlugin.currentActivityAny = nil
                call.resolve()
            }
        } else {
            call.resolve()
        }
    }
}
