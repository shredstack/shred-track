import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HYROX Race Insights — ShredTrack",
  description:
    "Explore HYROX race data across divisions. See pace profiles, station distributions, and what separates top finishers — powered by thousands of real race results.",
};

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-mesh">
      {/* Minimal public header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <a href="/" className="font-oswald text-lg font-bold tracking-tight text-gradient-primary">
            ShredTrack
          </a>
          <nav className="flex items-center gap-3 text-xs">
            <a href="/insights/hyrox" className="text-primary font-medium">
              Insights
            </a>
            <a
              href="/login"
              className="rounded-lg bg-primary/15 px-3 py-1.5 font-medium text-primary hover:bg-primary/25 transition-colors"
            >
              Sign in
            </a>
          </nav>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 pb-12 pt-4">
        {children}
      </main>
      {/* Minimal footer */}
      <footer className="border-t border-white/[0.06] py-6 text-center text-[10px] text-muted-foreground">
        <div className="mx-auto max-w-lg px-4">
          <p>&copy; {new Date().getFullYear()} ShredTrack. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
