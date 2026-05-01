import type { CapacitorConfig } from "@capacitor/cli";

// ShredTrack Capacitor configuration.
//
// Strategy: thin native shell that loads the production Next.js app
// directly from https://shredtrack.shredstack.net (per native-app spec
// §4.1). This avoids the rewrite of 116+ server-component call sites a
// static export would require, and keeps a single deploy target. Switch
// `server.url` to a local dev URL (e.g. http://192.168.x.x:3000) when
// debugging the shell against a local Next.js server — but never commit
// that change.

const config: CapacitorConfig = {
  appId: "net.shredstack.shredtrack",
  appName: "ShredTrack",
  webDir: "out",
  server: {
    url: "https://shredtrack.shredstack.net",
    cleartext: false,
    androidScheme: "https",
  },
  ios: {
    contentInset: "always",
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: "#0a0a0a",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#22c55e",
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0a0a0a",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
