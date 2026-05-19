"use client";

// Notification preferences page (spec §2.7). Grouped per the brainstorm:
// Reactions & Comments, Gym Activity, Achievements, Classes. Each row has
// In-App / Push columns. Defaults: all on. class_reservation_reminder is
// hidden (it ships in PR 3).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFeatureOn } from "@/hooks/useFeatureFlag";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface PrefValue {
  inAppEnabled: boolean;
  pushEnabled: boolean;
}
type Map = Record<string, PrefValue>;

interface KindMeta {
  kind: string;
  label: string;
  description?: string;
  // Default state when the user has never touched this kind. Most kinds
  // default ON; class_reservation_reminder defaults OFF per spec §3.4
  // (explicit opt-in to avoid fatigue).
  defaultOff?: boolean;
}

interface Group {
  title: string;
  flag?: string; // only render group if flag is on
  kinds: KindMeta[];
}

const GROUPS: Group[] = [
  {
    title: "Reactions & Comments",
    kinds: [
      { kind: "score_reaction", label: "Score reactions" },
      { kind: "score_comment", label: "Score comments" },
      { kind: "score_mention", label: "@mentions on scores" },
    ],
  },
  {
    title: "Gym Activity",
    flag: "social_feed",
    kinds: [
      {
        kind: "social_post_published",
        label: "New posts from your gym",
      },
      { kind: "social_post_reaction", label: "Reactions on your posts" },
      { kind: "social_post_comment", label: "Comments on your posts" },
      { kind: "social_post_mention", label: "@mentions in the feed" },
      { kind: "workout_published", label: "Today's WOD posted" },
    ],
  },
  {
    title: "Achievements",
    flag: "committed_club",
    kinds: [
      { kind: "committed_club_progress", label: "Committed Club progress" },
      { kind: "committed_club_earned", label: "Committed Club earned" },
      { kind: "committed_club_streak", label: "Streak milestones" },
    ],
  },
  {
    title: "Classes",
    flag: "classes",
    kinds: [
      { kind: "class_cancelled", label: "Class cancellations" },
      {
        kind: "class_reservation_reminder",
        label: "1-hour class reminder",
        description:
          "Push reminder ~60 minutes before a class you've registered for. Off by default.",
        defaultOff: true,
      },
    ],
  },
];

function valueOr(map: Map, meta: KindMeta): PrefValue {
  if (map[meta.kind]) return map[meta.kind];
  // No saved preference yet — fall back to per-kind default.
  return meta.defaultOff
    ? { inAppEnabled: false, pushEnabled: false }
    : { inAppEnabled: true, pushEnabled: true };
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ preferences: Map }>({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/me/notification-preferences");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });
  const save = useMutation({
    mutationFn: async (preferences: Map) => {
      const res = await fetch("/api/me/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-preferences"] });
    },
  });

  const social = useIsFeatureOn("social_feed");
  const committed = useIsFeatureOn("committed_club");
  const classesFlag = useIsFeatureOn("classes");
  const featureGate: Record<string, boolean> = {
    social_feed: social,
    committed_club: committed,
    classes: classesFlag,
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const prefs = data?.preferences ?? {};

  function update(meta: KindMeta, patch: Partial<PrefValue>) {
    const current = valueOr(prefs, meta);
    save.mutate({
      ...prefs,
      [meta.kind]: { ...current, ...patch },
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Notifications</h1>
      <p className="text-sm text-muted-foreground">
        Turn off any category you don&apos;t want as a push or in-app.
      </p>
      {GROUPS.map((g) => {
        if (g.flag && !featureGate[g.flag]) return null;
        return (
          <Card key={g.title}>
            <CardContent className="space-y-3 py-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {g.title}
              </p>
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs">
                <div />
                <div className="w-12 text-center">In-app</div>
                <div className="w-12 text-center">Push</div>
                {g.kinds.map((k) => {
                  const v = valueOr(prefs, k);
                  return (
                    <PrefRow
                      key={k.kind}
                      label={k.label}
                      description={k.description}
                      value={v}
                      onChange={(patch) => update(k, patch)}
                    />
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function PrefRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: PrefValue;
  onChange: (patch: Partial<PrefValue>) => void;
}) {
  return (
    <>
      <div className="text-sm">
        {label}
        {description ? (
          <p className="text-[11px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex justify-center">
        <Switch
          checked={value.inAppEnabled}
          onCheckedChange={(v) => onChange({ inAppEnabled: v })}
        />
      </div>
      <div className="flex justify-center">
        <Switch
          checked={value.pushEnabled}
          onCheckedChange={(v) => onChange({ pushEnabled: v })}
        />
      </div>
    </>
  );
}
