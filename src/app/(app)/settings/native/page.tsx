"use client";

// /settings/native — on-device notification settings. Same controls as
// the Notifications page surfaces; kept here for backward compatibility
// with the existing "Native app" link in the profile menu.

import { LocalNotificationSettings } from "@/components/settings/local-notification-settings";

export default function NativeSettingsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Daily reminders for today&apos;s training — no marketing pushes.
        </p>
      </header>
      <LocalNotificationSettings />
    </div>
  );
}
