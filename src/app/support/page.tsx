import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle, Bug, Lightbulb } from "lucide-react";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with ShredTrack. Contact us with questions, bug reports, or feature requests.",
};

const SUPPORT_EMAIL = "shredstacksarah@gmail.com";

const topics = [
  {
    icon: Bug,
    title: "Report a bug",
    description:
      "Something not working? Send us a quick description of what you were trying to do, what happened, and your device (iPhone model + iOS version helps a lot).",
  },
  {
    icon: Lightbulb,
    title: "Request a feature",
    description:
      "Have an idea for a training tool, metric, or workflow you wish ShredTrack had? We want to hear it — every feature in the app started as a request like yours.",
  },
  {
    icon: MessageCircle,
    title: "Account help",
    description:
      "Password resets, login issues, deleting your account, exporting your data, or anything related to your profile.",
  },
];

export default function SupportPage() {
  return (
    <div className="flex min-h-screen flex-col bg-mesh">
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="font-oswald text-lg font-bold tracking-tight text-gradient-primary"
          >
            ShredTrack
          </Link>
          <nav className="flex items-center gap-3 text-xs">
            <Link
              href="/login"
              className="rounded-lg bg-primary/15 px-3 py-1.5 font-medium text-primary hover:bg-primary/25 transition-colors"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
          <span className="text-gradient-primary">Support</span>
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground leading-relaxed">
          We&rsquo;re a small team, and every message goes to a real person. Reach out with
          questions, bugs, or feature ideas — we read everything and usually reply within
          one business day.
        </p>

        <section className="mt-8 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-primary/15 p-3">
              <Mail className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-white">Email us</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The fastest way to get help is by email.
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Mail className="h-4 w-4" />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold text-white">What can we help with?</h2>
          <div className="mt-4 space-y-3">
            {topics.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/15 p-2">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          <h2 className="text-base font-semibold text-white">Response time</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            We typically respond within one business day (Monday&ndash;Friday).
            Urgent account or billing issues are prioritized.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold text-white">Helpful links</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              <span className="ml-2 text-muted-foreground">
                &mdash; what we collect and how we use it
              </span>
            </li>
            <li>
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
              <span className="ml-2 text-muted-foreground">
                &mdash; access your account
              </span>
            </li>
            <li>
              <Link href="/signup" className="text-primary hover:underline">
                Create an account
              </Link>
              <span className="ml-2 text-muted-foreground">
                &mdash; new to ShredTrack? Start here
              </span>
            </li>
          </ul>
        </section>

        <div className="mt-12 border-t border-white/[0.06] pt-6 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-primary transition-colors">
            &larr; Back to ShredTrack
          </Link>
        </div>
      </main>
    </div>
  );
}
