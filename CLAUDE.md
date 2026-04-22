# Context for Claude

@AGENTS.md

## Architecture Notes

ShredTrack is a mobile-first web application for HYROX and CrossFit athletes to track workouts, log scores with granular scaling detail, follow periodized training plans, and compete with community members.

### Tech Stack

- **Next.js 16** (App Router) with TypeScript
- **React 19** with Server Components
- **Drizzle ORM** with PostgreSQL (via Supabase locally and in production)
- **Supabase Auth** (email/password + Google OAuth)
- **TanStack React Query** for client-side data fetching
- **Tailwind CSS 4** + **shadcn/ui** for styling
- **Resend** for transactional email (activation, invites)
- **Capacitor** for planned iOS/Android native wrapper

For support, customers should email shredstacksarah@gmail.com.

## App Development Best Practices

### Important Coding Guidelines

1. **Separation of concerns** - Each module handles one thing. API routes handle auth + validation, lib/ handles business logic, components handle UI.
2. **Testability** - Modules should be written so that we can test individual stages/components in isolation.
3. **Maintainability** - Code that's easier to iterate on without risking other components.
4. **Readability** - Clear code organization for future development.

### Reusable Components

When adding features that appear in multiple places, create a shared component in `src/components/shared/` or the relevant domain folder (`crossfit/`, `hyrox/`) rather than duplicating code. Use the controlled component pattern where the parent manages state and passes `value`/`onChange` props.

Before writing new UI code, check if similar functionality already exists that could be extracted into a reusable component.

**Key shared components to use (do NOT re-implement these):**

- **`DivisionPicker`** (`src/components/shared/division-picker.tsx`) — For selecting a HYROX division. Supports `genderFilter`, `allowedKeys` (renders inline pills for ≤6 keys, dropdown with search for more), and category accordion grouping. Use this everywhere a division needs to be selected.

- **`UnitToggle`** (`src/components/shared/unit-toggle.tsx`) — Compact Kg/Lbs toggle that reads/writes the global unit preference. Place this wherever weights are displayed so users can switch units.

- **`useUnits`** hook (`src/hooks/useUnits.ts`) — Global unit preference (metric/mixed) backed by localStorage. Returns `{ mode, isMixed, toggle, setMode }`. Use `isMixed` to decide whether to convert weights. **Never** create local `useMixed` state — always use this hook so the preference stays in sync across the app.

- **`convertWeightLabel()`** (`src/lib/hyrox-data.ts`) — Converts weight labels preserving multiplier prefixes (e.g., `"2×16 kg"` → `"2 × 35 lbs"`). Always use this instead of raw `kgToLbs()` for display strings.

- **`formatStationPace()`** (`src/lib/hyrox-data.ts`) — Returns a meaningful pace string for a station (e.g., `/500m` for SkiErg/Rowing, `s/rep` for Wall Balls, `null` for stations where pace doesn't add value like Sled Push).

- **`SplitCard`** (`src/components/hyrox/split-card.tsx`) — Card for displaying a single race split with segment name, time, cumulative, and meaningful pace. Use instead of table rows for mobile-friendly split display.

### Units & Weight Display

- Weights display in **metric (kg)** by default. Users toggle to **mixed (lbs)** via `UnitToggle`.
- "Mixed" means kg → lbs but distances stay in meters (HYROX uses meters natively).
- Always show the unit suffix (e.g., "102 kg" not just "102").
- For equipment with multipliers (e.g., Farmers Carry kettlebells), always show the per-unit weight: "2 × 16 kg" not "32 kg".
- When mixed mode is on, show both: "2×16 kg / 2 × 35 lbs".

### Drizzle ORM Usage

All database access goes through Drizzle ORM. Never write raw SQL in API routes or lib files - use Drizzle's query builder.

**Key files:**
- `src/db/schema.ts` - All table definitions (single source of truth for the database schema)
- `src/db/index.ts` - Drizzle client factory (singleton Postgres connection)

**Query patterns:**
```typescript
import { db } from "@/db";
import { workouts, scores } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

// Select
const results = await db
  .select()
  .from(workouts)
  .where(eq(workouts.userId, userId))
  .orderBy(desc(workouts.createdAt));

// Insert
const [newWorkout] = await db
  .insert(workouts)
  .values({ title, userId, workoutType })
  .returning();

// Update
await db
  .update(workouts)
  .set({ title: newTitle })
  .where(eq(workouts.id, workoutId));

// Delete
await db
  .delete(workouts)
  .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)));
```

**Guidelines:**
- Always scope queries by `userId` for user-owned data (security)
- Use `.returning()` on inserts/updates when you need the result
- Use transactions (`db.transaction()`) when multiple writes must succeed or fail together
- Add new tables to `src/db/schema.ts`, never create separate schema files

### React Query for Data Fetching

We use TanStack Query (React Query) for all client-side data fetching to ensure the UI stays up-to-date after user actions. **Never use manual `fetch` + `useState` patterns** for data that needs to stay synchronized.

**Creating query hooks:**
```typescript
import { useQuery } from '@tanstack/react-query';

export function useWorkouts() {
  return useQuery({
    queryKey: ['workouts'],
    queryFn: async () => {
      const response = await fetch('/api/workouts');
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    },
  });
}
```

**Creating mutation hooks with cache invalidation:**
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useCreateWorkout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data) => {
      const response = await fetch('/api/workouts', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to create');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] });
    },
  });
}
```

**Guidelines:**
- Mutations should invalidate related queries in `onSuccess` to keep UI in sync
- Use optimistic updates for instant feedback on user actions where appropriate
- Use the `enabled` option to conditionally fetch - don't fetch data the user hasn't requested yet

### API Route Patterns

All API routes live in `src/app/api/` and follow a consistent pattern:

1. **Authenticate first** - Every route calls `getSessionUser()` and returns 401 if no user
2. **Validate input** - Check required fields, return 400 with descriptive message for invalid input
3. **Use Drizzle for queries** - Never raw SQL
4. **Return consistent shapes** - Always return JSON, use appropriate HTTP status codes
5. **Scope by user** - All queries for user-owned data must filter by `userId`

```typescript
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results = await db.select().from(table).where(eq(table.userId, user.id));
  return NextResponse.json(results);
}
```

### UI Performance

Fast load times are critical for a mobile-first app. Follow these principles:

**Data fetching:**
- When a page provides server-rendered initial data, pass it to React Query via `setQueryData` and set `refetchOnMount: false` for that initial load.
- Never use manual `fetch()` + `useState` for data that should be cached across interactions.
- Use the `enabled` option to conditionally fetch.

**Memoization:**
- Wrap derived/computed values with `useMemo` when they involve filtering, mapping, or combining arrays.
- Wrap callback handlers passed to child components with `useCallback` so `React.memo` on those children is effective.
- Use `React.memo` on list-item components and repeated sections to prevent unnecessary re-renders.

**Avoid common pitfalls:**
- Don't rebuild the same array in multiple places during render.
- Don't pass inline arrow functions as props to memoized children.
- Keep large components from holding too many `useState` calls.

### Hydration Safety (SSR/Client Mismatch)

Next.js server-renders HTML before React hydrates on the client. Avoid these common causes of hydration errors:

- **`toLocaleString()` without an explicit locale** - Always pass a locale, e.g., `value.toLocaleString('en-US')`.
- **`Date.now()` / `new Date()` in render** - Read current time in a `useEffect` and store in state.
- **`Math.random()` in render** - Use a stable seed or move to `useEffect`.
- **`typeof window !== 'undefined'` branches in render** - Use `useEffect` for client-only logic or `suppressHydrationWarning`.

### Error Handling

- API routes should catch errors and return appropriate status codes (400, 401, 404, 500)
- Client components should handle loading, error, and empty states
- Use try/catch around database operations and external API calls
- Log errors server-side for debugging but return user-friendly messages to the client
- Never expose internal error details (stack traces, query strings) to the client

### Security

- Always authenticate users via `getSessionUser()` before any data access
- Scope all database queries by `userId` for user-owned data
- Validate and sanitize all user input in API routes
- Use parameterized queries (Drizzle handles this automatically)
- Never trust client-side data for authorization decisions
- Community operations must verify membership before allowing access

## Database Migrations

All database migrations live in `supabase/migrations/`. New migrations should be generated using:
```bash
supabase migration new <description>
```
This creates a file in the migrations directory which can then be filled out with the SQL.

To apply migrations locally:
```bash
supabase migration up
```

**Never push migrations to production directly!** Don't use the `--linked` flag. Never run:
```bash
supabase db push --linked
```

Production migrations are deployed via the GitHub Actions workflow (`deploy_database_migrations.yml`).

### Migration Safety Checklist

Before writing a migration:
- Will it preserve existing data? Avoid `DROP`, `DELETE`, or `TRUNCATE` on tables with data.
- Can it be reversed if something goes wrong?
- Will it lock tables? How long might it take on production data?
- Are RLS policies correctly configured for new tables?
- Are appropriate indexes added for columns used in WHERE clauses or JOINs?
- Do new NOT NULL columns have sensible defaults or a data backfill step?
