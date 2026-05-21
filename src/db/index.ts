import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getDb() {
  if (!_db) {
    // Production connects through the Supabase transaction-mode pooler
    // (`...pooler.supabase.com:6543`). On serverless each warm instance is its
    // own process, so keep the per-instance pool tiny to avoid exhausting the
    // pooler. `prepare: false` is required: transaction-mode pooling cannot
    // carry prepared statements across statements.
    const client = postgres(process.env.DATABASE_URL!, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
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
