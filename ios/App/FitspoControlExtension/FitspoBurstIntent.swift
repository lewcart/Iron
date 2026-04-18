import AppIntents

/// AppIntent that sets a shared UserDefaults flag so the main app knows to
/// fire a fitspo burst when it next becomes active.
///
/// `openAppWhenRun = true` brings Rebirth to the foreground so the Capacitor
/// JS layer can execute the camera capture flow.
@available(iOS 18.0, *)
struct FitspoBurstIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture Fitspo Burst"
    static var description = IntentDescription(
        "Opens Rebirth and triggers a burst of fitspo photos."
    )
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        NSLog("%{public}@", "[FitspoBurstIntent] perform() entered")
        let defaults = UserDefaults(suiteName: "group.app.rebirth")
        if defaults == nil {
            NSLog("%{public}@", "[FitspoBurstIntent] FAILED — UserDefaults suite 'group.app.rebirth' returned nil (app group not accessible from extension)")
        } else {
            defaults?.set(true, forKey: "fitspoBurstPending")
            defaults?.synchronize()
            NSLog("%{public}@", "[FitspoBurstIntent] flag set; verify=\(defaults?.bool(forKey: "fitspoBurstPending") ?? false)")
        }
        return .result()
    }
}
