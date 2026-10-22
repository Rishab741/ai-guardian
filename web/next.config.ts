import type { NextConfig } from "next";

// Where the gateway lives. GATEWAY_URL is the server-side setting; fall back to
// the public one so older deployments keep working.
const gateway = (process.env.GATEWAY_URL || process.env.NEXT_PUBLIC_API_URL || "").replace(/\/+$/, "");

// On Vercel the browser calls this site's own /api and /v1 paths and Vercel
// forwards them to the gateway. Same origin, so no CORS settings to get right
// on the gateway, and the gateway's URL never has to be baked into the page.
// Local development keeps calling the gateway directly.
const proxy = Boolean(process.env.VERCEL) && gateway.startsWith("http");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_PROXY: proxy ? "1" : "",
  },
  async rewrites() {
    if (!proxy) return [];
    return [
      { source: "/api/:path*", destination: `${gateway}/api/:path*` },
      { source: "/v1/:path*", destination: `${gateway}/v1/:path*` },
      { source: "/healthz", destination: `${gateway}/healthz` },
    ];
  },
};

export default nextConfig;
