// ---------------------------------------------------------------------------
// Validation script — runs the renderer for all 40 variants, asserts
// structural invariants, and prints a sample session for manual review.
//
// Usage:
//   npx tsx src/lib/hyrox-generic-plans/validate.ts
//   npx tsx src/lib/hyrox-generic-plans/validate.ts women_singles_intermediate_open
// ---------------------------------------------------------------------------

import {
  allTemplateVariants,
  renderTemplate,
  tempoPaceForPhase,
  racePaceForPhase,
  easyPaceForPhase,
  stationTargetsFor,
  type Gender,
  type RaceFormat,
  type PaceTier,
  type WeightTier,
} from "./index";
import { STATION_ORDER } from "@/lib/hyrox-data";
import { formatMovementPrescription } from "@/lib/hyrox-data";

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function fmtPace(secPerKm: number, unit: "mi" | "km"): string {
  const sec = unit === "mi" ? Math.round(secPerKm * 1.609344) : secPerKm;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}/${unit}`;
}

function fmtSec(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function validateTemplate(t: ReturnType<typeof renderTemplate>) {
  // Shape
  if (t.phases.length !== 6) fail(`${t.templateKey}: expected 6 phases, got ${t.phases.length}`);
  if (t.sessions.length !== 18 * 7) fail(`${t.templateKey}: expected ${18 * 7} sessions, got ${t.sessions.length}`);

  // Every week has 7 sessions covering days 0..6
  for (let w = 1; w <= 18; w++) {
    const week = t.sessions.filter((s) => s.week === w);
    if (week.length !== 7) fail(`${t.templateKey} week ${w}: expected 7 sessions, got ${week.length}`);
    const days = new Set(week.map((s) => s.dayOfWeek));
    for (let d = 0; d <= 6; d++) {
      if (!days.has(d)) fail(`${t.templateKey} week ${w}: missing day ${d}`);
    }
  }

  // Each session's phase_number matches phaseForWeek
  for (const s of t.sessions) {
    const expectedPhase = t.phases.find((p) => s.week >= p.startWeek && s.week <= p.endWeek)?.phaseNumber;
    if (s.phaseNumber !== expectedPhase) {
      fail(`${t.templateKey} week ${s.week} day ${s.dayOfWeek}: phase mismatch (${s.phaseNumber} vs ${expectedPhase})`);
    }
  }

  // At least one session per week must have non-null paceSpec (unless it's race week 18)
  for (let w = 1; w <= 17; w++) {
    const week = t.sessions.filter((s) => s.week === w);
    const hasPace = week.some((s) => s.paceSpec !== null);
    if (!hasPace) fail(`${t.templateKey} week ${w}: no session has a paceSpec`);
  }
}

function printPaceReport(gender: Gender, format: RaceFormat, paceTier: PaceTier, weightTier: WeightTier) {
  console.log(`\n=== ${gender}/${format}/${paceTier}/${weightTier} ===`);
  console.log("Phase → Easy pace | Tempo pace | Race pace");
  for (let p = 1; p <= 6; p++) {
    const easy = easyPaceForPhase(paceTier, p);
    const tempo = tempoPaceForPhase(paceTier, p);
    const race = racePaceForPhase(paceTier, p);
    console.log(
      `  P${p}: ${fmtPace(easy, "mi")} (${fmtPace(easy, "km")}) | ${fmtPace(tempo, "mi")} (${fmtPace(tempo, "km")}) | ${fmtPace(race, "mi")} (${fmtPace(race, "km")})`,
    );
  }

  console.log("\nEnd-of-plan station targets:");
  const targets = stationTargetsFor(gender, format, paceTier, weightTier);
  for (const s of STATION_ORDER) {
    console.log(`  ${s.padEnd(22)} ${fmtSec(targets.seconds[s])}`);
  }
}

function printSampleSession(templateKeyWithWeight: string) {
  // Parse 'women_singles_intermediate_open' → {gender, format, paceTier, weightTier}
  const parts = templateKeyWithWeight.split("_");
  if (parts.length < 4) fail(`Expected format: '{gender}_{format}_{paceTier}_{weightTier}', got '${templateKeyWithWeight}'`);
  const gender = parts[0] as Gender;
  const format = parts[1] as RaceFormat;
  const paceTier = parts[2] as PaceTier;
  const weightTier = parts[3] as WeightTier;

  const t = renderTemplate({ gender, raceFormat: format, paceTier, weightTier });
  console.log(`\n=== Sample session: ${t.templateKey} (${weightTier}), Week 6 Saturday ===`);
  const sat = t.sessions.find((s) => s.week === 6 && s.dayOfWeek === 5);
  if (!sat) fail(`No Saturday session in week 6`);

  console.log(`Title: ${sat.title}`);
  console.log(`Description: ${sat.description}`);
  console.log(`Duration: ${sat.durationMinutes} min`);
  console.log(`Pace spec: ${JSON.stringify(sat.paceSpec)}`);
  console.log(`Equipment: ${sat.equipmentRequired.join(", ")}`);
  console.log(`\nBlocks (kg display):`);
  for (const block of sat.sessionDetail.blocks) {
    console.log(`  [${block.label}]`);
    for (const m of block.movements) {
      const kgDisplay = formatMovementPrescription(m, { paceUnit: "mi", weightUnit: "kg" });
      const lbDisplay = formatMovementPrescription(m, { paceUnit: "mi", weightUnit: "lb" });
      console.log(`    ${m.name}`);
      console.log(`      kg: ${kgDisplay}`);
      console.log(`      lb: ${lbDisplay}`);
      if (m.notes) console.log(`      note: ${m.notes}`);
    }
  }
}

function main() {
  const arg = process.argv[2];
  const variants = allTemplateVariants();
  console.log(`Validating ${variants.length} template variants…`);
  for (const v of variants) validateTemplate(v);
  console.log(`✓ Structural invariants pass for all ${variants.length} templates.`);
  console.log(`  Total sessions rendered: ${variants.reduce((a, v) => a + v.sessions.length, 0)}`);

  // Pace reports for each of the 4 tiers (Women Singles)
  for (const tier of ["beginner", "intermediate", "advanced", "elite"] as const) {
    printPaceReport("women", "singles", tier, "open");
  }

  // Sample session — default to Women Singles Intermediate Open if not given
  const target = arg ?? "women_singles_intermediate_open";
  printSampleSession(target);

  console.log(`\n✓ Validation complete.`);
}

main();
