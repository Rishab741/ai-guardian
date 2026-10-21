import OpenAI, { APIError } from "openai";
import { DIRECT_BASE_URL, DIRECT_KEY, DIRECT_MODEL, GATEWAY_KEY, GATEWAY_URL, SYSTEM_PROMPT } from "../../server";

type Msg = { role: "user" | "assistant"; content: string };

function valid(messages: unknown): messages is Msg[] {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= 20 &&
    messages.every(
      (m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.length <= 4000,
    )
  );
}

export async function POST(req: Request) {
  const { mode, messages, advisorId } = (await req.json()) as { mode: string; messages: unknown; advisorId?: string };
  if (!valid(messages) || (mode !== "direct" && mode !== "gateway")) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const conversation = [{ role: "system" as const, content: SYSTEM_PROMPT }, ...messages];
  return mode === "direct" ? direct(conversation) : viaGateway(conversation, advisorId);
}

/** Before: the app calls the model provider itself. Everything typed goes out as-is. */
async function direct(conversation: { role: "system" | "user" | "assistant"; content: string }[]) {
  const outbound = {
    destination: `${DIRECT_BASE_URL}chat/completions`,
    body: { model: DIRECT_MODEL, messages: conversation },
  };
  if (!DIRECT_KEY) {
    return Response.json({ reply: null, inspectionOnly: true, outbound });
  }
  const client = new OpenAI({ baseURL: DIRECT_BASE_URL, apiKey: DIRECT_KEY, maxRetries: 1, timeout: 30_000 });
  try {
    const r = await client.chat.completions.create({ model: DIRECT_MODEL, messages: conversation });
    return Response.json({ reply: r.choices[0]?.message?.content ?? "", outbound });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Provider call failed.", outbound }, { status: 502 });
  }
}

/** After: one line changed. The same SDK call now goes to SovereignFabric. */
async function viaGateway(conversation: { role: "system" | "user" | "assistant"; content: string }[], advisorId?: string) {
  if (!GATEWAY_KEY) {
    return Response.json({ error: "ADVISOR_GATEWAY_KEY isn't set on the web server." }, { status: 500 });
  }

  // The bank's identity provider vouches for the signed-in advisor (simulated
  // here by the gateway's demo IdP).
  let userToken: string | undefined;
  if (advisorId) {
    const r = await fetch(`${GATEWAY_URL}/api/demo/idp-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GATEWAY_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: advisorId }),
      cache: "no-store",
    });
    if (r.ok) userToken = (await r.json()).token;
  }

  // Keep the raw response so a policy block's trace can be shown too.
  let lastBody: string | null = null;
  const client = new OpenAI({
    baseURL: `${GATEWAY_URL}/v1`,
    apiKey: GATEWAY_KEY,
    maxRetries: 0,
    timeout: 60_000,
    fetch: async (url, init) => {
      const res = await fetch(url, init);
      lastBody = await res.clone().text();
      return res;
    },
  });

  try {
    const r = await client.chat.completions.create(
      { model: "gpt-4o", messages: conversation },
      { headers: { "X-SF-Debug": "1", ...(userToken ? { "X-SF-User-Token": userToken } : {}) } },
    );
    const trace = (r as unknown as { sf_trace?: Record<string, unknown> }).sf_trace ?? null;
    return Response.json({ reply: r.choices[0]?.message?.content ?? "", trace });
  } catch (e) {
    let trace = null;
    try {
      trace = lastBody ? JSON.parse(lastBody).sf_trace ?? null : null;
    } catch {}
    if (e instanceof APIError) {
      return Response.json({ blocked: e.status === 403, error: e.message, trace }, { status: e.status === 403 ? 200 : 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "Gateway call failed." }, { status: 502 });
  }
}
