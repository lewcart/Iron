import AppIntents
import Foundation

/// AppIntent fired by the FitspoControlWidget Lock Screen / Control Centre
/// button. Registered as a member of BOTH the main App target and the
/// FitspoControlExtension target (via project.pbxproj membership) so iOS
/// sees the intent in the main app bundle's AppIntents metadata — that's
/// what makes `openAppWhenRun = true` actually fire.
///
/// When only the extension-target build of the intent is registered, iOS
/// refuses with "openAppWhenRun is not supported in extensions" (CHS error
/// 1107 / "Encountered action intent without linkAction").
///
/// Flow:
///   1. User taps the Lock Screen control.
///   2. iOS looks up the intent in app.rebirth's bundle metadata, finds it,
///      sees `openAppWhenRun = true`, opens Rebirth.
///   3. `perform()` runs in the main app process (foreground-inactive, then
///      active), sets the shared-UserDefaults flag, posts the
///      FitspoBurstPending notification.
///   4. InspoBurstPlugin.handleBurstPending (or checkPendingFlag on load())
///      emits `burstTrigger` to the JS layer.
///   5. InspoCaptureButton.onNativeBurstTrigger runs the 5-shot burst.
@available(iOS 16.0, *)
struct FitspoBurstIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture Fitspo Burst"
    static var description = IntentDescription(
        "Opens Rebirth and triggers a burst of physique inspiration photos."
    )
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: "group.app.rebirth")
        defaults?.set(true, forKey: "fitspoBurstPending")
        defaults?.synchronize()
        NotificationCenter.default.post(
            name: Notification.Name("FitspoBurstPending"),
            object: nil
        )
        return .result()
    }
}
