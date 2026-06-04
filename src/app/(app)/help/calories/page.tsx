import { BackButton } from "@/components/shared/back-button";

export const metadata = {
  title: "How calories are calculated · ShredTrack",
};

export default function CaloriesHelpPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 pb-24">
      <BackButton fallbackHref="/crossfit" />

      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">
          How calories are calculated
        </h1>
        <p className="text-sm text-muted-foreground">
          A plain-language tour of the model behind every calorie badge in
          ShredTrack. The estimate is defensible, not precise — treat the
          number as a ballpark, not a calorimeter reading.
        </p>
      </header>

      <Section title="The formula">
        <Formula>kcal ≈ MET × bodyweight (kg) × duration (hours)</Formula>
        <p>
          Three inputs do all the work. If any one is wrong, the calorie
          number scales linearly with it.
        </p>
      </Section>

      <Section title="MET — the intensity">
        <p>
          MET stands for <em>Metabolic Equivalent of Task</em>. 1 MET is the
          energy cost of sitting at rest; a movement’s MET says “this is N×
          harder than resting.” Values come from the 2024 Adult Compendium of
          Physical Activities — the same dataset Apple Health and most
          sports-medicine research draw from.
        </p>
        <Bullets>
          <li>Walking ≈ 3</li>
          <li>Heavy barbell lifts (squat, deadlift) ≈ 5–6</li>
          <li>Pull-ups, thrusters, wall balls ≈ 7–8</li>
          <li>Burpees, devil press, kettlebell swings ≈ 9–11</li>
          <li>Sprint-pace running and erg ≈ 15+</li>
        </Bullets>
      </Section>

      <Section title="Bodyweight">
        <p>
          Calories scale linearly with bodyweight — a 60 kg athlete burns about
          20% fewer calories than a 75 kg one for the identical session. The
          workout-card estimate shows a 75 kg reference; your personalized
          score uses your real bodyweight when it’s on your profile, otherwise
          a population default (which demotes the confidence badge).
        </p>
      </Section>

      <Section title="Duration">
        <p>
          We resolve duration in this order of preference, from tightest to
          loosest:
        </p>
        <Bullets ordered>
          <li>A live-logged start/end bracket</li>
          <li>Your logged time on a For Time workout</li>
          <li>The AMRAP / EMOM / Tabata window</li>
          <li>The time cap</li>
          <li>The sum of population rep-times (last resort)</li>
        </Bullets>
        <p>
          The earlier in this list we land, the tighter the estimate — logging
          your actual time is the single biggest accuracy lever on a For Time.
        </p>
      </Section>

      <Section title="Active vs gross calories">
        <p>
          The badge shows <strong>active</strong> calories — energy{" "}
          <em>above</em> what you’d burn at rest during the session. That’s
          the number we push to Apple Health, so the Move ring doesn’t
          double-count resting metabolism. Gross (active + the BMR baseline) is
          tracked internally for analytics.
        </p>
      </Section>

      <Section title="EPOC — the afterburn">
        <p>
          EPOC stands for <em>Excess Post-exercise Oxygen Consumption</em> — the
          calories your body keeps burning for the hours after a hard session.
          We model it as a flat multiplier on the active number (typically
          1.05–1.15). Toggle it in your profile, or your gym coach can set the
          default for the community.
        </p>
      </Section>

      <Section title="Per-movement adjustments">
        <p>
          A few modifiers nudge each movement’s contribution. All are clamped
          so no single factor can swing a movement’s MET more than ±20%:
        </p>
        <Bullets>
          <li>
            <strong>Load relative to your 1RM.</strong> A near-max set burns
            more per rep than a sub-max one. We derive your 1RM from your
            for-load history; new movements without history skip this.
          </li>
          <li>
            <strong>Vest.</strong> A weighted vest adds a small multiplier
            proportional to vest weight.
          </li>
          <li>
            <strong>RPE.</strong> Sessions logged at 9+ bump the estimate; 5 or
            below discount it. Only used as a fallback when no 1RM is on file.
          </li>
          <li>
            <strong>Unbroken complexes.</strong> A barbell complex performed
            without setting the bar down gets longer rep times and a higher
            working MET than the same lifts done as broken sets.
          </li>
          <li>
            <strong>Pace</strong> for runs and ergs. Calories scale with your
            actual sec/km (run) or sec/500m (row, ski) rather than a single
            MET value, because the energy swing between recovery and sprint
            paces is huge.
          </li>
        </Bullets>
      </Section>

      <Section title="Confidence">
        <p>Every estimate carries one of three confidence levels:</p>
        <Bullets>
          <li>
            <strong>High</strong> — solid data on every input.
          </li>
          <li>
            <strong>Medium</strong> — at least one input is estimated rather
            than measured (e.g. a movement without a Compendium-direct MET, or
            no logged rep-pace for you).
          </li>
          <li>
            <strong>Low</strong> — multiple defaults stacked, or no bodyweight
            on file. The badge says “low confidence” next to the number.
          </li>
        </Bullets>
      </Section>

      <Section title="Tightening your estimates">
        <p>If your badges read low confidence, the biggest wins are:</p>
        <Bullets ordered>
          <li>Add your bodyweight to your profile.</li>
          <li>Log actual times on For Time workouts, not just “capped.”</li>
          <li>Log RPE on heavy and gritty sessions.</li>
          <li>
            Test your 1RMs occasionally so the load-relative modifier has a
            recent number to compare against.
          </li>
        </Bullets>
      </Section>

      <Section title="Why it can still be off">
        <p>
          Even with perfect inputs, the MET model has ±15–20% real-world
          variance built in — the calorimeter studies it’s derived from show
          that spread. Your fitness, training state, environment (temperature,
          altitude), and how broken vs. unbroken you actually performed the
          workout all push the real number around. The badge’s low–high range
          reflects this; treat it as a defensible ballpark, not a precision
          number.
        </p>
      </Section>

      <p className="border-t border-border pt-4 text-xs text-muted-foreground">
        Notice an estimate that looks systematically off? Email{" "}
        <a className="underline" href="mailto:shredstacksarah@gmail.com">
          shredstacksarah@gmail.com
        </a>{" "}
        with the workout and a note on what felt wrong — that’s how the model
        gets tuned.
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="space-y-2 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

function Bullets({
  children,
  ordered,
}: {
  children: React.ReactNode;
  ordered?: boolean;
}) {
  const className = "ml-1 space-y-1 pl-4";
  return ordered ? (
    <ol className={`list-decimal ${className}`}>{children}</ol>
  ) : (
    <ul className={`list-disc ${className}`}>{children}</ul>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="font-mono text-sm text-foreground">{children}</p>
    </div>
  );
}
