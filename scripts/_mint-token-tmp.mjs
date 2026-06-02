// Mint a Supabase session for Sarah using the admin API's magic link flow.
// Local Supabase only — uses the service role key from .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("/Users/sarahdorich/shred-track/.env.local", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).split("#")[0].trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Generate an OTP magic link, then verify it to mint a real session
// (access_token + refresh_token).
const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: "sarah.dorich@gmail.com",
});
if (linkErr) {
  console.error("generateLink failed:", linkErr);
  process.exit(1);
}

const hash = linkData.properties.hashed_token;
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: sess, error: verifyErr } = await anon.auth.verifyOtp({
  type: "email",
  token_hash: hash,
});
if (verifyErr) {
  console.error("verifyOtp failed:", verifyErr);
  process.exit(1);
}

console.log(JSON.stringify({
  user_id: sess.user.id,
  email: sess.user.email,
  access_token: sess.session.access_token,
  refresh_token: sess.session.refresh_token,
}, null, 2));
