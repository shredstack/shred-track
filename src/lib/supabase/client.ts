import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_PROXY_PATH } from "@/lib/ios-local-dev";

export function createClient() {
  // When the local iOS dev flag is set, the browser bundle (running
  // inside the ngrok-tunneled WKWebView) cannot reach 127.0.0.1, so
  // route Supabase calls through the Next.js rewrite at /supabase-proxy.
  // Server-side callers still use NEXT_PUBLIC_SUPABASE_URL directly.
  const ngrokDomain = process.env.NEXT_PUBLIC_NGROK_DOMAIN;
  const supabaseUrl = ngrokDomain
    ? `https://${ngrokDomain}${SUPABASE_PROXY_PATH}`
    : process.env.NEXT_PUBLIC_SUPABASE_URL!;

  return createBrowserClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        name: "sb-shredtrack",
      },
    }
  );
}
