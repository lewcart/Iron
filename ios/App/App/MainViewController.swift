import Capacitor
import UIKit

/// Custom Capacitor bridge view controller that registers local Swift plugins
/// (those defined loose in the App target, not as SPM packages).
///
/// Capacitor 8 only auto-registers plugins listed in `packageClassList` in
/// `capacitor.config.json`, which is generated from SPM dependencies in
/// `CapApp-SPM/Package.swift`. Loose `.swift` plugins in the App target must
/// be registered manually — that's what this subclass is for.
///
/// Wired in `Base.lproj/Main.storyboard` via `customClass="MainViewController"`.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginType(RestTimerPlugin.self)
        bridge?.registerPluginType(InspoBurstPlugin.self)
    }
}
