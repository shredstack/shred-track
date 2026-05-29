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
    // `idle_timeout` closes a connection 20s after its last use, so a warm-but-
    // idle serverless instance releases its pooler client slots between
    // requests instead of hoarding them.
    //
    // `max` is intentionally left at the postgres.js default (10). Do NOT set
    // `max: 1`: that serialized every query of a request onto one connection,
    // so a single stalled query hung the whole request until Vercel's 300s
    // timeout. 10 gives ample headroom; the transaction pooler absorbs the
    // per-request fan-out and `idle_timeout` keeps idle instances from
    // accumulating slots.
    //
    // `connect_timeout` and a server-side `statement_timeout` are set so a
    // transient Supabase stall fails fast (~25s total) instead of riding out
    // Vercel's 300s function ceiling. The DB-side statement_timeout is the
    // real safety net — postgres.js sets it as a session param on connect,
    // so every query inherits it.
    const client = postgres(process.env.DATABASE_URL!, {
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      connection: { statement_timeout: 15000 },
    });
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
