import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // When iOS relaunches the app in the background due to a CLRegion boundary crossing,
        // GeofencePlugin.load() re-creates the CLLocationManager and re-registers the monitored
        // region so the didDetermineState callback fires within the ~10 s background window.

        // Register the notification-action delegate at app-launch (not plugin load). When iOS
        // delivers a notification action via cold launch, the plugin instance may not exist
        // yet — but the delegate must be set before the system asks who handles the action.
        // The delegate handles the Cancel action on walk-active notifications via the
        // persisted WalkTrackerState, independent of the JS bridge.
        UNUserNotificationCenter.current().delegate = AppLaunchNotificationDelegate.shared

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
        if defaults?.bool(forKey: "fitspoBurstPending") == true {
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
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

/// Standalone UNUserNotificationCenterDelegate that survives cold-launch via
/// notification action. Operates entirely from persisted state — does NOT
/// depend on Capacitor plugins being loaded yet.
class AppLaunchNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = AppLaunchNotificationDelegate()

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                 willPresent notification: UNNotification,
                                 withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                 didReceive response: UNNotificationResponse,
                                 withCompletionHandler completionHandler: @escaping () -> Void) {
        if response.actionIdentifier == "REBIRTH_WALK_CANCEL" {
            // Cancel the active walk using only persisted state — works even if
            // the plugin instance hasn't been created yet.
            WalkTracker().cancelFromPersistedState()
        }
        completionHandler()
    }
}
