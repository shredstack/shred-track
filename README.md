# ShredTrack

A mobile-first training app for HYROX and CrossFit athletes. Track workouts, log scores with granular scaling detail, follow periodized HYROX training plans, and compete with your community.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **UI**: Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL (Supabase) via Drizzle ORM
- **Auth**: Supabase Auth (email/password + Google OAuth)
- **Mobile**: Capacitor (iOS + Android) — planned

## Prerequisites

- Node.js 18+
- Docker Desktop (for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Start local Supabase

```bash
supabase start
```

This spins up a full Supabase stack in Docker (Postgres, Auth, Studio, Mailpit, etc.). On first run it pulls the required Docker images.

Or to run with a clean slate (if Docker is currently in a stale state) as this will skip backing up a bad database that failed to start:

```bash
supabase stop --no-backup && supabase start
```

### 3. Configure environment

The `.env.local` file should already be configured for local development. If not, copy the values from `supabase status`:

```bash
supabase status
```

### 4. Push database schema and seed data

```bash
npm run db:push       # Push Drizzle schema to local Postgres
npm run db:seed       # Seed movements, HYROX divisions, reference times
```

### 5. Run the dev server

```bash
npm run dev
```

Open http://localhost:3000 — you'll be redirected to the login page. Create an account with email/password to get started.

## Supabase Commands

| Command | Description |
|---------|-------------|
| `supabase start` | Start the local Supabase stack (Postgres, Auth, Studio, etc.) |
| `supabase stop` | Stop all local Supabase containers |
| `supabase stop --no-backup` | Stop and discard all local database data |
| `supabase status` | Show URLs, ports, and API keys for the running stack |
| `supabase db reset` | Reset local database: re-runs all migrations + seed files |
| `supabase db diff` | Generate a SQL diff of schema changes (useful before creating a migration) |
| `supabase db push` | Push local migrations to a remote Supabase project |
| `supabase db pull` | Pull schema from remote into a local migration file |
| `supabase migration new <name>` | Create a new empty migration file |
| `supabase migration list` | List all migrations and their status |

## Drizzle ORM Commands

| Command | Description |
|---------|-------------|
| `npm run db:push` | Push Drizzle schema directly to the database (dev only — no migration files) |
| `npm run db:generate` | Generate SQL migration files from schema changes |
| `npm run db:migrate` | Run pending migrations against the database |
| `npm run db:seed` | Seed the database with movements, divisions, and reference times |

## Local Dev URLs

| Service | URL |
|---------|-----|
| App | http://localhost:3000 |
| Supabase Studio | http://127.0.0.1:54353 |
| Mailpit (email testing) | http://127.0.0.1:54354 |
| Supabase API | http://127.0.0.1:54351 |

## Database Migration Workflow

For local development, `npm run db:push` is the fastest way to iterate on schema changes — it syncs the Drizzle schema directly to the database without migration files.

For changes that need to go to production:

1. Make schema changes in `src/db/schema.ts`
2. Generate a migration: `npm run db:generate`
3. Review the generated SQL in `drizzle/`
4. Test locally: `npm run db:migrate`
5. Commit the migration file with your PR
6. On merge to `main`, run migrations against production

For Supabase-specific migrations (triggers, RLS policies, functions):

1. Create a migration: `supabase migration new my_change`
2. Write SQL in `supabase/migrations/<timestamp>_my_change.sql`
3. Test locally: `supabase db reset`
4. Commit and merge

## Google OAuth Setup (Optional)

Google sign-in works out of the box with Supabase. For local dev:

1. Create a Google Cloud project and OAuth credentials
2. Set the authorized redirect URI to `http://127.0.0.1:54351/auth/v1/callback`
3. Add your client ID and secret to `supabase/config.toml` under `[auth.external.google]`

## GitHub Repository Setup

### Required Secrets

The CI/CD workflows require the following secrets configured in your GitHub repository settings (**Settings → Secrets and variables → Actions**):

#### For Claude PR Review (`claude-pr-review.yml`)

| Secret | Description | Where to get it |
|--------|-------------|-----------------|
| `ANTHROPIC_API_KEY` | API key for Claude PR reviews | [Anthropic Console](https://console.anthropic.com/) → API Keys |

#### For Database Migration Deployment (`deploy_database_migrations.yml`)

| Secret | Description | Where to get it |
|--------|-------------|-----------------|
| `SUPABASE_ACCESS_TOKEN` | Personal CLI access token (not a project API key) | [Supabase Dashboard](https://supabase.com/dashboard/) → Account Settings (top-right avatar) → Access Tokens |
| `SUPABASE_DB_PASSWORD` | The database password set when creating the project | Supabase Dashboard → Project Settings → Database |
| `SUPABASE_PROJECT_REF` | Your project's reference ID (e.g., `abcdefghijkl`) | Supabase Dashboard → Project Settings → General |

> **Note:** The `SUPABASE_ACCESS_TOKEN` is your **personal Supabase CLI token**, not the project's `anon` or `service_role` key. Those project API keys are for your app's runtime code, not for CI/CD.

### Optional: Production Environment Protection

For an extra safety layer on database migrations, create a `production` environment with required reviewers:

1. Go to **Settings → Environments → New environment**
2. Name it `production`
3. Enable **Required reviewers** and add yourself
4. Migration deployments will now require manual approval before running

## Project Structure

```
src/
├── app/
│   ├── (app)/           # Authenticated pages (Today, HYROX, History, Profile)
│   ├── (auth)/          # Login + Signup pages
│   ├── api/             # API route handlers
│   └── auth/callback/   # OAuth callback handler
├── components/
│   ├── crossfit/        # WOD builder, parser, score entry, leaderboard
│   ├── hyrox/           # Onboarding wizard, dashboard, plan view, overview
│   ├── shared/          # Bottom nav, app header
│   └── ui/              # shadcn/ui components
├── db/
│   ├── schema.ts        # Drizzle ORM schema (all tables)
│   ├── index.ts         # Database connection
│   └── seed.ts          # Seed script
├── lib/
│   ├── supabase/        # Supabase client (server, browser, middleware)
│   ├── workout-parser.ts # Heuristic WOD text parser
│   ├── plan-generator.ts # HYROX plan template engine
│   ├── hyrox-data.ts    # Division specs, reference times
│   └── session.ts       # Auth session helper
└── types/
    └── crossfit.ts      # TypeScript types for CrossFit module
```
