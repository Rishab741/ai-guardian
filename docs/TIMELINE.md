# SovereignFabric — Production Demo Timeline

Companion to [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md). Working days only, starting Wed 14 Oct 2026.
Status: ✅ done · 🔨 in progress · ⏳ not started · 🙋 needs you

| Phase | Dates | Scope | Exit criteria | Status |
|---|---|---|---|---|
| **0. Fix and freeze** | Wed 14 Oct | Snapshot commit on `feat/prod-demo`; verify Gemini key and live models; local Postgres + pgvector in Docker; move model IDs into config | Live Gemini answer through the gateway | ✅ |
| **1. Gateway core** | 14 – 19 Oct | Postgres-only data layer + migrations; `/v1/chat/completions` (+ streaming), `/v1/models`, `/v1/embeddings`; app API keys; ordinal tokens + re-hydration (stream-safe); output scan; partitioned semantic cache; tier routing + quota-aware fallback; hash-chained audit; existing `/api/*` console endpoints ported | OpenAI SDK contract tests pass against the gateway; existing console still works | ✅ (NER deferred to Phase 6) |
| **2. Security and RBAC** | 15 Oct | Identity Platform login (replaces Supabase); roles; `require_role` on every `/api/*`; persona switcher (demo); verified end-user JWT header | RBAC matrix test green | ✅ (personas + simulated SSO; Firebase Google sign-in ready, needs a project) |
| **3. Free hosted deployment (no card)** | 15 Oct | Render Blueprint (gateway, Docker, free), Neon Postgres + pgvector (free), Vercel (console, free), optional Firebase Spark for Google sign-in; laptop + Cloudflare tunnel option; hosted-config safety checks. Google Cloud stays the production target once billing works | Public URL works at $0 | 🔨 files ready; 🙋 needs your sign-ups (see DEPLOYMENT.md) |
| **4. Console v2** | 15 Oct | Onboarding wizard; command centre with live SSE feed; risk drill-down by user/app; policy editor + simulator + approvals; CPS 230/234 evidence pack | Full demo script clickable | ✅ (live feed, People & Apps, policy approvals with impact simulation, evidence pack, setup wizard) |
| **5. Demo assets** | 22 Oct | "Advisor Assist" mock app (one-line `baseURL` swap); synthetic workforce; browser-driven traffic simulator; presenter control panel | Two clean cold-start rehearsals | ✅ (Advisor Assist with live one-line switch and payload inspector, simulator scenarios, presenter panel, run-of-show in DEMO_SCRIPT.md) |
| **6. Connector mock + packaging** | 3 – 4 Nov | Read-replica mock via tool calling; NER (Presidio); docker-compose evaluation bundle; Helm chart; signed license files | `docker compose up` works offline | ⏳ |
| **7. Hardening** | 5 – 6 Nov | Red-team PII set, threat model, runbook, rehearsal | Demo-ready | ⏳ |

**If the investor meeting is before 30 Oct,** the minimum cut is Phases 1, 2 and 5 (Advisor Assist + simulator), run locally with the offline launcher, with Phase 3 hosting following.

## What you need to provide (🙋)

See [REQUIREMENTS.md](REQUIREMENTS.md) for the full list of accounts, keys and decisions.

## Findings from Phase 0

- Gemini key verified. Working on this key's tier: `gemini-3.5-flash-lite` (fast, ~1.1 s), `gemini-3.6-flash` (balanced, ~2.3 s), `gemini-embedding-001` @ 768 dims.
- `gemini-3.8-flash` returns intermittent 503 "high demand"; `gemini-4-argon` has no free-tier quota (429); `gemini-2.5-pro` is gone for new users (404). The old config (`gemini-2.0-flash`, `text-embedding-004`) was fully broken. **The fallback chain is required.**
- Models preserve `⟦AU_TFN_1⟧` placeholders verbatim, which confirms the token design.
