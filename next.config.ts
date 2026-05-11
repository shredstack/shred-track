import type { NextConfig } from "next";
import { SUPABASE_PROXY_PATH, LOCAL_SUPABASE_URL } from "./src/lib/ios-local-dev";

const ngrokDomain = process.env.NEXT_PUBLIC_NGROK_DOMAIN;

const nextConfig: NextConfig = {
  ...(ngrokDomain && {
    allowedDevOrigins: [ngrokDomain],
    async rewrites() {
      return [
        {
          source: `${SUPABASE_PROXY_PATH}/:path*`,
          destination: `${LOCAL_SUPABASE_URL}/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
