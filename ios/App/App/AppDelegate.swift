import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // When iOS relaunches the app in the background due to a CLRegion boundary crossing,
        // GeofencePlugin.load() re-creates the CLLocationManager and re-registers the monitored
        // region so the didDetermineState callback fires within the ~10 s background window.
        return true
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
        NSLog("%{public}@", "[AppDelegate] didBecomeActive — defaults=\(defaults == nil ? "nil" : "ok") hasFlag=\(hasFlag)")
        if hasFlag {
            defaults?.set(false, forKey: "fitspoBurstPending")
            defaults?.synchronize()
            NSLog("%{public}@", "[AppDelegate] posting FitspoBurstPending notification")
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
        NSLog("%{public}@", "[AppDelegate] open url: \(url.absoluteString)")
        // rebirth://burst — fired by FitspoControlWidget. Set the shared flag
        // and post the notification so InspoBurstPlugin can trigger the JS
        // burst capture. applicationDidBecomeActive also covers this path as
        // a fallback.
        if url.scheme == "rebirth" && url.host == "burst" {
            let defaults = UserDefaults(suiteName: "group.app.rebirth")
            defaults?.set(true, forKey: "fitspoBurstPending")
            defaults?.synchronize()
            NotificationCenter.default.post(
                name: Notification.Name("FitspoBurstPending"),
                object: nil
            )
        }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
