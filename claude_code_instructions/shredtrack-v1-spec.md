# ShredTrack — HYROX + CrossFit Training App

**Technical Specification v1.1**
**Date:** April 6, 2026
**Status:** Draft — MVP

---

## 1. Product Overview

ShredTrack is a mobile-first training app for individual athletes who compete in HYROX and/or train CrossFit. It's built for athletes who want better tracking than their gym's default platform (PushPress, Wodify, etc.) provides.

**Target user**: An athlete at any CrossFit or functional fitness gym who wants:
1. **HYROX training**: Personalized, periodized HYROX training plans based on their current fitness and race date, with progress tracking and estimated finish time calculation.
2. **CrossFit WOD tracking**: Granular scaling detail (not just Rx/Scaled) that enables real progression tracking — know *exactly* which movements you scaled and watch yourself progress to Rx over time.

### 1.1 Go-to-Market: Athlete-First, Community-Optional

The v1 distribution model is **direct to athletes**, not gym SaaS:

- **Solo athlete (primary path)**: Any athlete downloads the app, creates an account, and starts logging workouts. They manually enter or paste/parse their gym's daily WOD. No gym affiliation required.
- **Community mode (secondary path)**: An athlete who wants to share workouts with friends can create a "community" (lightweight gym group). The creator becomes the admin and enters WODs once; community members see the WODs and log scores against them, with a shared leaderboard. This is how ShredTrack is used at CFD — Sarah enters the daily WOD, and invited athletes log their scores.

> **v2+ (future)**: Gym-level onboarding where a gym owner/manager creates the community, assigns coaches, and manages programming. This requires a B2B sales motion and is out of scope for MVP.

### 1.2 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Mobile | Capacitor (iOS + Android, Apple App Store submission) |
| UI | Tailwind CSS + shadcn/ui components |
| Database | PostgreSQL (Neon) via Drizzle ORM |
| Auth | NextAuth.js (magic link email + Apple Sign-In for App Store) |
| State | React Server Components + TanStack Query for client state |
| AI (v2) | Anthropic Claude API (plan generation, workout insights) |
| Hosting | Vercel (web) + Capacitor native builds |

### 1.3 MVP Scope

Both features ship in parallel with simplified versions:

- **HYROX**: Full onboarding flow → template-based plan generation → training log + dashboard
- **CrossFit**: Solo WOD entry (manual + smart text parser) → score logging with granular scaling → personal history/PRs. Community mode for shared WODs + leaderboard.
- **Auth**: Email magic link + Apple Sign-In. Simple invite codes for community membership.
- **AI**: Deferred to v2 (plan generation is template-based in MVP, but text parser uses heuristics for workout parsing)

---

## 2. HYROX Module

### 2.1 Onboarding Flow

A multi-step wizard that collects everything needed to generate a personalized training plan. The flow should feel polished and fast — progress bar at the top, one question per screen on mobile, with smart defaults and skip options.

#### Step 1: Profile Basics

- Name
- Gender (determines division weight/distance standards)
- Unit preference: Metric (kg/meters) or Imperial (lbs/miles) — persisted globally

#### Step 2: Race Details

- **Next race date** (date picker) — drives plan length calculation
- **Target division** (dropdown with full details):
  - Single: Women Open, Women Pro, Men Open, Men Pro
  - Doubles: Women Open, Women Pro, Men Open, Men Pro, Mixed
  - Relay: Women, Men, Mixed
- On selection, show the full station specs for that division (see §2.2 for data)
- If no race scheduled, allow "No race yet — just training"

#### Step 3: Running Assessment

Three pace inputs (mm:ss per mile or min/km based on unit preference):

| Pace | Description | Example Prompt |
|------|-------------|----------------|
| Easy | Conversational, could talk in full sentences | "What pace feels easy on a 30-min run?" |
| Moderate | Comfortably hard, short sentences only | "What pace could you hold for a 5K?" |
| Fast | Race effort, can't talk | "Your fastest sustained mile or 1km?" |

Smart validation: Easy must be slower than Moderate, Moderate slower than Fast.

#### Step 4: HYROX Experience

- **Have you done a HYROX before?** (Yes/No)
- If yes:
  - How many races?
  - Best finish time (HH:MM:SS)
  - Division raced
- If no: Brief explainer of what HYROX is (link to the Overview tab)

#### Step 5: Station Readiness Assessment

For each of the 8 stations (shown with the athlete's division-specific weight/distance/reps), two ratings:

**A) Completion Confidence (1–5 scale)**

*"Can you complete this station at the prescribed standard without stopping?"*

| Rating | Label | Meaning |
|--------|-------|---------|
| 1 | Major struggle | Would need to significantly modify or might not finish |
| 2 | Tough | Could finish but would be very difficult |
| 3 | Manageable | Can do it but it's challenging |
| 4 | Comfortable | Can complete it without much trouble |
| 5 | Easy | This station is a strength |

Stations shown with division-specific details:
- SkiErg: 1,000m
- Sled Push: 50m @ [division weight]
- Sled Pull: 50m @ [division weight]
- Burpee Broad Jumps: 80m
- Rowing: 1,000m
- Farmers Carry: 200m @ [division weight]
- Sandbag Lunges: 100m @ [division weight]
- Wall Balls: 100 reps @ [division weight/height]

**B) Current Speed vs. Goal Speed (dual slider)**

A range slider for each station:
- Left anchor: Pro athlete benchmark time (the "dream" time)
- Right anchor: Longest reasonable time (based on published HYROX percentile data)
- **Marker 1 (blue)**: "Where are you now?" — athlete drags to their estimated current time
- **Marker 2 (gold)**: "Where do you want to be?" — athlete drags to their goal time

Reference times per station (Women Open division example):

| Station | Pro Benchmark | Average Open | Slow/Struggling |
|---------|--------------|--------------|-----------------|
| SkiErg 1000m | 3:15 | 5:00 | 7:00+ |
| Sled Push 50m | 1:00 | 2:30 | 5:00+ |
| Sled Pull 50m | 1:00 | 2:30 | 5:00+ |
| Burpee Broad Jumps 80m | 2:00 | 3:30 | 6:00+ |
| Rowing 1000m | 3:30 | 4:30 | 6:00+ |
| Farmers Carry 200m | 1:15 | 2:00 | 3:30+ |
| Sandbag Lunges 100m | 2:00 | 3:30 | 6:00+ |
| Wall Balls 100 reps | 2:30 | 4:00 | 7:00+ |

> **Data note**: Reference times should be stored in a config table per division/gender so they can be updated. V2 will source these from actual HYROX results data.

#### Step 6: Summary & Plan Preview

Show the athlete:
- Their estimated current finish time (sum of: 8 × current run pace for 1km + current station time estimates + ~2:30 transitions)
- Their goal finish time (same calc with goal paces/times)
- Recommended plan duration based on gap and race date
- "Generate My Plan" CTA

### 2.2 HYROX Division Data

Complete station specifications from the official HYROX competition overview. Stored as a seed/config table.

```
DIVISIONS:

SINGLE
  Women Open:  SkiErg 1000m | Sled Push 50m @ 102kg* | Sled Pull 50m @ 78kg*  | BBJ 80m | Row 1000m | Farmers Carry 200m @ 2×16kg | Sandbag Lunges 100m @ 10kg | Wall Balls 100 reps @ 4kg
  Women Pro:   SkiErg 1000m | Sled Push 50m @ 152kg* | Sled Pull 50m @ 103kg* | BBJ 80m | Row 1000m | Farmers Carry 200m @ 2×24kg | Sandbag Lunges 100m @ 20kg | Wall Balls 100 reps @ 6kg
  Men Open:    SkiErg 1000m | Sled Push 50m @ 152kg* | Sled Pull 50m @ 103kg* | BBJ 80m | Row 1000m | Farmers Carry 200m @ 2×24kg | Sandbag Lunges 100m @ 20kg | Wall Balls 100 reps @ 6kg
  Men Pro:     SkiErg 1000m | Sled Push 50m @ 202kg* | Sled Pull 50m @ 153kg* | BBJ 80m | Row 1000m | Farmers Carry 200m @ 2×32kg | Sandbag Lunges 100m @ 30kg | Wall Balls 100 reps @ 9kg

DOUBLES
  Women Open:  (same as Single Women Open)
  Women Pro:   (same as Single Women Pro)
  Men Open:    (same as Single Men Open)
  Men Pro:     (same as Single Men Pro)
  Mixed:       SkiErg 1000m | Sled Push 50m @ 152kg* | Sled Pull 50m @ 103kg* | BBJ 80m | Row 1000m | Farmers Carry 200m @ 2×24kg | Sandbag Lunges 100m @ 20kg | Wall Balls 100 reps @ 6kg

RELAY
  Women:       SkiErg 1000m | Sled Push 50m @ 102kg* | Sled Pull 50m @ 78kg*  | BBJ 80m | Row 1000m | Farmers Carry 200m @ 2×16kg | Sandbag Lunges 100m @ 10kg | Wall Balls 100 reps @ 4kg
  Men:         SkiErg 1000m | Sled Push 50m @ 152kg* | Sled Pull 50m @ 103kg* | BBJ 80m | Row 1000m | Farmers Carry 200m @ 2×24kg | Sandbag Lunges 100m @ 20kg | Wall Balls 100 reps @ 6kg
  Mixed:       SkiErg 1000m | Sled Push 50m @ 102kg*/152kg** | Sled Pull 50m @ 78kg*/103kg** | BBJ 80m | Row 1000m | FC 200m @ 2×16kg/2×24kg** | SBL 100m @ 10kg/20kg** | WB 100 reps @ 4kg/6kg**

* Total weight including sled
** Weights organized by respective performing gender
```

### 2.3 HYROX Overview Tab

A standalone reference tab (accessible from onboarding and main nav) displaying:

- Full division table (matching the uploaded screenshot layout)
- **Unit toggle**: kg/meters ↔ lbs/miles (conversion applied to all weights and distances)
- Tap any division row to see detailed station breakdown
- Race format explainer: 8 runs × 1km + 8 stations, always in fixed order
- Station order diagram (visual)

Conversions for the toggle:
- kg → lbs: multiply by 2.205
- meters → feet for carry/lunge: multiply by 3.281 (display as yards for distances > 50m)
- Keep SkiErg/Row in meters (standard machine units) but note mile equivalence

### 2.4 Training Plan Generation (MVP — Template-Based)

The MVP plan engine adapts the proven 12-week foundation plan structure based on the athlete's inputs.

#### Plan Length Calculation

```
weeks_until_race = (race_date - today) / 7

if weeks_until_race >= 20:
  plan = 12-week foundation + 8-week race prep (start foundation immediately, hold race prep)
elif weeks_until_race >= 12:
  plan = compressed foundation (weeks_until_race - 8 weeks) + 8-week race prep
elif weeks_until_race >= 8:
  plan = 8-week race prep only
elif weeks_until_race >= 4:
  plan = 4-week abbreviated prep
else:
  plan = maintenance mode (just station practice + easy running)
```

#### Pace Scaling

The template plan has fixed progression targets. The engine scales all paces relative to the athlete's assessed paces:

```
// Example: Template assumes easy pace starts at 9:00/mile
// Athlete's easy pace is 10:30/mile
// Scale factor = athlete_easy / template_easy = 10:30 / 9:00 = 1.167

// All template paces get multiplied by this factor
athlete_week1_easy = template_week1_easy × scale_factor
athlete_week1_tempo = template_week1_tempo × scale_factor
athlete_week1_interval = template_week1_interval × scale_factor

// Progression percentages stay the same
// Week 1 easy: 10:30 → Week 12 easy: ~9:00 (same % improvement)
```

#### Station Finisher Scaling

Based on the completion confidence rating:

| Rating | Finisher Approach |
|--------|------------------|
| 1–2 | Modified station work (reduced weight/distance/reps). Focus on completion. |
| 3 | Standard template finishers |
| 4–5 | Accelerated progression, add volume earlier |

#### Plan Structure (per week)

Each week contains:
- 3 run sessions (Easy, Tempo, Intervals) — mapped to athlete's schedule
- 2 post-workout station finishers (Monday/Wednesday pattern from template)
- 1 HYROX-specific class/simulation (Saturday)
- Progression notes and technique cues
- Weekly checkpoint goals

### 2.5 Training Plan UI

#### Calendar/Week View

- Default: week view showing 7 days with planned sessions
- Each session card shows: type icon, title, key targets (pace/reps/time), completion status
- Tap a session → session detail screen
- Swipe between weeks; jump-to-week dropdown
- Color coding: upcoming (neutral), completed (green), skipped (gray), missed/overdue (amber)

#### Session Detail Screen

- Full session description with targets
- Technique cues (expandable)
- **Log button** → opens score entry:
  - Run sessions: actual pace (mm:ss/mile or /km), distance, RPE (1-10), notes
  - Station finishers: time, reps achieved, weight used, RPE, notes
  - HYROX class: per-station times (optional), overall notes
- After logging, show comparison to target: ahead/behind/on-track indicator

#### Dashboard Tab

- **Estimated Race Finish Time** — big number at top, updates as benchmarks are logged
  - Breakdown: total run time + total station time + transitions
  - Compare to goal time (from onboarding)
- **Station Progress Cards** (one per station):
  - Current best time
  - Trend arrow (improving/flat/declining)
  - Mini sparkline chart of logged times
  - Completion confidence (updated from logs)
- **Run Pace Trend**:
  - Easy/Tempo/Interval pace trend lines
  - Current vs. target overlay
- **Plan Adherence**: % of planned sessions completed this week / overall

### 2.6 HYROX Race Day Mode (v2 — out of scope for MVP)

Pre-load race splits, live tracking during race, post-race analysis.

---

## 3. CrossFit WOD Tracker Module

### 3.1 Core Concepts

#### Workout Types & Scoring

The app must handle all standard CrossFit scoring formats. Each workout type determines what score inputs are shown.

| Workout Type | Score Format | Input UI |
|-------------|-------------|----------|
| For Time | MM:SS or HH:MM:SS | Time picker. Optional: "Hit time cap" toggle → switches to total reps input |
| AMRAP | Rounds + Reps | Two number inputs: rounds, extra reps |
| For Load | Weight (lbs/kg) | Weight input. Optional: rep scheme entry (e.g., 5-3-1) for per-set logging |
| For Reps | Total reps | Number input |
| For Calories | Total calories | Number input |
| EMOM | Complete / Reps per round | Toggle: completed as prescribed, or per-round reps |
| Tabata | Score per round or total | Flexible: total reps or lowest-round score |
| Max Effort | Distance, Cals, or Reps | Number + unit selector |
| For Time (Team) | MM:SS | Time picker (same as For Time) |
| Other / Custom | Free text | Text input |

#### Movements

A canonical movement library shared across all gyms:

- Maintained as a seed table + user-contributed additions (admin-approved)
- Each movement has: canonical name, category (barbell, dumbbell, kettlebell, gymnastics, bodyweight, monostructural, accessory), is_weighted flag, common Rx weights by gender
- Movement name normalization: singular form, qualified variants ("Power Clean" not just "Clean")

#### Scaling Model (Key Differentiator)

Instead of binary Rx/Scaled, each athlete's score includes per-movement scaling detail:

```
Score {
  workout_id
  athlete_id
  overall_division: "Rx" | "Scaled" | "Rx+"   // high-level tag
  completion_time / rounds_reps / weight / etc. // based on workout type
  movement_scores: [
    {
      movement_id: "thruster"
      prescribed_weight: 95        // what Rx calls for (female)
      actual_weight: 75            // what the athlete used
      prescribed_reps: 21-15-9     // Rx rep scheme
      actual_reps: 21-15-9         // same (didn't scale reps)
      modification: null           // or "banded", "jumping", "ring rows instead", etc.
      notes: "went unbroken on 21s"
    },
    {
      movement_id: "pull-up"
      prescribed_weight: null
      actual_weight: null
      prescribed_reps: 21-15-9
      actual_reps: 21-15-9
      modification: "banded (green)"  // THIS is the scaling detail
      notes: null
    }
  ]
}
```

This enables tracking like: "You've done Fran 4 times. First 3 were with banded pull-ups, last time you went Rx. Your time went from 8:42 scaled → 12:15 Rx."

### 3.2 User Model & Community Structure (MVP)

#### Athlete-First: Two Modes of Operation

Every user starts as a **solo athlete**. Community membership is optional.

**Mode 1: Solo Athlete (no community)**

The athlete is self-sufficient:
- Creates their own workouts via manual entry or smart text parser (see §3.3)
- Logs scores against their own workouts
- Full access to personal history, movement progress, and PRs
- No leaderboard (just personal tracking)

**Mode 2: Community Member**

An athlete joins a community to get shared WODs and leaderboards:
- Sees workouts posted by the community admin
- Logs scores against community WODs (shared leaderboard)
- Can still create personal workouts outside the community
- Community scores and personal scores coexist in their history

#### Community Structure (MVP)

- Any athlete can create a community (becomes "admin")
- Admin generates a **join code** (6-character alphanumeric, regeneratable)
- Athletes join by entering the code
- An athlete can belong to multiple communities

**Roles (MVP — intentionally simple):**

| Role | Permissions |
|------|------------|
| Admin | Create/edit community WODs, manage join code, view all member scores |
| Member | View community WODs, log own scores, view leaderboard |

> **v2**: Coach role, gym-level onboarding, multiple admins, programming calendar, gym branding, analytics dashboard.

#### Data Ownership

- **Workouts created by a solo athlete**: owned by the athlete, visible only to them
- **Workouts created by a community admin**: owned by the community, visible to all members
- **Scores**: always owned by the athlete. If an athlete leaves a community, their scores stay in their personal history but are removed from the community leaderboard.

### 3.3 WOD Entry Flows

There are two paths to create a workout. Both produce the same structured data (workout type + movements + prescribed weights/reps).

#### Path A: Manual Entry (Admin + Solo Athletes)

The structured builder for precise workout definition. This is what community admins use (and any athlete who prefers building workouts step-by-step).

**Step 1: Select Workout Type**

Dropdown with the standard types (For Time, AMRAP, For Load, etc.). Selection dynamically configures the rest of the form.

**Step 2: Configure Workout Details**

Based on type selection:

- **For Time**: Time cap input (optional), movement list
- **AMRAP**: Duration (minutes), movement list
- **For Load**: Rep scheme input (e.g., "5-5-5-5-5" or "5-3-1"), movement list
- **EMOM**: Interval duration, total rounds, movement list per interval
- Etc.

**Step 3: Add Movements**

For each movement in the workout:

1. **Movement search/select**: Typeahead search against the canonical movement library
   - If not found: "Add new movement" flow (name, category, weighted?)
2. **Reps**: Number or scheme (e.g., "21-15-9" parsed into rounds)
3. **Rx Weight** (if weighted): lbs or kg input — shows both genders' Rx weights
4. **Rx Standard** (if applicable): e.g., "chest-to-bar" for pull-ups, "24-inch box" for box jumps
5. **Order**: drag-to-reorder

**Step 4: Additional Details**

- Workout title (optional — auto-generates from movements if blank)
- Description / coach notes (rich text)
- Workout date (defaults to today)
- For community admins: Publish to community toggle

**Step 5: Preview & Save**

Shows the workout as it will appear. For community admins, publishing pushes to all members.

#### Path B: Smart Text Parser (Solo Athletes — Primary Entry Method)

This is the killer UX for athletes who train at a gym that posts WODs in an app, whiteboard, or social media. The athlete copies the workout text and pastes it.

**Flow:**

1. Tap "Add Workout" → "Paste Workout" tab
2. Large text input with placeholder: *"Paste your gym's workout here..."*
3. Athlete pastes raw workout text, e.g.:

```
For Time (18 min cap)
21-15-9
Thrusters (95/65)
Pull-ups
```

4. **Parser runs** and displays structured interpretation:
   - Detected type: For Time
   - Time cap: 18:00
   - Movements:
     - Thruster: 21-15-9 reps @ 95 lbs (male) / 65 lbs (female)
     - Pull-Up: 21-15-9 reps (bodyweight)
5. Athlete reviews, can edit any field, then saves

**Parser Design:**

The parser leverages the same heuristic engine from ShredStack's `crossfit-score-parser.ts` and `crossfit-analysis.ts`, adapted for input text rather than score interpretation:

- **Workout type detection**: Regex/keyword matching for "for time", "amrap", "emom", "for load", "tabata", etc.
- **Time cap extraction**: Patterns like "(18 min cap)", "TC: 15", "Time Cap: 12 minutes"
- **Rep scheme parsing**: "21-15-9", "5 rounds of", "5-5-5-5-5", "3-2-2-1-1-1"
- **Movement extraction**: Match against the canonical movement library (fuzzy matching for abbreviations like "T2B" → "Toes-to-Bar", "DU" → "Double-Under", "HSPU" → "Handstand Push-Up")
- **Weight parsing**: "(95/65)", "(135/95 lb)", "(24/20 kg)", "(53/35 KB)"
- **Standard parsing**: "(chest-to-bar)", "(24/20 in box)"

**Edge cases the parser should handle:**

- Multi-part workouts: "Part A: For Load... Part B: For Time..."
- EMOM structures: "Every 2:00 for 10 rounds"
- Complex formats: "Ascending ladder 2-4-6-8-10..."
- Abbreviated movement names common in CrossFit
- Weight notation with and without units

**When the parser is unsure:**

- Highlight uncertain fields in amber
- Show the raw text alongside the structured interpretation
- Let the athlete confirm or correct

> **v2 (AI parsing)**: Replace the heuristic parser with a Claude API call that handles arbitrarily complex workout text, including non-standard formatting, multiple languages, and coach shorthand. The structured output schema stays the same — the AI just does a better job of filling it.

### 3.4 Score Logging Flow (Athlete)

This is the most important UX in the app. It needs to be fast for the common case (everything Rx, just enter a time) but allow detailed scaling capture when needed.

#### Quick Path (Rx)

1. Tap "Log Score" on today's WOD
2. Score input appears (type-appropriate: time picker, rounds+reps, etc.)
3. Default: all movements marked Rx
4. Tap "Submit" → done

**Total taps for an Rx score: 3** (Log Score → enter score → Submit)

#### Detailed Path (Scaled)

1. Tap "Log Score" on today's WOD
2. Enter score
3. Toggle "I scaled something" (or the app auto-suggests if score significantly differs from typical Rx range)
4. **Movement-by-movement scaling UI appears**:
   - Each movement shown as a card
   - Default state: green checkmark (Rx)
   - Tap a movement to expand scaling options:
     - **Weight**: slider or number input showing Rx weight → what you actually used
     - **Reps**: modified rep scheme if different
     - **Modification**: searchable dropdown of common mods (banded, jumping, ring rows, etc.) + free text
     - **Substitution**: replaced with different movement entirely (e.g., "ring rows instead of pull-ups")
5. Tap "Submit"

#### Score Entry UI by Workout Type

**For Time:**
```
┌─────────────────────────────┐
│  Your Time                  │
│  ┌──┐ : ┌──┐               │
│  │12│   │45│               │
│  └──┘   └──┘               │
│                             │
│  ☐ Hit the time cap         │
│    → switches to:           │
│    Total Reps: [___]        │
│                             │
│  ☐ I scaled something       │
└─────────────────────────────┘
```

**AMRAP:**
```
┌─────────────────────────────┐
│  Rounds    Extra Reps       │
│  ┌──┐      ┌──┐            │
│  │ 8│      │12│            │
│  └──┘      └──┘            │
│                             │
│  Movement breakdown:        │
│  Round of: 10 T2B + 15 WB  │
│  → 8 full + 12 into WBs    │
│                             │
│  ☐ I scaled something       │
└─────────────────────────────┘
```

**For Load:**
```
┌─────────────────────────────┐
│  Rep Scheme: 5 - 3 - 1      │
│                              │
│  Set 1 (5 reps): [135] lbs  │
│  Set 2 (3 reps): [155] lbs  │
│  Set 3 (1 rep):  [175] lbs  │
│                              │
│  → Max: 175 lbs             │
│  → e1RM: 175 lbs            │
│                              │
│  ☐ I scaled something        │
└─────────────────────────────┘
```

### 3.5 Leaderboard

Per-workout leaderboard visible to all community members (only shown for community workouts):

- Default sort: best score (fastest time / most rounds / heaviest weight)
- Filter by: Rx only, Scaled only, All
- Each entry shows: athlete name, score, division badge (Rx/Scaled), and a scaling detail indicator (icon showing how many movements were modified)
- Tap an entry → see that athlete's full scaling breakdown
- Solo athletes see their own history for that workout instead of a leaderboard

### 3.6 Athlete History & Stats

#### Workout History

- Reverse-chronological list of all logged workouts
- Filter by: gym, workout type, date range, movement
- Each entry: date, workout title, score, Rx/Scaled badge

#### Movement Progress

- Select any movement → see all historical data points
- For weighted movements: weight trend chart, estimated 1RM progression
- For bodyweight/skill movements: modification progression ("banded → Rx" journey)
- For monostructural (run, row, ski): pace/split trend

#### Personal Records Board

- Auto-tracked PRs per movement per scoring type
- Lifetime PRs + recent PRs (last 90 days)
- PR notification when a new one is set

---

## 4. Data Model

### 4.1 Core Tables

#### Users & Auth

```sql
users
  id              UUID PRIMARY KEY
  email           TEXT UNIQUE NOT NULL
  name            TEXT NOT NULL
  gender          TEXT                    -- 'male' | 'female' | 'other' | null
  unit_preference TEXT DEFAULT 'imperial' -- 'imperial' | 'metric'
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
```

#### Communities (formerly "Gyms")

```sql
communities
  id              UUID PRIMARY KEY
  name            TEXT NOT NULL
  join_code       TEXT UNIQUE NOT NULL    -- 6-char alphanumeric
  created_by      UUID FK → users.id
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ

community_memberships
  id              UUID PRIMARY KEY
  community_id    UUID FK → communities.id
  user_id         UUID FK → users.id
  role            TEXT NOT NULL           -- 'admin' | 'member'
  joined_at       TIMESTAMPTZ
  UNIQUE(community_id, user_id)
```

### 4.2 CrossFit Tables

#### Movements

```sql
movements
  id              UUID PRIMARY KEY
  canonical_name  TEXT UNIQUE NOT NULL    -- "Power Clean", "Pull-Up", etc.
  category        TEXT NOT NULL           -- barbell | dumbbell | kettlebell | gymnastics | bodyweight | monostructural | accessory | other
  is_weighted     BOOLEAN DEFAULT false
  is_1rm_applicable BOOLEAN DEFAULT false
  common_rx_weight_male    NUMERIC       -- most common Rx weight (lbs)
  common_rx_weight_female  NUMERIC
  created_at      TIMESTAMPTZ
```

#### Workouts (WODs)

```sql
workouts
  id              UUID PRIMARY KEY
  created_by      UUID FK → users.id NOT NULL
  community_id    UUID FK → communities.id  -- NULL = personal workout (solo athlete)
  title           TEXT                    -- nullable, auto-generated if blank
  description     TEXT                    -- full workout description (rich text)
  raw_text        TEXT                    -- original pasted text (if created via parser)
  workout_type    TEXT NOT NULL           -- for_time | amrap | for_load | for_reps | for_calories | emom | tabata | max_effort | other
  time_cap_seconds INTEGER               -- null if no cap
  amrap_duration_seconds INTEGER          -- null if not AMRAP
  rep_scheme      TEXT                    -- e.g., "5-3-1" for loading workouts
  workout_date    DATE NOT NULL
  published       BOOLEAN DEFAULT false   -- for community workouts: visible to members?
  source          TEXT DEFAULT 'manual'   -- 'manual' | 'parsed' | 'import'
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ

workout_movements
  id              UUID PRIMARY KEY
  workout_id      UUID FK → workouts.id
  movement_id     UUID FK → movements.id
  order_index     INTEGER NOT NULL
  prescribed_reps TEXT                    -- "21-15-9" or "10" or null
  prescribed_weight_male   NUMERIC       -- Rx weight in lbs
  prescribed_weight_female NUMERIC
  rx_standard     TEXT                    -- "chest-to-bar", "24-inch box", etc.
  notes           TEXT                    -- coach notes for this movement
```

#### Scores

```sql
scores
  id              UUID PRIMARY KEY
  workout_id      UUID FK → workouts.id
  user_id         UUID FK → users.id
  division        TEXT NOT NULL           -- 'rx' | 'scaled' | 'rx_plus'

  -- Score value (one of these is populated based on workout_type)
  time_seconds    INTEGER                 -- for_time
  rounds          INTEGER                 -- amrap
  remainder_reps  INTEGER                 -- amrap (extra reps)
  weight_lbs      NUMERIC                 -- for_load
  total_reps      INTEGER                 -- for_reps, for_calories, time-capped
  score_text      TEXT                    -- free-form for 'other' type
  hit_time_cap    BOOLEAN DEFAULT false   -- for_time: did they cap out?

  notes           TEXT                    -- personal notes
  rpe             INTEGER                 -- 1-10 rate of perceived exertion
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
  UNIQUE(workout_id, user_id)            -- one score per athlete per workout

score_movement_details
  id              UUID PRIMARY KEY
  score_id        UUID FK → scores.id
  workout_movement_id UUID FK → workout_movements.id
  was_rx          BOOLEAN DEFAULT true
  actual_weight   NUMERIC                 -- null if same as prescribed or not weighted
  actual_reps     TEXT                    -- null if same as prescribed
  modification    TEXT                    -- "banded (green)", "jumping", etc.
  substitution_movement_id UUID FK → movements.id  -- if replaced with diff movement
  set_weights     JSONB                   -- for_load: per-set weights [135, 155, 175]
  notes           TEXT
```

### 4.3 HYROX Tables

#### Athlete HYROX Profile

```sql
hyrox_profiles
  id              UUID PRIMARY KEY
  user_id         UUID FK → users.id UNIQUE
  target_division TEXT NOT NULL           -- e.g., 'single_women_open'
  next_race_date  DATE
  easy_pace_seconds_per_unit  INTEGER     -- seconds per mile or km
  moderate_pace_seconds_per_unit INTEGER
  fast_pace_seconds_per_unit INTEGER
  pace_unit       TEXT DEFAULT 'mile'     -- 'mile' | 'km'
  previous_race_count INTEGER DEFAULT 0
  best_finish_time_seconds INTEGER        -- null if never raced
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ

hyrox_station_assessments
  id              UUID PRIMARY KEY
  profile_id      UUID FK → hyrox_profiles.id
  station         TEXT NOT NULL           -- 'skierg' | 'sled_push' | 'sled_pull' | 'burpee_broad_jump' | 'rowing' | 'farmers_carry' | 'sandbag_lunges' | 'wall_balls'
  completion_confidence INTEGER NOT NULL  -- 1-5
  current_time_seconds INTEGER            -- athlete's estimated current time
  goal_time_seconds INTEGER               -- athlete's goal time
  created_at      TIMESTAMPTZ
  updated_at      TIMESTAMPTZ
  UNIQUE(profile_id, station)
```

#### Training Plans

```sql
hyrox_training_plans
  id              UUID PRIMARY KEY
  user_id         UUID FK → users.id
  title           TEXT NOT NULL           -- e.g., "12-Week Foundation Plan"
  total_weeks     INTEGER NOT NULL
  start_date      DATE NOT NULL
  end_date        DATE NOT NULL
  plan_type       TEXT NOT NULL           -- 'foundation_12wk' | 'race_prep_8wk' | 'abbreviated_4wk' | 'maintenance'
  status          TEXT DEFAULT 'active'   -- 'active' | 'completed' | 'archived'
  pace_scale_factor NUMERIC NOT NULL      -- multiplier applied to template paces
  created_at      TIMESTAMPTZ

hyrox_plan_sessions
  id              UUID PRIMARY KEY
  plan_id         UUID FK → hyrox_training_plans.id
  week            INTEGER NOT NULL
  day_of_week     INTEGER NOT NULL        -- 1=Mon, 7=Sun
  session_type    TEXT NOT NULL            -- 'easy_run' | 'tempo_run' | 'intervals' | 'station_finisher' | 'hyrox_class' | 'rest'
  title           TEXT NOT NULL
  description     TEXT NOT NULL            -- full session details with paces/weights
  target_pace     TEXT                     -- e.g., "8:30-8:45/mile"
  duration_minutes INTEGER
  phase           TEXT NOT NULL            -- 'aerobic_foundation' | 'aerobic_development' | 'race_pace_integration'
  order_in_day    INTEGER DEFAULT 1        -- for multiple sessions same day (e.g., run + finisher)
  created_at      TIMESTAMPTZ

hyrox_session_logs
  id              UUID PRIMARY KEY
  plan_session_id UUID FK → hyrox_plan_sessions.id
  user_id         UUID FK → users.id
  status          TEXT NOT NULL            -- 'completed' | 'skipped' | 'modified'
  actual_pace     TEXT                     -- what they actually ran
  actual_time_seconds INTEGER              -- station finisher time
  actual_reps     INTEGER                  -- station finisher reps (e.g., wall balls unbroken)
  rpe             INTEGER                  -- 1-10
  notes           TEXT
  logged_at       TIMESTAMPTZ
  UNIQUE(plan_session_id, user_id)

hyrox_station_benchmarks
  id              UUID PRIMARY KEY
  user_id         UUID FK → users.id
  station         TEXT NOT NULL
  time_seconds    INTEGER NOT NULL
  logged_at       TIMESTAMPTZ NOT NULL
  source          TEXT                     -- 'training_log' | 'race_result' | 'manual_entry'
  notes           TEXT
  INDEX(user_id, station, logged_at)       -- for trend queries
```

#### Division Reference Data

```sql
hyrox_divisions
  id              UUID PRIMARY KEY
  division_key    TEXT UNIQUE NOT NULL     -- 'single_women_open', 'double_mixed', etc.
  category        TEXT NOT NULL            -- 'single' | 'double' | 'relay'
  gender_label    TEXT NOT NULL            -- 'Women Open', 'Men Pro', 'Mixed', etc.
  display_order   INTEGER NOT NULL

hyrox_division_stations
  id              UUID PRIMARY KEY
  division_id     UUID FK → hyrox_divisions.id
  station         TEXT NOT NULL
  distance_meters NUMERIC                  -- for SkiErg, Row, Sled Push/Pull, BBJ, FC, SBL
  reps            INTEGER                  -- for Wall Balls (100)
  weight_kg       NUMERIC                  -- sled total weight, KB weight, sandbag, wall ball
  weight_note     TEXT                     -- "2 x 16 kg", "Total weight including sled"
  UNIQUE(division_id, station)
```

### 4.4 Reference Time Data

```sql
hyrox_station_reference_times
  id              UUID PRIMARY KEY
  division_id     UUID FK → hyrox_divisions.id
  station         TEXT NOT NULL
  pro_benchmark_seconds INTEGER NOT NULL   -- fastest reasonable time
  average_seconds INTEGER NOT NULL         -- typical open athlete
  slow_seconds    INTEGER NOT NULL         -- struggling/beginner
  source          TEXT                     -- 'hyrox_official' | 'estimated'
  updated_at      TIMESTAMPTZ
  UNIQUE(division_id, station)
```

---

## 5. API Routes

### 5.1 Auth

```
POST   /api/auth/magic-link      Send magic link email
POST   /api/auth/verify           Verify magic link token
POST   /api/auth/apple            Apple Sign-In callback
GET    /api/auth/session           Current session
POST   /api/auth/logout            End session
```

### 5.2 Communities

```
POST   /api/communities                   Create a community
GET    /api/communities                   List user's communities
GET    /api/communities/:id               Community details + members
POST   /api/communities/join              Join community with code
POST   /api/communities/:id/regenerate-code  (admin) New join code
DELETE /api/communities/:id/members/:userId  (admin) Remove member
```

### 5.3 Workouts (CrossFit)

```
POST   /api/workouts                              Create personal workout (manual entry)
POST   /api/workouts/parse                         Parse raw workout text → structured workout
POST   /api/communities/:communityId/workouts      (admin) Create community WOD
GET    /api/workouts                               List user's personal workouts (paginated)
GET    /api/communities/:communityId/workouts       List community WODs (paginated)
GET    /api/workouts/:id                           Single workout + movements
PUT    /api/workouts/:id                           Edit workout (own personal or admin community)
DELETE /api/workouts/:id                           Delete workout (own personal or admin community)
GET    /api/workouts/:id/scores                    Leaderboard (community) or personal history
```

### 5.4 Scores (CrossFit)

```
POST   /api/scores                  Log a score (with movement details)
PUT    /api/scores/:id              Update a score
DELETE /api/scores/:id              Delete own score
GET    /api/users/me/scores         My score history (filterable)
GET    /api/users/me/prs            Personal records
GET    /api/users/me/movements/:id/history   History for a specific movement
```

### 5.5 Movements

```
GET    /api/movements               Search/list canonical movements
POST   /api/movements               Suggest a new movement (admin-approved)
```

### 5.6 HYROX

```
POST   /api/hyrox/profile            Create/update HYROX profile (onboarding)
GET    /api/hyrox/profile             Get current profile + assessments
PUT    /api/hyrox/profile             Update profile

GET    /api/hyrox/divisions           List all divisions with station specs
GET    /api/hyrox/divisions/:key      Single division detail

POST   /api/hyrox/plan/generate       Generate training plan from profile
GET    /api/hyrox/plan                Get active plan with sessions
GET    /api/hyrox/plan/week/:num      Get specific week's sessions

POST   /api/hyrox/sessions/:id/log    Log a training session
PUT    /api/hyrox/sessions/:id/log    Update a session log
GET    /api/hyrox/sessions/logs       All session logs (for dashboard)

POST   /api/hyrox/benchmarks          Log a station benchmark
GET    /api/hyrox/benchmarks           Get all benchmarks (latest + history)
GET    /api/hyrox/estimate             Calculate estimated finish time

GET    /api/hyrox/reference-times      Get reference times for slider anchors
```

---

## 6. Capacitor / Mobile Considerations

### 6.1 App Store Requirements

- **Apple Sign-In**: Required for App Store if any social login is offered. Include as primary auth alongside magic link.
- **App icon, splash screen, screenshots**: Need HYROX/CrossFit themed branding
- **Privacy policy & Terms**: Required for submission
- **Offline support**: Deferred to v2, but design data layer to support it (TanStack Query with persistence)
- **Push notifications**: For new WOD posted, PR notifications (v2)

### 6.2 Capacitor Config

```typescript
// capacitor.config.ts
const config: CapacitorConfig = {
  appId: 'com.shredtrack.app',
  appName: 'ShredTrack',
  webDir: 'out',         // Next.js static export
  server: {
    url: 'https://shredtrack.app',  // production URL
    cleartext: false
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
    },
  },
};
```

### 6.3 Mobile UX Priorities

- Bottom tab navigation: Today (WOD + score entry) | HYROX | History | Profile
- Community switcher in header (if member of any communities, like Slack workspace)
- Pull-to-refresh on all list views
- Haptic feedback on score submission and PR celebration
- Score entry inputs: large touch targets, number pads for time/weight entry
- Dark mode support (matches HYROX branding aesthetic)
- "Paste Workout" quick-action from home screen (smart parser entry point)

---

## 7. Seed Data & Migrations

### 7.1 Movement Library Seed

Pre-populate ~150 common CrossFit movements with categories and Rx weights. Source from the existing ShredStack `crossfit-analysis.ts` movement normalization logic.

### 7.2 HYROX Division Seed

All division data from §2.2, including station weights/distances/reps.

### 7.3 Reference Time Seed

Station reference times per division for the onboarding sliders.

### 7.4 Plan Template Seed

The 12-week foundation plan structure (from the existing plan document) stored as template rows that the plan generator clones and scales per athlete.

---

## 8. Future Roadmap (v2+)

### 8.1 AI-Powered Plan Generation

Replace template-based generation with Claude API calls that consider:
- Full onboarding assessment data
- Training log history (what they've actually done)
- Rate of improvement (or plateau)
- Injury history / movement limitations
- Dynamic plan adjustment mid-cycle based on logged performance

### 8.2 CrossFit AI Insights

Port the ShredStack cfd-insights analysis engine:
- Automatic workout categorization and movement extraction
- Scaling pattern detection ("you scale pull-ups 60% of the time — here's your progression path")
- Strength progression tracking with e1RM estimates
- "Workout déjà vu" — surface similar past workouts when a new WOD is posted
- Personalized warm-up suggestions based on today's WOD

### 8.3 Gym-Level Onboarding (B2B)

Transition from athlete-first to gym-level distribution:
- Gym owner/manager creates the community (becomes primary admin)
- Coach role (view all scores, post WODs, can't manage gym settings)
- Multiple admins with granular permissions
- Programming calendar (plan WODs weeks in advance)
- Gym-wide analytics (class attendance, popular movements, scaling rates)
- White-label / custom branding per gym
- Subscription model for gym accounts

### 8.4 Social & Competition

- Follow other athletes
- Cross-gym leaderboards for benchmark WODs (Fran, Murph, etc.)
- Challenges (30-day squat challenge, etc.)
- Share scores to social media with branded cards

### 8.5 PushPress Import

- CSV import flow for athletes migrating from PushPress
- Map PushPress score formats to ShredTrack's data model
- Leverage the existing score parser logic from ShredStack

### 8.6 Wearable Integration

- Apple Watch companion (quick score logging)
- Heart rate data import for RPE calibration
- GPS run tracking for HYROX run sessions

---

## 9. Open Questions

1. ~~**App name**~~: **Resolved — ShredTrack.** Domain and App Store availability confirmed.

2. **Monetization**: Free tier with core tracking? Paid subscription for AI features (plan generation, insights)? Freemium with community size limits? Needs product decision before v2.

3. **Benchmark WOD library**: Should the app ship with a library of named CrossFit benchmarks (Fran, Murph, Grace, etc.) that any athlete can use as a template, or leave WOD creation entirely manual/parsed?

4. **HYROX plan — schedule flexibility**: The template assumes Mon/Tue/Thu/Sat training days. Should onboarding ask which days the athlete trains, and remap accordingly?

5. **Offline score entry**: For athletes logging scores at a gym with poor signal — should MVP support offline entry with sync, or is this v2?

6. **Data portability**: Should there be an export function (CSV/JSON) from day one for athlete data?

7. **Smart parser accuracy threshold**: When the text parser is <80% confident on a field, should it refuse and ask for manual entry, or show its best guess with an amber highlight? How do we measure and improve parser accuracy over time?

8. **Community WOD visibility for non-members**: If an athlete leaves a community, should they retain read-only access to WODs they previously scored on (for their personal history), or just keep the score without the workout context?

9. **Cross-community workout deduplication**: If an athlete is in two communities that both post "Fran" on the same day, should the app recognize it's the same workout and let them log one score that appears in both leaderboards?

