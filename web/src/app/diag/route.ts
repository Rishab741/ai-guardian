/**
 * Deployment diagnostics: how this console build reaches the gateway, and
 * whether the server can reach it right now. Reports addresses and timings
 * only, never keys.
 */
export async function GET() {
  const target = process.env.SF_GATEWAY_TARGET ?? "";
  const started = Date.now();
  let server_to_gateway: Record<string, unknown>;
  try {
    const r = await fetch(`${target}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    server_to_gateway = { status: r.status, ms: Date.now() - started, body: (await r.text()).slice(0, 200) };
  } catch (e) {
    server_to_gateway = { error: e instanceof Error ? e.message : String(e), ms: Date.now() - started };
  }
  return Response.json({
    browser_calls: process.env.NEXT_PUBLIC_API_PROXY === "1" ? "this site's own /api (forwarded)" : process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
    forwards_to: target || "(not configured)",
    advisor_key_configured: Boolean(process.env.ADVISOR_GATEWAY_KEY),
    vercel_env: process.env.VERCEL_ENV ?? null,
    server_to_gateway,
  });
}
