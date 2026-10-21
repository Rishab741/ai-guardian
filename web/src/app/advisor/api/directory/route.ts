import { GATEWAY_KEY, GATEWAY_URL } from "../../server";

/** Fictional advisors the demo can sign in as (from the gateway's demo directory). */
export async function GET() {
  if (!GATEWAY_KEY) return Response.json([]);
  try {
    const r = await fetch(`${GATEWAY_URL}/api/demo/directory`, {
      headers: { Authorization: `Bearer ${GATEWAY_KEY}` },
      cache: "no-store",
    });
    return Response.json(r.ok ? await r.json() : []);
  } catch {
    return Response.json([]);
  }
}
