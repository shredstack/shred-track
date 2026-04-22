"use client";

import { Activity, BarChart3, Target, Timer, ChevronRight } from "lucide-react";

export function PublicLanding() {
  return (
    <div className="flex min-h-screen flex-col bg-mesh">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="font-oswald text-lg font-bold tracking-tight text-gradient-primary">
            ShredTrack
          </span>
          <nav className="flex items-center gap-3 text-xs">
            <a
              href="/login"
              className="rounded-lg bg-primary/15 px-3 py-1.5 font-medium text-primary hover:bg-primary/25 transition-colors"
            >
              Sign in
            </a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-16 pb-12 text-center">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          Train smarter.{" "}
          <span className="text-gradient-primary">Compete harder.</span>
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground leading-relaxed">
          Track workouts, follow personalized training plans, benchmark your performance,
          and see how you compare — whether you race HYROX, CrossFit, or both.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <a
            href="/signup"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Get started free
          </a>
        </div>
      </section>

      {/* Free HYROX Tools preview */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-12">
        <a
          href="/insights/hyrox/timer"
          className="group block rounded-xl gradient-border overflow-hidden"
        >
          <div className="bg-white/[0.02] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold">Free HYROX Tools</span>
              </div>
              <span className="flex items-center text-[10px] text-primary group-hover:gap-1.5 transition-all gap-1">
                Try now <ChevronRight className="h-3 w-3" />
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Practice race timer, field insights, and race data analysis — no
              account required. Time your practice race, explore pace profiles,
              and see what separates top finishers.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { label: "Race Timer", value: "FREE" },
                { label: "Field Insights", value: "FREE" },
                { label: "Divisions", value: "60+" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg bg-white/[0.03] p-2.5 text-center">
                  <div className="text-sm font-bold tabular-nums text-primary">
                    {stat.value}
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </a>
      </section>

      {/* Feature strip */}
      <section className="mx-auto w-full max-w-3xl px-4 pb-16">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Activity,
              title: "Track your workouts",
              description:
                "Log CrossFit WODs and HYROX training sessions with detailed scaling and RPE.",
            },
            {
              icon: BarChart3,
              title: "Follow a personalized plan",
              description:
                "AI-generated HYROX training plans built around your schedule and benchmarks.",
            },
            {
              icon: Target,
              title: "See how you stack up",
              description:
                "Get a projected finish time and see where you rank against the field.",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 mb-3">
                <feature.icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-sm font-bold">{feature.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-white/[0.06] py-6">
        <div className="mx-auto max-w-3xl px-4 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} ShredTrack</span>
          <div className="flex gap-4">
            <a href="/insights/hyrox/timer" className="hover:text-foreground transition-colors">
              HYROX Tools
            </a>
            <a href="mailto:shredstacksarah@gmail.com" className="hover:text-foreground transition-colors">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
