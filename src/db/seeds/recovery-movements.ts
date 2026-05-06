// Canonical recovery movements — covers the body regions referenced in the
// Athlecare playground (hip, shoulder, hamstring, lower back, ankle, thoracic).
//
// Idempotent: matches by (LOWER(canonical_name), created_by IS NULL) and
// updates in place. Safe to re-run.

import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, isNull, sql } from "drizzle-orm";
import { fileURLToPath } from "url";
import * as schema from "../schema";

interface Seed {
  canonicalName: string;
  category: "stretch" | "mobility" | "strength" | "breathwork" | "soft_tissue" | "other";
  bodyRegion: string[];
  description?: string;
  isPerSide?: boolean;
  defaultPrescription?: Record<string, unknown>;
}

const SEEDS: Seed[] = [
  // ---------- Hip ----------
  {
    canonicalName: "90/90 Hip Switch",
    category: "mobility",
    bodyRegion: ["hip"],
    description: "Sit with both legs in a 90/90 position. Switch sides slowly under control.",
    defaultPrescription: { sets: 3, reps: 10 },
  },
  {
    canonicalName: "Pigeon Pose",
    category: "stretch",
    bodyRegion: ["hip", "glute"],
    isPerSide: true,
    defaultPrescription: { sets: 2, durationSeconds: 45, perSide: true },
  },
  {
    canonicalName: "Couch Stretch",
    category: "stretch",
    bodyRegion: ["hip", "quad"],
    isPerSide: true,
    defaultPrescription: { sets: 2, durationSeconds: 45, perSide: true },
  },
  {
    canonicalName: "Cossack Squat",
    category: "mobility",
    bodyRegion: ["hip", "ankle"],
    isPerSide: true,
    defaultPrescription: { sets: 3, reps: 5, perSide: true },
  },
  {
    canonicalName: "Hip CARs",
    category: "mobility",
    bodyRegion: ["hip"],
    isPerSide: true,
    description: "Controlled articular rotations of the hip — slow, full ROM circles.",
    defaultPrescription: { sets: 2, reps: 5, perSide: true },
  },
  {
    canonicalName: "Frog Stretch",
    category: "stretch",
    bodyRegion: ["hip"],
    defaultPrescription: { sets: 2, durationSeconds: 45 },
  },
  // ---------- Shoulder ----------
  {
    canonicalName: "Shoulder CARs",
    category: "mobility",
    bodyRegion: ["shoulder"],
    isPerSide: true,
    defaultPrescription: { sets: 2, reps: 5, perSide: true },
  },
  {
    canonicalName: "Banded Shoulder Dislocates",
    category: "mobility",
    bodyRegion: ["shoulder", "thoracic"],
    defaultPrescription: { sets: 2, reps: 10 },
  },
  {
    canonicalName: "Wall Slides",
    category: "mobility",
    bodyRegion: ["shoulder", "thoracic"],
    defaultPrescription: { sets: 3, reps: 10 },
  },
  {
    canonicalName: "Sleeper Stretch",
    category: "stretch",
    bodyRegion: ["shoulder"],
    isPerSide: true,
    defaultPrescription: { sets: 2, durationSeconds: 30, perSide: true },
  },
  {
    canonicalName: "Cross-Body Shoulder Stretch",
    category: "stretch",
    bodyRegion: ["shoulder"],
    isPerSide: true,
    defaultPrescription: { sets: 2, durationSeconds: 30, perSide: true },
  },
  // ---------- Hamstring ----------
  {
    canonicalName: "Standing Forward Fold",
    category: "stretch",
    bodyRegion: ["hamstring", "lower_back"],
    defaultPrescription: { sets: 2, durationSeconds: 30 },
  },
  {
    canonicalName: "Single-Leg RDL Stretch",
    category: "stretch",
    bodyRegion: ["hamstring"],
    isPerSide: true,
    defaultPrescription: { sets: 2, reps: 8, perSide: true },
  },
  {
    canonicalName: "Hamstring Floss",
    category: "mobility",
    bodyRegion: ["hamstring"],
    isPerSide: true,
    defaultPrescription: { sets: 2, reps: 10, perSide: true },
  },
  // ---------- Lower back ----------
  {
    canonicalName: "Cat-Cow",
    category: "mobility",
    bodyRegion: ["lower_back", "thoracic"],
    defaultPrescription: { sets: 2, reps: 10 },
  },
  {
    canonicalName: "Childs Pose",
    category: "stretch",
    bodyRegion: ["lower_back"],
    defaultPrescription: { sets: 2, durationSeconds: 60 },
  },
  {
    canonicalName: "Supine Spinal Twist",
    category: "stretch",
    bodyRegion: ["lower_back"],
    isPerSide: true,
    defaultPrescription: { sets: 2, durationSeconds: 30, perSide: true },
  },
  {
    canonicalName: "Cobra Press",
    category: "mobility",
    bodyRegion: ["lower_back"],
    defaultPrescription: { sets: 2, reps: 8 },
  },
  // ---------- Ankle ----------
  {
    canonicalName: "Knee-to-Wall Ankle Stretch",
    category: "mobility",
    bodyRegion: ["ankle"],
    isPerSide: true,
    defaultPrescription: { sets: 3, reps: 10, perSide: true },
  },
  {
    canonicalName: "Ankle CARs",
    category: "mobility",
    bodyRegion: ["ankle"],
    isPerSide: true,
    defaultPrescription: { sets: 2, reps: 5, perSide: true },
  },
  {
    canonicalName: "Calf Stretch",
    category: "stretch",
    bodyRegion: ["calf", "ankle"],
    isPerSide: true,
    defaultPrescription: { sets: 2, durationSeconds: 30, perSide: true },
  },
  // ---------- Thoracic ----------
  {
    canonicalName: "Thread the Needle",
    category: "mobility",
    bodyRegion: ["thoracic"],
    isPerSide: true,
    defaultPrescription: { sets: 2, reps: 8, perSide: true },
  },
  {
    canonicalName: "Open Book",
    category: "mobility",
    bodyRegion: ["thoracic"],
    isPerSide: true,
    defaultPrescription: { sets: 2, reps: 8, perSide: true },
  },
  {
    canonicalName: "Foam Roll Thoracic Spine",
    category: "soft_tissue",
    bodyRegion: ["thoracic"],
    defaultPrescription: { durationSeconds: 60 },
  },
  // ---------- Glute / soft tissue ----------
  {
    canonicalName: "Lacrosse Ball Glute",
    category: "soft_tissue",
    bodyRegion: ["glute", "hip"],
    isPerSide: true,
    defaultPrescription: { durationSeconds: 60, perSide: true },
  },
  {
    canonicalName: "Foam Roll Quads",
    category: "soft_tissue",
    bodyRegion: ["quad"],
    defaultPrescription: { durationSeconds: 60 },
  },
  {
    canonicalName: "Foam Roll IT Band",
    category: "soft_tissue",
    bodyRegion: ["quad", "hip"],
    isPerSide: true,
    defaultPrescription: { durationSeconds: 45, perSide: true },
  },
  // ---------- Breathwork / core ----------
  {
    canonicalName: "Box Breathing 4-4-4-4",
    category: "breathwork",
    bodyRegion: ["full_body"],
    defaultPrescription: { sets: 1, durationSeconds: 240 },
  },
  {
    canonicalName: "Diaphragmatic Breathing",
    category: "breathwork",
    bodyRegion: ["core"],
    defaultPrescription: { sets: 1, durationSeconds: 180 },
  },
  {
    canonicalName: "Dead Bug",
    category: "strength",
    bodyRegion: ["core"],
    defaultPrescription: { sets: 3, reps: 10 },
  },
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const db = drizzle(client, { schema });

  try {
    let upserted = 0;
    await db.transaction(async (tx) => {
      for (const seed of SEEDS) {
        // Check if a system row with this canonical name exists.
        const [existing] = await tx
          .select({ id: schema.recoveryMovements.id })
          .from(schema.recoveryMovements)
          .where(
            and(
              sql`LOWER(${schema.recoveryMovements.canonicalName}) = LOWER(${seed.canonicalName})`,
              isNull(schema.recoveryMovements.createdBy)
            )
          )
          .limit(1);

        if (existing) {
          await tx
            .update(schema.recoveryMovements)
            .set({
              category: seed.category,
              bodyRegion: seed.bodyRegion,
              description: seed.description ?? null,
              defaultPrescription: seed.defaultPrescription ?? {},
              isPerSide: !!seed.isPerSide,
              isValidated: true,
              updatedAt: new Date(),
            })
            .where(eq(schema.recoveryMovements.id, existing.id));
        } else {
          await tx.insert(schema.recoveryMovements).values({
            canonicalName: seed.canonicalName,
            slug: slugify(seed.canonicalName),
            category: seed.category,
            bodyRegion: seed.bodyRegion,
            description: seed.description ?? null,
            defaultPrescription: seed.defaultPrescription ?? {},
            isPerSide: !!seed.isPerSide,
            isValidated: true,
            createdBy: null,
          });
        }
        upserted++;
      }
    });

    console.log(`recovery-movements — upserted ${upserted} canonical movements`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
}
