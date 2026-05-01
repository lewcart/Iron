import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.rebirth",
  appName: "Rebirth",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchFadeOutDuration: 350,
      backgroundColor: "#000000",
      splashFullScreen: true,
      splashImmersive: true,
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#ffffff",
      sound: "default",
    },
    // iOS: when the on-screen keyboard appears, resize the WebView body to
    // make room instead of sliding the entire WKWebView up (the default
    // 'native' behavior). Without this, fixed-position elements (TabBar,
    // sheet docks) shift off-screen with the webview and inputs scroll out
    // of view — see /nutrition AddFoodSheet search box. Lou (single-user)
    // reported this regression on iOS Capacitor PWA.
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
      style: "default",
    },
  },
};

export default config;
