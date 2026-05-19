// ---------------------------------------------------------------------------
// APNS HTTP/2 client.
//
// Signs a short-lived ES256 JWT with the .p8 key Apple gave us and POSTs
// the push payload to api.push.apple.com (or sandbox for dev). We deliver
// best-effort: token errors mark the row dead in the caller; transient
// 5xx errors throw and Inngest retries.
//
// Env vars expected:
//   APNS_KEY_P8     — base64-encoded .p8 contents
//   APNS_KEY_ID     — the 10-char Key ID from Apple Developer
//   APNS_TEAM_ID    — the 10-char Team ID
//   APNS_BUNDLE_ID  — the iOS bundle (e.g. com.shredstack.shredtrack)
//   APNS_ENVIRONMENT — 'sandbox' for dev, 'production' for prod
//
// All of these must be set for push to work; if any is missing the
// sender no-ops so the rest of the app keeps running.
// ---------------------------------------------------------------------------

import { createSign, KeyObject, createPrivateKey } from "crypto";

const APNS_PROD_HOST = "api.push.apple.com";
const APNS_SANDBOX_HOST = "api.sandbox.push.apple.com";

interface ApnsConfig {
  keyP8: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  environment: "sandbox" | "production";
}

function readConfig(): ApnsConfig | null {
  const keyP8Raw = process.env.APNS_KEY_P8;
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const env = (process.env.APNS_ENVIRONMENT ?? "sandbox").toLowerCase();
  if (!keyP8Raw || !keyId || !teamId || !bundleId) return null;
  if (env !== "sandbox" && env !== "production") return null;
  // Allow either raw .p8 contents or base64-encoded contents in the env.
  const keyP8 = keyP8Raw.includes("BEGIN PRIVATE KEY")
    ? keyP8Raw
    : Buffer.from(keyP8Raw, "base64").toString("utf8");
  return {
    keyP8,
    keyId,
    teamId,
    bundleId,
    environment: env as "sandbox" | "production",
  };
}

let _cachedToken: { jwt: string; expiresAt: number } | null = null;

function base64Url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function buildJwt(cfg: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  // APNS tokens are valid up to 1h; refresh every ~50min.
  if (_cachedToken && _cachedToken.expiresAt > now + 60) {
    return _cachedToken.jwt;
  }

  const header = base64Url(
    JSON.stringify({ alg: "ES256", kid: cfg.keyId })
  );
  const payload = base64Url(
    JSON.stringify({ iss: cfg.teamId, iat: now })
  );
  const signingInput = `${header}.${payload}`;

  let pk: KeyObject;
  try {
    pk = createPrivateKey({ key: cfg.keyP8, format: "pem" });
  } catch (err) {
    throw new Error(
      `APNS_KEY_P8 is not a valid PEM .p8 key: ${err instanceof Error ? err.message : err}`
    );
  }

  const signer = createSign("SHA256");
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign({ key: pk, dsaEncoding: "ieee-p1363" });
  const jwt = `${signingInput}.${base64Url(sig)}`;
  _cachedToken = { jwt, expiresAt: now + 60 * 50 };
  return jwt;
}

export interface ApnsPayload {
  title: string;
  body: string;
  targetUrl?: string;
  badge?: number;
  threadId?: string;
}

export interface ApnsSendResult {
  ok: boolean;
  statusCode: number;
  reason?: string;
  isInvalidToken: boolean;
}

/**
 * Send a single APNS push. Returns ok=false on any non-200; isInvalidToken
 * indicates the token should be deleted from the DB (Apple's `BadDeviceToken`,
 * `Unregistered`, `ExpiredToken`).
 *
 * When APNS env vars are missing the function returns `{ ok: false,
 * statusCode: 0, reason: 'not-configured' }` so dev environments don't
 * crash.
 */
export async function sendApnsPush(
  deviceToken: string,
  payload: ApnsPayload
): Promise<ApnsSendResult> {
  const cfg = readConfig();
  if (!cfg) {
    return {
      ok: false,
      statusCode: 0,
      reason: "not-configured",
      isInvalidToken: false,
    };
  }

  const jwt = buildJwt(cfg);
  const host =
    cfg.environment === "production" ? APNS_PROD_HOST : APNS_SANDBOX_HOST;

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
      ...(payload.threadId ? { "thread-id": payload.threadId } : {}),
    },
    ...(payload.targetUrl ? { targetUrl: payload.targetUrl } : {}),
  });

  const res = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "content-type": "application/json",
    },
    body,
  });

  if (res.ok) {
    return { ok: true, statusCode: res.status, isInvalidToken: false };
  }

  const text = await res.text().catch(() => "");
  let reason = text;
  try {
    const json = JSON.parse(text) as { reason?: string };
    if (json.reason) reason = json.reason;
  } catch {
    // not JSON; keep text
  }
  const isInvalid =
    res.status === 400 &&
    (reason === "BadDeviceToken" ||
      reason === "Unregistered" ||
      reason === "ExpiredToken");

  return {
    ok: false,
    statusCode: res.status,
    reason,
    isInvalidToken: isInvalid,
  };
}
