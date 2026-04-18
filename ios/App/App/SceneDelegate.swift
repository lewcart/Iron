import UIKit

/// Scene delegate that catches URL opens when the app is running.
/// iOS 18 wraps our app in a UIScene even though we don't declare one
/// in Info.plist, which means application(_:open:) on AppDelegate never
/// fires. Scene-based URL callbacks land here instead.
///
/// Registered via AppDelegate.application(_:configurationForConnecting:options:).
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    // Warm: external URL open (Safari `rebirth://burst`, etc.).
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts where ctx.url.scheme == "rebirth" && ctx.url.host == "burst" {
            postBurstNotification(delay: 0)
        }
    }

    // Cold: launched from a URL. Plugin + webview aren't ready yet so delay
    // the notification slightly, and InspoBurstPlugin.checkPendingFlag() on
    // load() is the secondary catch.
    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        for ctx in connectionOptions.urlContexts where ctx.url.scheme == "rebirth" && ctx.url.host == "burst" {
            postBurstNotification(delay: 0.5)
        }
    }

    private func postBurstNotification(delay: TimeInterval) {
        let defaults = UserDefaults(suiteName: "group.app.rebirth")
        defaults?.set(true, forKey: "fitspoBurstPending")
        defaults?.synchronize()
        let fire = {
            NotificationCenter.default.post(
                name: Notification.Name("FitspoBurstPending"),
                object: nil
            )
        }
        if delay > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: fire)
        } else {
            fire()
        }
    }
}
