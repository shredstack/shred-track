"use client";

// /settings/native — notification preferences for the iOS Today
// notifications: morning brief, midday score nudge, and the opt-in
// CrossFit log-by-deadline nudge.
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
  buildNotificationDiagnostic,
  cancelAllTodayNotifications,
  ensureNotificationPermission,
  rescheduleTodayNotifications,
  type NotificationDiagnostic,
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
      if (
        !next.morningBriefEnabled &&
        !next.middayNudgeEnabled &&
        !next.crossfitLogNudgeEnabled
      ) {
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
          Daily reminders for today&apos;s training — no marketing pushes.
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

      {/* CrossFit log-by-deadline nudge (opt-in) */}
      <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">CrossFit log reminder</h2>
            <p className="text-xs text-muted-foreground">
              Reminds you to log your WOD after class. Uses your registered
              class for today, or your default time below.
            </p>
          </div>
          <Switch
            checked={prefs.crossfitLogNudgeEnabled}
            onCheckedChange={(checked: boolean) =>
              void persist({ ...prefs, crossfitLogNudgeEnabled: !!checked })
            }
          />
        </div>
        {prefs.crossfitLogNudgeEnabled && (
          <div className="space-y-3 pt-1">
            <TimeRow
              icon={<Clock className="size-4 text-muted-foreground" />}
              label="Default class time"
              hour={prefs.crossfitClassTimeHour}
              minute={prefs.crossfitClassTimeMinute}
              onChange={(h, m) =>
                void persist({
                  ...prefs,
                  crossfitClassTimeHour: h,
                  crossfitClassTimeMinute: m,
                })
              }
            />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="size-4" />
                <span>Remind me this many hours after class</span>
              </div>
              <input
                type="number"
                min={1}
                max={23}
                value={prefs.crossfitLogByOffsetHours}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n) || n < 1 || n > 23) return;
                  void persist({ ...prefs, crossfitLogByOffsetHours: n });
                }}
                className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm tabular-nums"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Example: 6 AM class + 6 hours = noon deadline. The reminder only
              fires if today&apos;s WOD is still unlogged.
            </p>
          </div>
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

      {/* Arnold voice (opt-in) */}
      <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-medium">Arnold mode</h2>
            <p className="text-xs text-muted-foreground">
              For fun. Rewrites all notification text in a Schwarzenegger-flavored
              tone. Off by default.
            </p>
          </div>
          <Switch
            checked={prefs.arnoldVoice}
            onCheckedChange={(checked: boolean) =>
              void persist({ ...prefs, arnoldVoice: !!checked })
            }
          />
        </div>
      </section>

      {/* Diagnostic panel */}
      <DiagnosticPanel />

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

function DiagnosticPanel() {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<NotificationDiagnostic | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const d = await buildNotificationDiagnostic();
      setData(d);
    } catch (err) {
      console.warn("[diagnostic] failed", err);
      toast.error("Couldn't load diagnostic data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (expanded && !data) void refresh();
  }, [expanded, data]);

  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <div>
          <h2 className="text-base font-medium">
            Why isn&apos;t my CrossFit showing up?
          </h2>
          <p className="text-xs text-muted-foreground">
            Shows what the scheduler would send right now, without scheduling.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Last refreshed: {data?.fetchedAt
                ? new Date(data.fetchedAt).toLocaleTimeString("en-US")
                : "—"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>

          {data && (
            <div className="space-y-3 text-xs">
              <DiagRow
                label="Running in native iOS app"
                value={data.isNative ? "yes" : "no — only the web shell"}
                ok={data.isNative}
              />
              <DiagRow
                label="CrossFit WODs found for today"
                value={String(data.wodCount)}
                ok={data.wodCount > 0}
              />
              <DiagRow
                label="Unlogged WODs"
                value={String(data.unloggedWodCount)}
              />
              <DiagRow
                label="Class registrations for today"
                value={String(data.registrationCount)}
              />
              <DiagRow
                label="Include CrossFit in reminders?"
                value={data.prefs.includeCrossfit ? "yes" : "no — toggled off"}
                ok={data.prefs.includeCrossfit}
              />

              <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                <div className="font-medium">
                  Morning brief — {data.morningBrief.at}
                </div>
                <DiagRow
                  label="Would fire today"
                  value={data.morningBrief.wouldSchedule ? "yes" : "no"}
                  ok={data.morningBrief.wouldSchedule}
                />
                <div>
                  <div className="text-muted-foreground">Body</div>
                  <div className="text-foreground/90 italic">
                    {data.morningBrief.body ?? "(empty — nothing programmed)"}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                <div className="font-medium">
                  Midday nudge — {data.middayNudge.at}
                </div>
                <DiagRow
                  label="Would fire today"
                  value={data.middayNudge.wouldSchedule ? "yes" : "no"}
                  ok={data.middayNudge.wouldSchedule}
                />
                <div>
                  <div className="text-muted-foreground">Body</div>
                  <div className="text-foreground/90 italic">
                    {data.middayNudge.body || "(nothing to nudge about)"}
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
                <div className="font-medium">
                  CrossFit log nudge — {data.crossfitLogNudge.at}
                </div>
                <DiagRow
                  label="Would fire today"
                  value={data.crossfitLogNudge.wouldSchedule ? "yes" : "no"}
                  ok={data.crossfitLogNudge.wouldSchedule}
                />
                <DiagRow
                  label="Time source"
                  value={
                    data.crossfitLogNudge.source === "class-registration"
                      ? "today's registered class"
                      : data.crossfitLogNudge.source === "preference"
                      ? "your default class time"
                      : "n/a (disabled or nothing to nudge)"
                  }
                />
                <div>
                  <div className="text-muted-foreground">Body</div>
                  <div className="text-foreground/90 italic">
                    {data.crossfitLogNudge.body || "(disabled)"}
                  </div>
                </div>
              </div>

              <details className="rounded-md border border-border/60 bg-background/40 p-3">
                <summary className="cursor-pointer text-muted-foreground">
                  Raw fetch results
                </summary>
                <pre className="mt-2 overflow-x-auto text-[10px] leading-tight">
                  {JSON.stringify(
                    {
                      crossfit: data.state?.crossfit ?? null,
                      classes: data.state?.classes ?? null,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DiagRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok?: boolean;
}) {
  const color =
    ok === true
      ? "text-emerald-500"
      : ok === false
      ? "text-red-500"
      : "text-foreground/90";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function fmt(hour: number, minute: number): string {
  const period = hour >= 12 ? "pm" : "am";
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${String(minute).padStart(2, "0")} ${period}`;
}
