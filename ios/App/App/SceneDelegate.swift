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

    override init() {
        super.init()
        appDelegateCrumb("SceneDelegate init")
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts {
            appDelegateCrumb("SceneDelegate openURLContexts url=\(ctx.url.absoluteString)")
            if ctx.url.scheme == "rebirth" && ctx.url.host == "burst" {
                let defaults = UserDefaults(suiteName: "group.app.rebirth")
                defaults?.set(true, forKey: "fitspoBurstPending")
                defaults?.synchronize()
                NotificationCenter.default.post(
                    name: Notification.Name("FitspoBurstPending"),
                    object: nil
                )
            }
        }
    }

    // Cold-launch URLs arrive via connectionOptions on scene connect.
    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        for ctx in connectionOptions.urlContexts {
            appDelegateCrumb("SceneDelegate willConnectTo url=\(ctx.url.absoluteString)")
            if ctx.url.scheme == "rebirth" && ctx.url.host == "burst" {
                let defaults = UserDefaults(suiteName: "group.app.rebirth")
                defaults?.set(true, forKey: "fitspoBurstPending")
                defaults?.synchronize()
                // Post with a slight delay so Capacitor bridge + plugin load()
                // have a chance to set up the notification observer. The
                // checkPendingFlag() path in the plugin's load() is the other
                // half of the belt-and-braces.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    NotificationCenter.default.post(
                        name: Notification.Name("FitspoBurstPending"),
                        object: nil
                    )
                }
            }
        }
    }
}
