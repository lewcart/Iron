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
        let defaults = UserDefaults(suiteName: "group.app.rebirth")
        defaults?.set(true, forKey: "fitspoBurstPending")
        defaults?.synchronize()
        return .result()
    }
}
