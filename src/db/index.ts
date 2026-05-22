import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) {
    // DATABASE_URL points at Supabase's transaction-mode pooler (port 6543),
    // which multiplexes many serverless clients over a small server pool — the
    // fix for the "max clients reached in session mode" exhaustion seen on the
    // session pooler. `prepare: false` is REQUIRED there: transaction-mode
    // pooling cannot carry prepared statements across statements.
    //
    // Do NOT set `max: 1`. Capping each serverless instance to a single
    // connection serialized every query onto it; because a page render fans
    // out many concurrent queries, the lone connection could stall and hang
    // the whole request until Vercel's 300s timeout. The postgres.js default
    // pool is the known-good behavior — the transaction pooler is built to
    // absorb it.
    const client = postgres(process.env.DATABASE_URL!, { prepare: false });
    _db = drizzle(client, { schema });
  }
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type DB = ReturnType<typeof drizzle<typeof schema>>;
