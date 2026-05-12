"use client";

// /settings/native — notification preferences for the iOS Today
// notifications: morning brief + midday score nudge (spec
// watch_today_view_and_nudges_spec.md §5.4).
//
// Capacitor-only. On web we render the same page in a "not available"
// state so the route doesn't 404, but most users won't reach it from
// web anyway — the link only surfaces inside the native shell.

import { useEffect, useState } from "react";
import { Bell, Clock, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { isNativeApp } from "@/lib/native/is-native";
import {
  DEFAULT_PREFS,
  type TodayNotificationPrefs,
  getTodayNotificationPrefs,
  setTodayNotificationPrefs,
} from "@/lib/native/notifications/preferences";
import {
  ensureNotificationPermission,
  rescheduleTodayNotifications,
  cancelAllTodayNotifications,
} from "@/lib/native/notifications/today-notifications";

export default function NativeSettingsPage() {
  const [prefs, setPrefs] = useState<TodayNotificationPrefs | null>(null);
  const [native, setNative] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNative(isNativeApp());
    void getTodayNotificationPrefs().then(setPrefs);
    if (isNativeApp()) {
      void (async () => {
        try {
          const { LocalNotifications } = await import("@capacitor/local-notifications");
          const status = await LocalNotifications.checkPermissions();
          setPermissionGranted(status.display === "granted");
        } catch {
          setPermissionGranted(false);
        }
      })();
    }
  }, []);

  async function persist(next: TodayNotificationPrefs) {
    setPrefs(next);
    setBusy(true);
    try {
      await setTodayNotificationPrefs(next);
      if (!next.morningBriefEnabled && !next.middayNudgeEnabled) {
        await cancelAllTodayNotifications();
      } else {
        await rescheduleTodayNotifications();
      }
    } catch (err) {
      toast.error("Couldn't save settings — try again");
      console.warn("[/settings/native] persist failed", err);
    } finally {
      setBusy(false);
    }
  }

  async function requestPermission() {
    setBusy(true);
    try {
      const granted = await ensureNotificationPermission();
      setPermissionGranted(granted);
      if (granted && prefs) {
        await rescheduleTodayNotifications();
      } else if (!granted) {
        toast("Notifications stay off — enable them in iOS Settings to receive reminders.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (!prefs) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Two reminders a day — no spam, no marketing pushes.
        </p>
      </header>

      {!native && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-sm">
          Notifications are only available in the iOS app.
        </div>
      )}

      {native && permissionGranted === false && (
        <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-primary" />
            <span className="text-sm font-medium">
              Stay on track with daily reminders
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            ShredTrack can send a morning brief with today&apos;s programming
            and a midday nudge if you forgot to log. You can change times or
            turn either off any time.
          </p>
          <Button size="sm" onClick={requestPermission} disabled={busy}>
            Turn on notifications
          </Button>
        </div>
      )}

      {/* Morning brief */}
      <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Morning brief</h2>
            <p className="text-xs text-muted-foreground">
              A glance at what&apos;s programmed today.
            </p>
          </div>
          <Switch
            checked={prefs.morningBriefEnabled}
            onCheckedChange={(checked: boolean) =>
              void persist({ ...prefs, morningBriefEnabled: !!checked })
            }
          />
        </div>
        {prefs.morningBriefEnabled && (
          <TimeRow
            icon={<Clock className="size-4 text-muted-foreground" />}
            label="Time"
            hour={prefs.morningBriefHour}
            minute={prefs.morningBriefMinute}
            onChange={(h, m) =>
              void persist({
                ...prefs,
                morningBriefHour: h,
                morningBriefMinute: m,
              })
            }
          />
        )}
      </section>

      {/* Midday nudge */}
      <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Midday score nudge</h2>
            <p className="text-xs text-muted-foreground">
              Only fires when something hasn&apos;t been logged.
            </p>
          </div>
          <Switch
            checked={prefs.middayNudgeEnabled}
            onCheckedChange={(checked: boolean) =>
              void persist({ ...prefs, middayNudgeEnabled: !!checked })
            }
          />
        </div>
        {prefs.middayNudgeEnabled && (
          <TimeRow
            icon={<Clock className="size-4 text-muted-foreground" />}
            label="Time"
            hour={prefs.middayNudgeHour}
            minute={prefs.middayNudgeMinute}
            onChange={(h, m) =>
              void persist({
                ...prefs,
                middayNudgeHour: h,
                middayNudgeMinute: m,
              })
            }
          />
        )}
      </section>

      {/* Per-content toggles */}
      <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
        <h2 className="text-base font-medium">Include in reminders</h2>
        <PrefRow
          label="HYROX plan"
          checked={prefs.includeHyrox}
          onCheckedChange={(checked) =>
            void persist({ ...prefs, includeHyrox: checked })
          }
        />
        <PrefRow
          label="CrossFit WOD"
          checked={prefs.includeCrossfit}
          onCheckedChange={(checked) =>
            void persist({ ...prefs, includeCrossfit: checked })
          }
        />
        <PrefRow
          label="Recovery"
          checked={prefs.includeRecovery}
          onCheckedChange={(checked) =>
            void persist({ ...prefs, includeRecovery: checked })
          }
        />
      </section>

      <p className="text-xs text-muted-foreground">
        Defaults: morning brief at {fmt(DEFAULT_PREFS.morningBriefHour, DEFAULT_PREFS.morningBriefMinute)},
        midday nudge at {fmt(DEFAULT_PREFS.middayNudgeHour, DEFAULT_PREFS.middayNudgeMinute)}.
      </p>
    </div>
  );
}

function PrefRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-sm">{label}</Label>
      <Switch
        checked={checked}
        onCheckedChange={(c: boolean) => onCheckedChange(!!c)}
      />
    </div>
  );
}

function TimeRow({
  icon,
  label,
  hour,
  minute,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  // Native `<input type="time">` is the right call here — the iOS
  // WebView surfaces a proper wheel picker and the OS handles 12/24h
  // localization.
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <input
        type="time"
        value={value}
        onChange={(e) => {
          const [h, m] = e.target.value.split(":").map((n) => Number(n));
          if (!Number.isFinite(h) || !Number.isFinite(m)) return;
          onChange(h, m);
        }}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
      />
    </div>
  );
}

function fmt(hour: number, minute: number): string {
  const period = hour >= 12 ? "pm" : "am";
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${String(minute).padStart(2, "0")} ${period}`;
}
