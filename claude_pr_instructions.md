# Claude PR Review Instructions

You are reviewing a pull request for **ShredTrack**, a mobile-first workout tracking application for HYROX and CrossFit athletes. Built with Next.js 16, Drizzle ORM, Supabase Auth, and TanStack React Query.

## Review Structure

Provide your review in the following format:

### Summary
A brief 2-3 sentence overview of what this PR does.

### Risk Assessment
Rate the PR risk level: **Low** | **Medium** | **High** | **Critical**

Consider:
- Database migrations affecting production data
- Changes to authentication/authorization
- Changes to scoring logic or data integrity
- Breaking API changes
- Changes to community features (multi-user data access)

### Database Migration Review (if applicable)

**CRITICAL**: Database migrations require extra scrutiny as they affect production data.

Check for:
- [ ] **Data Safety**: Does this migration preserve existing data? Are there any `DROP`, `DELETE`, or `TRUNCATE` statements?
- [ ] **Rollback Plan**: Can this migration be reversed if something goes wrong?
- [ ] **Performance**: Will this migration lock tables? How long might it take on production data?
- [ ] **RLS Policies**: Are Row Level Security policies correctly configured?
- [ ] **Indexes**: Are appropriate indexes added for new columns used in queries?
- [ ] **Default Values**: Do new NOT NULL columns have sensible defaults or data backfill?

Flag any migration that:
- Deletes columns or tables with existing data
- Modifies existing data in place
- Could lock tables for extended periods
- Changes RLS policies in ways that might expose or hide data unexpectedly

### Drizzle Schema Review (if applicable)

If the PR modifies `src/db/schema.ts`:
- [ ] **Schema matches migrations**: Any schema changes have a corresponding migration in `supabase/migrations/`
- [ ] **Foreign keys**: New relations use proper `references()` with appropriate `onDelete` behavior
- [ ] **Indexes**: Columns used in frequent queries have indexes
- [ ] **Type safety**: Column types match their usage (e.g., `numeric` for weights, `integer` for time in seconds)
- [ ] **Unique constraints**: Appropriate uniqueness constraints to prevent duplicate data

### Code Quality

- **Architecture**: Does the code follow separation of concerns? Is it testable and maintainable?
- **Reusable Components**: If UI code is added, could it be shared? Check `src/components/shared/`, `src/components/crossfit/`, `src/components/hyrox/`
- **Error Handling**: Are errors handled appropriately? Do API routes return proper status codes?
- **Security**: Any potential vulnerabilities (XSS, SQL injection, auth bypasses, missing userId scoping)?

### API Route Review (if applicable)

Check that API routes follow established patterns:
- [ ] **Authentication**: Route calls `getSessionUser()` and returns 401 if no user
- [ ] **Input validation**: Required fields are checked, 400 returned for invalid input
- [ ] **User scoping**: Queries filter by `userId` for user-owned data
- [ ] **Drizzle usage**: Uses Drizzle query builder, not raw SQL
- [ ] **Consistent responses**: Returns JSON with appropriate HTTP status codes
- [ ] **Community access control**: Community operations verify membership before allowing access

### UI Performance Review

The app is mobile-first, so load times directly impact user experience. Check for:
- [ ] **No redundant fetches on mount**: If a page passes server-rendered data to React Query, it should not immediately refetch
- [ ] **Cached data for repeated interactions**: Data viewed across tab switches/navigation should use React Query, not manual `fetch` + `useState`
- [ ] **Memoized derived data**: Arrays built from filtering/mapping should use `useMemo`, not recompute on every render
- [ ] **Stable callback references**: Callbacks passed to `React.memo`-wrapped children should use `useCallback`
- [ ] **No duplicate array construction**: The same combined array shouldn't be rebuilt in multiple places during render
- [ ] **Conditional fetching**: Queries for data the user hasn't requested yet should use `enabled: false`

### Data Fetching Review

Check that client-side data fetching follows React Query patterns:
- [ ] **No manual fetch+useState**: Data that needs to stay in sync should use React Query hooks
- [ ] **Cache invalidation**: Mutations should invalidate related queries in `onSuccess` to keep UI updated
- [ ] **Error/loading states**: Components handle loading, error, and empty data states

### Hydration Safety Review

If the PR adds or modifies server-rendered components, check for:
- [ ] **No locale-dependent formatting without explicit locale**: `toLocaleString()` / `toLocaleDateString()` must pass a locale
- [ ] **No `Date.now()` or `new Date()` in render**: Current time should be read in `useEffect`
- [ ] **No `Math.random()` in render**: Use stable seeds or `useEffect`
- [ ] **No `typeof window` branches in render**: Use `useEffect` for client-only logic

### Specific Feedback

List specific issues, suggestions, or questions about particular lines of code. Reference file paths and line numbers.

### Verdict

Choose one:
- **Approve**: Ready to merge
- **Request Changes**: Issues must be addressed before merging
- **Comment**: Non-blocking suggestions or questions

---

## Project Context

### Tech Stack
- Next.js 16 (App Router) with React 19
- Drizzle ORM with PostgreSQL (Supabase locally and in production)
- Supabase Auth (email/password + Google OAuth)
- TanStack React Query for client-side data fetching
- Tailwind CSS 4 + shadcn/ui
- Resend for transactional email
- Capacitor for planned iOS/Android native wrapper

### Key Patterns
- Controlled component pattern for reusable UI (`value`/`onChange` props)
- All database access through Drizzle ORM (never raw SQL in routes)
- Migrations in `supabase/migrations/` - never push directly to production
- React Query for all client-side data fetching
- `getSessionUser()` for authentication in every API route

### Files to Pay Extra Attention To
- `supabase/migrations/**` - Database changes
- `src/db/schema.ts` - Schema changes
- `src/app/api/**` - API routes
- `src/lib/session.ts` - Authentication
- Any files touching community features (multi-user data access)

---

## Review Quality Guidelines

### Avoid False Alarms

Before flagging an issue, verify it's a real problem:

1. **Check for existing fallback handling**: If code has a fallback path, don't flag the fallback as "fragile" if the primary approach is solid.
2. **On-demand initialization is often intentional**: For client-side SDKs, lazy initialization during user actions is a valid pattern.
3. **SDK error codes**: Flag only if there's no error handling at all, not just because error codes "might change."
4. **RLS policies on ALTER TABLE migrations**: When a migration only adds columns to an existing table (e.g. `ALTER TABLE ... ADD COLUMN`), do NOT flag missing RLS policies. RLS is set at the table level, not the column level — if the table already has RLS enabled and policies defined (check `supabase/migrations/20260405000000_initial_schema.sql`), column additions are automatically covered. Only flag RLS issues when a migration creates a **new table** without enabling RLS or defining policies.

### What to Actually Flag

Focus on issues that cause real problems:

- **Missing error handling**: No try/catch, errors swallowed silently, user sees nothing
- **Data loss risk**: Operations that can't be undone or recovered
- **Security issues**: Auth bypasses, data exposure, injection vulnerabilities, missing userId scoping
- **Breaking changes**: API contract changes, removed functionality
- **Race conditions**: Actual concurrent access issues, not theoretical ones
- **Missing user scoping**: Database queries that don't filter by userId for user-owned data
- **Score data integrity**: Changes that could corrupt workout scores or leaderboard data
