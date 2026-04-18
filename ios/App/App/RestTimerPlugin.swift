import Foundation
import Capacitor
import ActivityKit

/// Capacitor plugin that bridges the rest-timer JS layer to ActivityKit so
/// the countdown appears on the Lock Screen and Dynamic Island.
///
/// JS API (see `src/lib/native/rest-timer-activity.ts`):
///   RestTimer.start({ endTime, duration, exerciseName?, setNumber? })
///   RestTimer.update({ endTime, paused? })
///   RestTimer.end()
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
    ]

    // Type-erased holder so we don't need to gate the property itself on
    // availability. ActivityKit APIs are gated on iOS 16.2+.
    private static var currentActivityAny: Any?

    // MARK: - start

    @objc func start(_ call: CAPPluginCall) {
        let endTimeMs = call.getDouble("endTime") ?? call.getDouble("endTimeMs") ?? 0
        let duration = call.getInt("duration") ?? 0
        let exerciseName = call.getString("exerciseName") ?? "Rest"
        let setNumber = call.getInt("setNumber") ?? 0

        guard endTimeMs > 0 else {
            call.reject("endTime (epoch ms) is required")
            return
        }

        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                // User disabled Live Activities for this app or globally → silent success.
                call.resolve()
                return
            }

            let endDate = Date(timeIntervalSince1970: endTimeMs / 1000.0)
            let attributes = RestTimerAttributes(
                exerciseName: exerciseName,
                setNumber: setNumber
            )
            let initialState = RestTimerAttributes.ContentState(
                endDate: endDate,
                duration: duration,
                paused: false
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
                    call.resolve()
                } catch {
                    // Not fatal — JS timer still works.
                    CAPLog.print("[RestTimerPlugin] start failed:", error.localizedDescription)
                    call.resolve()
                }
            }
        } else {
            // Live Activities unsupported on this OS → silent success.
            call.resolve()
        }
    }

    // MARK: - update

    @objc func update(_ call: CAPPluginCall) {
        let endTimeMs = call.getDouble("endTime") ?? call.getDouble("endTimeMs") ?? 0

        guard endTimeMs > 0 else {
            call.reject("endTime (epoch ms) is required")
            return
        }

        if #available(iOS 16.2, *) {
            guard let activity = RestTimerPlugin.currentActivityAny as? Activity<RestTimerAttributes> else {
                // Nothing to update → treat as success.
                call.resolve()
                return
            }

            let paused = call.getBool("paused") ?? activity.content.state.paused
            let endDate = Date(timeIntervalSince1970: endTimeMs / 1000.0)
            // Preserve original duration if the caller didn't supply one.
            let duration = call.getInt("duration") ?? activity.content.state.duration
            let newState = RestTimerAttributes.ContentState(
                endDate: endDate,
                duration: duration,
                paused: paused
            )

            Task {
                let content = ActivityContent(
                    state: newState,
                    staleDate: endDate.addingTimeInterval(60)
                )
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
