// Set a known password on Sarah's local Supabase user so playwright can sign in.
// Local-only — uses SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).split("#")[0].trim()];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data, error } = await admin.auth.admin.updateUserById(
  "37af0f97-f0a3-42b8-b7d8-b97226145b05",
  { password: "verify-pw-temp-9281" },
);
if (error) {
  console.error(error);
  process.exit(1);
}
console.log("ok", data.user.id);
