# What's needed from you

Everything the build depends on that only you can provide: accounts, keys and decisions. Nothing here needs a credit card unless marked.

## Already done

| Item | Status |
|---|---|
| Gemini API key | ✅ In `api/.env`. Works on the free tier with `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-embedding-001` |
| Local machine | ✅ Docker Desktop, Python venv and Node set up; demo runs with `.\start-demo.ps1` |

## Needed now

### 1. Push the code to GitHub (5 min)
Claude Code's permission check blocked me from publishing to GitHub, so run this yourself from the repo folder:
```powershell
git push -u origin feat/prod-demo
git push origin feat/prod-demo:master
```
History was checked before pushing: no API keys or real credentials are in any commit.

### 2. Hosted demo accounts (about 20 min, sign in with GitHub, no card)
Follow [DEPLOYMENT.md](../DEPLOYMENT.md) §C. These are the values each service needs:

| Service | What to create | Values you'll paste |
|---|---|---|
| **Neon** (database) | Project in AWS Singapore | Copy the **direct** connection string → Render `DATABASE_URL` |
| **Render** (gateway) | New Blueprint from this repo | `DATABASE_URL`, `GEMINI_API_KEY`, `CORS_ORIGINS` (your Vercel URL), `DEMO_ACCESS_CODE` (a code you choose). `DEMO_TOKEN_SECRET` and `SF_DEMO_APP_KEY` are generated for you |
| **Vercel** (console + Advisor Assist) | New project, root directory `web` | `NEXT_PUBLIC_API_URL` and `GATEWAY_URL` (your Render URL), `ADVISOR_GATEWAY_KEY` (Render's `SF_DEMO_APP_KEY`), optional `ADVISOR_DIRECT_API_KEY` (your Gemini key) |

### 3. Two decisions
- **Meeting date.** It sets how much of Phases 6–7 is done before you present.
- **Hosted access code.** Pick the code people type on the login screen of the public link.

## Optional

| Item | Why | Where | Cost |
|---|---|---|---|
| **Firebase project** (Spark plan) | Real "Sign in with Google" next to the demo personas | console.firebase.google.com → Authentication → Google. Give me the Project ID and Web API key; add your Vercel domain to Authorized domains | Free |
| **cloudflared** | A temporary public link to your laptop during the meeting | developers.cloudflare.com → downloads | Free, no account |
| **A second Gemini key** in a project with no billing | Keeps Gemini usage on the free tier if you later enable billing on the project that holds the current key | aistudio.google.com/apikey | Free |

## Later: production and real customers (not needed for the demo)

| Item | Why | Cost |
|---|---|---|
| Google Cloud billing account | The production hosting target in `docs/SYSTEM_DESIGN.md` | Card required; designed to stay inside the free tier with a $1 budget alert |
| Paid model access with no-training terms (Gemini on Vertex AI, Azure OpenAI or Anthropic) | Real customer data must never go to a free tier | Pay per use |
| Microsoft Entra ID app registration (or the bank's own) | Real SSO for the console and verified employee identity for apps. Provides the JWKS URL, issuer and audience for `END_USER_*` settings | Free with the bank's tenant |
| Bank-side: a read-only replica or API for one core system | Phase 6 context connector against real data rather than the mock | Per customer |
| Legal review of the employee notice | NSW workplace surveillance notice and Privacy Act wording | Lawyer |

## Phase 6–7 (next): nothing new needed from you
Name detection (Presidio), the read-replica connector mock, the evaluation bundle, the Helm chart and licence files all run locally with no new accounts.
