"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkoutSectionKind } from "@/db/schema";

const LABELS: Record<WorkoutSectionKind, string> = {
  warm_up: "Warm-up",
  pre_skill: "Pre-skill",
  wod: "WOD",
  post_skill: "Post-skill",
  stretching: "Stretching",
  at_home: "At-home",
  monthly_challenge: "Monthly challenge",
  custom: "Custom",
};

interface SectionForDisplay {
  id: string;
  kind: WorkoutSectionKind;
  position: number;
  title: string | null;
  body: string;
}

interface Props {
  gymName: string;
  gymLogoUrl: string | null;
  gymSlug: string;
  date: string;
  prevDayPath: string;
  nextDayPath: string;
  sections: SectionForDisplay[];
}

export function DisplayClient({
  gymName,
  gymLogoUrl,
  date,
  prevDayPath,
  nextDayPath,
  sections,
}: Props) {
  const router = useRouter();
  const [index, setIndex] = useState(0);

  const total = sections.length;

  const goNextSection = useCallback(() => {
    setIndex((i) => (total === 0 ? 0 : Math.min(total - 1, i + 1)));
  }, [total]);
  const goPrevSection = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNextSection();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrevSection();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        router.push(nextDayPath);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        router.push(prevDayPath);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goNextSection, goPrevSection, router, nextDayPath, prevDayPath]);

  if (total === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-12 text-center">
        <h1 className="text-4xl font-bold">{gymName}</h1>
        <p className="text-2xl text-muted-foreground">
          No published programming for {date}.
        </p>
        <p className="text-base text-muted-foreground/80">
          ← / → switch days · publish the week in /gym/programming
        </p>
      </div>
    );
  }

  const section = sections[index];
  const label = LABELS[section.kind];
  const headline = section.title?.trim() || label;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 p-8">
        <div className="flex items-center gap-3">
          {gymLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={gymLogoUrl}
              alt=""
              className="h-12 w-12 rounded-lg object-contain"
            />
          ) : null}
          <div>
            <div className="text-xl font-bold">{gymName}</div>
            <div className="text-sm text-muted-foreground">{date}</div>
          </div>
        </div>
        <Breadcrumb count={total} active={index} sections={sections} />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-12 py-12 text-center">
        <div className="text-2xl font-semibold uppercase tracking-[0.3em] text-primary">
          {label}
        </div>
        <h2 className="mt-6 max-w-6xl break-words text-[clamp(4rem,11vw,11rem)] font-extrabold leading-[1.05]">
          {headline}
        </h2>
      </main>

      <footer className="flex items-center justify-end gap-4 p-8 text-base text-muted-foreground">
        <span>← → sections · ↑ ↓ days</span>
      </footer>
    </div>
  );
}

function Breadcrumb({
  count,
  active,
  sections,
}: {
  count: number;
  active: number;
  sections: SectionForDisplay[];
}) {
  return (
    <ol className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground">
      {sections.map((s, i) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            className={
              "inline-block h-2 w-2 rounded-full " +
              (i === active ? "bg-primary" : "border border-muted-foreground/40")
            }
          />
          <span
            className={
              i === active ? "text-foreground" : "text-muted-foreground/70"
            }
          >
            {LABELS[s.kind]}
          </span>
        </li>
      ))}
      <li className="text-muted-foreground/60">
        {active + 1} / {count}
      </li>
    </ol>
  );
}
