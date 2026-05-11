// Path under which the Next.js dev server proxies to local Supabase
// when iOS-local-dev mode is enabled. Kept as a shared constant so
// the next.config.ts rewrite and the browser Supabase client agree.
export const SUPABASE_PROXY_PATH = "/supabase-proxy";

// Local Supabase API port (default for `supabase start`). Used as the
// rewrite target in next.config.ts.
export const LOCAL_SUPABASE_URL = "http://127.0.0.1:54351";
