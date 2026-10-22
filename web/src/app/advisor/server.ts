/**
 * Server-side configuration for the Advisor Assist mock app. This is the
 * bank's own application: it holds its own credentials and talks to an AI
 * provider with the standard OpenAI SDK. The only thing SovereignFabric
 * changes is which base URL that SDK points at.
 */
export const GATEWAY_URL = process.env.GATEWAY_URL || process.env.SF_GATEWAY_TARGET || "http://localhost:8000";
export const GATEWAY_KEY = process.env.ADVISOR_GATEWAY_KEY ?? "";

export const DIRECT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
export const DIRECT_KEY = process.env.ADVISOR_DIRECT_API_KEY ?? "";
export const DIRECT_MODEL = process.env.ADVISOR_DIRECT_MODEL ?? "gemini-3.5-flash-lite";

export const SYSTEM_PROMPT =
  "You are Advisor Assist, the internal assistant for Harbour Bank branch and phone advisors. " +
  "Answer in at most 120 words, in plain business English. Never invent figures, approvals or account details " +
  "that weren't given; say what information is still needed instead.";
