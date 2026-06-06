# Building Complex Workouts

A guide for gym admins on how to program more advanced WODs using the Smart Builder. If you can already program a basic For Time or AMRAP, this picks up where that leaves off.

> Where to find it: **CrossFit tab → Add Workout → Smart Builder**.

---

## How the Smart Builder is laid out

The Smart Builder is two steps:

1. **Build** — choose the workout type, set the time cap / duration / rounds, add movements, and configure any structural options (side cadence, multi-part, vest, partner, etc.).
2. **Review** — title (auto-suggested), date, notes, and a final look at the prescription.

Every option in this guide lives in step 1.

---

## Pattern: Side cadence ("every minute on the minute do X")

**When to use:** the workout has a main task you grind through (e.g. "100 overhead squats for time") but every minute you have to stop and do something else. Sometimes called "Kalsu-style."

**Example — The Abyss:**

> For time:
> 100 overhead squats (95/135 lb)
> — Every 1:00 starting at :00, perform 15 double-unders.
> — No racks. The bar comes from the floor.

**How to build it:**

1. **Type:** For Time
2. **Time cap:** leave blank
3. Open the **"Side cadence (optional)"** disclosure:
   - Cadence interval: `1:00`
   - Leave "open-ended" unchecked
4. Add movements:
   - **Overhead Squat** — reps `100`, weight `135 / 95 lb`. This is the main task.
   - **Double-Under** — reps `15`, then toggle **"side cadence"** on this movement so it runs on the 1:00 cadence instead of contributing to the main task.
5. Notes (on the part): "No racks. The bar comes from the floor."

Side cadence is available on **For Time**, **AMRAP**, and **Intervals** parts. Check "Open-ended" if the cadence runs until the athlete fails rather than for a fixed duration.

---

## Pattern: Multi-part workouts (Part A / Part B / …)

**When to use:** the workout has distinct sections that score separately — e.g. a strength piece then a conditioning piece, or an EMOM warm-up followed by a For Time finisher.

**How to build it:**

1. In step 1, click **"Add part"** to add a second part. You can add up to **6 parts** per workout.
2. Each part has its own type, time cap, rounds, movements, and notes.
3. Drag the part header to reorder; click the X to remove.
4. Give each part a label ("A", "B", "Strength", "Conditioning"…) so athletes can see how it's split.

Scores are logged per part, so leaderboards and PRs are tracked separately for Part A vs Part B.

---

## Pattern: % of a 1RM logged earlier in the workout

**When to use:** a later part uses a weight that depends on what the athlete just lifted — e.g. "Part A: find a 1RM front squat. Part B: 5 rounds, 10 front squats at 60%."

**How to build it:**

1. Add a **For Load** part first (the "source" part) — that's where the athlete logs their max.
2. Add the second part below it.
3. On the second part's movement, switch the weight notation to **% of 1RM**, set the percentage (e.g. `60`), and pick the earlier For Load part as the source.

The athlete's logged max from the source part is automatically used as the basis. If they haven't logged that part yet at score time, they'll see the percentage and can compute manually.

---

## Pattern: Barbell complexes (one unbroken set)

**When to use:** the athlete performs a sequence of lifts back-to-back without dropping the bar, and the whole sequence counts as one set — e.g. "1 power clean + 1 hang squat clean + 1 jerk × 5 sets, find a heavy."

**How to build it:**

1. **Type:** For Load
2. **Structure:** Complex
3. **Sets:** enter the number of sets (e.g. `5`)
4. Add the movements in the order they're performed. Per-movement reps describe one rep of the complex (1 / 1 / 1 above).

Score is the heaviest set across all sets.

---

## Pattern: Tabata

**When to use:** 8 rounds of :20 work / :10 rest, scored by total reps.

**How to build it:**

1. **Type:** Tabata (or For Reps with Structure = Tabata)
2. Add the movement(s). If there are multiple, the athlete rotates through them across the 8 rounds (default Tabata interpretation).
3. The :20/:10 cadence is set automatically — no extra fields needed.

Score is total reps across all rounds and all movements.

---

## Pattern: Timed Rounds ("Every 4:00 × 5 rounds")

**When to use:** the athlete does the same round on a fixed cadence and the score isn't total time, it's something derived per-round — slowest round, fastest round, sum, or average.

**How to build it:**

1. **Type:** Timed Rounds
2. **Rounds:** e.g. `5`
3. **Round window (optional):** e.g. `4:00` — leave blank for sprint-repeat style with no cadence
4. **Score by:** Slowest / Fastest / Sum / Average. All four rank with lowest aggregate winning.
5. Add the movements that make up one round.

At score entry, the athlete enters one time per round; the aggregate is computed automatically.

---

## Pattern: Athlete-picked weight (and "Score by")

**When to use:** the prescription doesn't fix a weight — the athlete chooses based on their capability. E.g. "10 rounds, 5 thrusters (athlete's choice, heaviest unbroken)."

**How to build it:**

1. On a weighted movement, change **Weight source** from "Prescribed" to "Athlete."
2. The Rx weight inputs go away. At score time the athlete logs the weight they used per round.
3. On **For Reps**, **AMRAP**, and **Intervals** parts with at least one athlete-weight movement, a **"Score by"** toggle appears: rank by total **Reps** (heaviest weight shows as a chip) or by **Load** (the heaviest weight used is the ranking score).

---

## Pattern: Weighted vest (Murph-style)

**When to use:** the workout calls for a weighted vest. Three states:

- **None** — no vest in the prescription (default).
- **Optional** — vest is allowed; wearing it doesn't change division.
- **Required** — must wear the vest to log as Rx.

Set gendered vest weights (e.g. `20 / 14 lb`) under the toggle. The athlete's score row shows a "Wore vest" / "No vest" badge.

---

## Pattern: Partner / team workouts

**When to use:** the WOD is performed by two or more athletes splitting the work.

1. Turn on **Partner / team workout** at the workout level.
2. Set **Team size** (default 2).
3. On each part, pick a **Partner work mode**:
   - **Share as desired** (default) — partners split the work however they like.
   - **Alternating** — partners alternate rounds (one round each).
   - **Each athlete in turn** — each athlete works in isolation. Score entry surfaces one input per athlete and the totals are summed into the part's score.
   - **Synchro** — partners move in unison (same rep at the same time).

Modes are per-part — Part A can be "Each athlete in turn" while Part B is "Share as desired."

---

## Pattern: Rest between parts

**When to use:** the prescription dictates a fixed rest before moving on — "Rest 5:00 between parts."

1. On the part that comes *before* the rest, fill in **Rest after this part** (mm:ss, e.g. `5:00`).
2. A "Rest 5:00" pill renders between the two parts in the builder and on the workout card.
3. Leave the field blank when parts run back-to-back.

This is part-level (not workout-level), so you can have different rests after each part.

---

## Pattern: Intervals with no trailing rest

**When to use:** an Intervals part where the work-rest cadence shouldn't end with a rest — e.g. "2 rounds, 1:00 work / 2:00 rest, alternating athletes." Without suppressing, the second athlete's :60 would be followed by an awkward 2:00 of nothing.

On an **Intervals** part, check **"Skip rest after the final round"**. The cadence still applies between rounds, just not after the last one.

---

## Pattern: Per-round max reps / per-round duration

**When to use:** the score depends on per-round detail — "in the remaining time, max reps of X" or "as fast as possible, time per round."

- **Max reps** — toggle on a movement. The athlete logs reps per round at score time, and the totals roll up.
- **Per-round duration** — toggle on a duration-style movement (e.g. "Run 400m × 3 as fast as possible"). The athlete logs a time per round; the sum becomes the part's total time.

These two are mutually exclusive on the same movement.

---

## Pattern: Rep ladders & shared schemes ("21-15-9")

**When to use:** a classic descending or ascending rep scheme that applies to multiple movements (Fran's 21-15-9 thrusters + pull-ups).

1. On a For Time or AMRAP part, fill in **Rep scheme (applies to all movements)** with the scheme (`21-15-9`, `75-50-25`, etc.).
2. Every movement that hasn't been given its own reps inherits that scheme.
3. If you want a movement to break from the shared scheme, click "Override reps" on that movement.
4. For an *open-ended* ladder like `3-6-9-12…` keep going until failure, fill in the closed prefix (`3-6-9-12-15`) and check **"Continue as ladder?"**.

---

## A few things worth knowing

- **Titles auto-suggest.** When you move from Build → Review, the system tries to recognize the workout as a known benchmark (Fran, Murph…). If it can't, an AI suggests a 1-5 word title in Title Case. You can always override.
- **Custom movements.** If a movement isn't in the library, type the name in the search box and pick "Create custom movement" — it's added to your gym's library for next time.
- **Notes belong on the part.** Coaching cues like "no racks", "scale to single-unders if needed", or "warm up to a working weight first" go in the part's Notes field so they render with the WOD.
- **Description vs notes.** The workout-level description is what athletes see at the top; part notes show inline with the part.

---

## What's not yet supported

These are common patterns we don't have first-class UI for yet. If you need one of these, use a workaround (often the part's Notes field) and let us know — these are good signals for what to build next.

- **Side cadence with a custom start offset** (e.g. "starting at :30"). Side cadence always starts at the workout's T=0.
- **Cap-on-the-EMOM** patterns where each EMOM minute has its own time cap rather than a fixed prescribed amount.
- **Mid-workout division changes** (Rx for the first 3 rounds, scaled for the rest).
- **Buy-in / buy-out** as a separate concept from a multi-part workout. For now, model a buy-in as Part A and the main piece as Part B.

---

## Worked example: Steak and Pudding

A partner WOD that combines four of the patterns above — useful as a reference for how they compose.

**Prescription:**

> **In teams of 2:**
> 1:00 max-cal air bike, each athlete
> — Rest 2:00 between athletes.
> — Each athlete has one attempt to accumulate as many calories as possible in 1:00.
>
> **Rest 5:00**
>
> **AMRAP 10 with a partner:**
> Burpee box get-overs (48/48 in)
> — Share the work as desired.
> — Weight vest optional.

**Workout-level setup:**

- **Partner / team workout:** on, team size `2`.
- **Weighted vest:** Optional, e.g. `20 / 14 lb` (or your gym's standard).
- **Title:** type your own, or let the AI suggest one on the Review step.

**Part A — "Each athlete max calories in 1:00":**

- **Type:** Intervals
- **Rounds:** `2` (one round per athlete)
- **Work per round:** `1:00`
- **Rest per round:** `2:00`
- Check **"Skip rest after the final round"** so the part ends at the second athlete's :60.
- **Partner work mode:** Each athlete in turn
- **Movement:** Air Bike (calories)
- **Rest after this part:** `5:00`

At score entry, this part shows two inputs — "Athlete 1" and "Athlete 2" — both in calories. The total (sum) becomes the part's calorie score.

**Part B — "AMRAP 10, burpee box get-overs":**

- **Type:** AMRAP
- **Duration:** `10:00`
- **Partner work mode:** Share as desired
- **Movement:** Burpee Box Get-Over, height `48 / 48 in`

At score entry, this part records rounds + reps the team accumulated together, the standard AMRAP score.

**Why these choices:**

- Part A is **Intervals**, not For Calories, because Intervals natively expresses "2 work blocks with a 2:00 rest between." A For Calories part with a 1:00 cap wouldn't carry the "Rest 2:00 between athletes" detail in the prescription, so anyone reading the WOD would have to guess.
- **Skip trailing rest** is the only way to express "rest only between athletes, not after the last one" — otherwise the part runs 1:00 → 2:00 → 1:00 → 2:00 instead of 1:00 → 2:00 → 1:00.
- **Vest optional** (not Required) lets athletes log Rx whether or not they wore the vest.

---

## Questions or stuck?

Email shredstacksarah@gmail.com with a screenshot of what you're trying to program and we'll either show you how or add it to the roadmap.
