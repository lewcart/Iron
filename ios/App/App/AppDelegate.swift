import UIKit
import Capacitor

/// Temporary file-based diagnostic — writes to Documents/rebirth-debug.log
/// so we can verify the URL / flag / notification chain without fighting
/// os_log redaction + idevicesyslog flakiness.
func appDelegateCrumb(_ label: String) {
    let ts = ISO8601DateFormatter().string(from: Date())
    let line = "\(ts)  \(label)\n"
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
    guard let url = docs?.appendingPathComponent("rebirth-debug.log") else { return }
    if let h = try? FileHandle(forWritingTo: url) {
        h.seekToEndOfFile(); h.write(line.data(using: .utf8) ?? Data()); try? h.close()
    } else {
        try? line.data(using: .utf8)?.write(to: url)
    }
    NSLog("%{public}@", "[Rebirth] " + label)
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let launchURL = launchOptions?[.url] as? URL
        appDelegateCrumb("didFinishLaunching launchURL=\(launchURL?.absoluteString ?? "nil")")
        // If the app is launching FROM a URL (cold start from Control Widget),
        // handle it here since application(_:open:) may not fire in this path.
        if let url = launchURL, url.scheme == "rebirth" && url.host == "burst" {
            handleBurstURL()
        }
        return true
    }

    private func handleBurstURL() {
        appDelegateCrumb("handleBurstURL — setting flag + posting notification")
        let defaults = UserDefaults(suiteName: "group.app.rebirth")
        defaults?.set(true, forKey: "fitspoBurstPending")
        defaults?.synchronize()
        NotificationCenter.default.post(
            name: Notification.Name("FitspoBurstPending"),
            object: nil
        )
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        let defaults = UserDefaults(suiteName: "group.app.rebirth")
        let hasFlag = defaults?.bool(forKey: "fitspoBurstPending") ?? false
        appDelegateCrumb("didBecomeActive defaults=\(defaults == nil ? "nil" : "ok") hasFlag=\(hasFlag)")
        if hasFlag {
            defaults?.set(false, forKey: "fitspoBurstPending")
            defaults?.synchronize()
            NotificationCenter.default.post(
                name: Notification.Name("FitspoBurstPending"),
                object: nil
            )
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        appDelegateCrumb("application(_:open:) url=\(url.absoluteString)")
        if url.scheme == "rebirth" && url.host == "burst" {
            handleBurstURL()
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Scene-based lifecycle fallback (iOS 13+ scene apps route URLs here
    // instead of application(_:open:). We don't declare scenes, but iOS 18
    // apps sometimes get scenes anyway). Handled via the window's scene.
    @available(iOS 13.0, *)
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        appDelegateCrumb("configurationForConnecting urls=\(options.urlContexts.map { $0.url.absoluteString })")
        for ctx in options.urlContexts {
            if ctx.url.scheme == "rebirth" && ctx.url.host == "burst" {
                handleBurstURL()
            }
        }
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
