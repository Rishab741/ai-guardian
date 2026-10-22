import type { NextConfig } from "next";

// The hosted demo gateway (render.yaml). Used on Vercel only when neither
// GATEWAY_URL nor NEXT_PUBLIC_API_URL is configured, so a missing variable
// can't silently point the console at localhost.
const HOSTED_DEMO_GATEWAY = "https://sovereignfabric-gateway.onrender.com";

const gateway = (
  process.env.GATEWAY_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.VERCEL ? HOSTED_DEMO_GATEWAY : "")
).replace(/\/+$/, "");

// The browser always calls this site's own /api and /v1 paths and the server
// forwards them to the gateway: same origin, so there are no CORS settings to
// get right and the gateway's address is never baked into the page.
const proxy = gateway.startsWith("http");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_API_PROXY: proxy ? "1" : "",
    SF_GATEWAY_TARGET: gateway,
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
