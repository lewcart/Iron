import Foundation
import Capacitor

/// Capacitor plugin that bridges the iOS 18 Lock Screen control to the JS layer.
///
/// When the FitspoControlWidget AppIntent fires (or when the app opens via the
/// control), AppDelegate checks shared UserDefaults for `fitspoBurstPending`.
/// If set, AppDelegate clears the flag and posts `FitspoBurstPendingNotification`.
/// This plugin listens for that notification and re-emits it as a Capacitor event
/// so the JS layer (InspoCaptureButton) can trigger the burst flow.
///
/// JS API:
///   InspoBurstPlugin.addListener('burstTrigger', () => { /* start burst */ })
@objc(InspoBurstPlugin)
public class InspoBurstPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InspoBurstPlugin"
    public let jsName = "InspoBurst"
    public let pluginMethods: [CAPPluginMethod] = []

    // Notification name shared with AppDelegate
    static let burstNotificationName = Notification.Name("FitspoBurstPending")

    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleBurstPending),
            name: InspoBurstPlugin.burstNotificationName,
            object: nil
        )
    }

    @objc private func handleBurstPending() {
        notifyListeners("burstTrigger", data: [:])
    }
}
