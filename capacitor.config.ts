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
  },
};

export default config;
