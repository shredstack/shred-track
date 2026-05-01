// Detect whether the app is running inside a Capacitor native shell.
//
// Branching anywhere in the app should use this helper rather than a
// hand-rolled `isIOS` flag — Android (planned later) will report
// `Capacitor.getPlatform() === 'android'` and the same checks should
// continue to work. Per phasing spec §6.

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  // @ts-expect-error - Capacitor injects this global at runtime.
  const cap = window.Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function nativePlatform(): "ios" | "android" | "web" {
  if (typeof window === "undefined") return "web";
  // @ts-expect-error - runtime global
  const cap = window.Capacitor;
  const p = cap?.getPlatform?.();
  return p === "ios" || p === "android" ? p : "web";
}
