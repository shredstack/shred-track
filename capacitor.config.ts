import type { CapacitorConfig } from "@capacitor/cli";
import { config as loadEnv } from "dotenv";

// Capacitor reads this file from a plain Node process (not the browser
// or Next.js runtime), so .env.local is not auto-loaded. Pull it in
// explicitly so the NEXT_PUBLIC_NGROK_DOMAIN flag works here too.
loadEnv({ path: ".env.local" });

// ShredTrack Capacitor configuration.
//
// Strategy: thin native shell that loads the production Next.js app
// directly from https://shredtrack.shredstack.net (per native-app spec
// §4.1). This avoids the rewrite of 116+ server-component call sites a
// static export would require, and keeps a single deploy target.
//
// For local iOS dev, set NEXT_PUBLIC_NGROK_DOMAIN in .env.local and run
// `npx cap sync ios`. See CLAUDE.md → "Local iOS Testing via ngrok".

const ngrokDomain = process.env.NEXT_PUBLIC_NGROK_DOMAIN;
const serverUrl = ngrokDomain
  ? `https://${ngrokDomain}`
  : "https://shredtrack.shredstack.net";

const config: CapacitorConfig = {
  appId: "net.shredstack.shredtrack",
  appName: "ShredTrack",
  webDir: "out",
  server: {
    url: serverUrl,
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
