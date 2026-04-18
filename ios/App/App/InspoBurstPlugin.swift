import Foundation
import Capacitor
import Photos
import UIKit

/// Capacitor plugin bridging:
///   1. iOS 18 Lock Screen control → JS (via the `burstTrigger` event)
///   2. JS → iOS Photos library (via the `savePhoto` method)
///
/// When the FitspoControlWidget AppIntent fires (or when the app opens via the
/// control), AppDelegate checks shared UserDefaults for `fitspoBurstPending`.
/// If set, AppDelegate clears the flag and posts `FitspoBurstPendingNotification`.
/// This plugin listens for that notification and re-emits it as a Capacitor event
/// so the JS layer (InspoCaptureButton) can trigger the burst flow.
///
/// JS API:
///   InspoBurst.addListener('burstTrigger', () => { /* start burst */ })
///   InspoBurst.savePhoto({ base64: string }) — writes a JPEG to Photos
@objc(InspoBurstPlugin)
public class InspoBurstPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InspoBurstPlugin"
    public let jsName = "InspoBurst"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "savePhoto", returnType: CAPPluginReturnPromise),
    ]

    // Notification name shared with AppDelegate
    static let burstNotificationName = Notification.Name("FitspoBurstPending")
    // Shared UserDefaults suite (matches the App Group)
    private static let appGroupSuite = "group.app.rebirth"
    private static let burstFlagKey = "fitspoBurstPending"

    override public func load() {
        NSLog("%{public}@", "[InspoBurstPlugin] load() — adding observer + checking flag")
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleBurstPending),
            name: InspoBurstPlugin.burstNotificationName,
            object: nil
        )
        checkPendingFlag()
    }

    private func checkPendingFlag() {
        let defaults = UserDefaults(suiteName: InspoBurstPlugin.appGroupSuite)
        let hasFlag = defaults?.bool(forKey: InspoBurstPlugin.burstFlagKey) ?? false
        NSLog("%{public}@", "[InspoBurstPlugin] checkPendingFlag — defaults=\(defaults == nil ? "nil" : "ok") hasFlag=\(hasFlag)")
        if hasFlag {
            defaults?.set(false, forKey: InspoBurstPlugin.burstFlagKey)
            defaults?.synchronize()
            emitBurst(source: "checkPendingFlag")
        }
    }

    @objc private func handleBurstPending() {
        emitBurst(source: "notification")
    }

    private func emitBurst(source: String) {
        NSLog("%{public}@", "[InspoBurstPlugin] emitBurst (\(source)) — firing burstTrigger to JS")
        notifyListeners("burstTrigger", data: [:], retainUntilConsumed: true)
    }

    // MARK: - savePhoto

    /// Save a base64-encoded JPEG to the user's Photos library.
    /// Triggers the add-only permission prompt on first use.
    @objc func savePhoto(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64") else {
            call.reject("base64 image data is required")
            return
        }
        // Strip any data URL prefix (e.g. "data:image/jpeg;base64,...")
        let b64 = base64.contains(",") ? String(base64.split(separator: ",").last ?? "") : base64
        guard let data = Data(base64Encoded: b64), let image = UIImage(data: data) else {
            call.reject("Failed to decode base64 image")
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photos permission not granted (status=\(status.rawValue))")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.creationRequestForAsset(from: image)
            }) { ok, error in
                if ok {
                    call.resolve()
                } else {
                    call.reject("Save failed: \(error?.localizedDescription ?? "unknown")")
                }
            }
        }
    }
}
