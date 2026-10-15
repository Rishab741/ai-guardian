# Deploying the SovereignFabric demo

Three ways to run it, from most to least reliable for a live meeting. None needs a credit card.

| Option | What it is | Use it for |
|---|---|---|
| **A. Laptop** | Everything on your machine (`start-demo.ps1`) | The meeting itself |
| **B. Laptop + tunnel** | A, plus a temporary public link to your laptop | Letting someone open it on their own device during the meeting |
| **C. Hosted** | Render (gateway) + Neon (database) + Vercel (console), all on free plans | An always-available link to share before/after |

The gateway is one Docker image plus a Postgres database in every option. A bank deployment runs the same image inside the bank's own network, so where the demo is hosted doesn't affect the product story.

---

## A. Laptop (recommended for the meeting)

Prerequisites: Docker Desktop, Python 3.12+, Node 20+.

```powershell
# one-time setup
cd api; python -m venv venv; venv\Scripts\pip install -r requirements-dev.txt; copy .env.example .env   # then fill GEMINI_API_KEY
cd ..\web; npm install; copy .env.example .env.local

# every time
.\start-demo.ps1            # live Gemini
.\start-demo.ps1 -Offline   # no internet needed: simulated model answers, everything else identical
.\stop-demo.ps1
```

Open http://localhost:3000, click **Continue with Microsoft Entra ID** and pick a persona.

## B. Public link to your laptop (free, no account)

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. With the demo running, open two terminals:
   ```powershell
   cloudflared tunnel --url http://localhost:8000   # prints https://<random>.trycloudflare.com  (gateway)
   cloudflared tunnel --url http://localhost:3000   # prints another URL                          (console)
   ```
3. Point the console at the public gateway URL and allow it through CORS, then restart the demo:
   - `web\.env.local`: `NEXT_PUBLIC_API_URL=https://<gateway-url>`
   - `api\.env`: `CORS_ORIGINS=http://localhost:3000,https://<console-url>` and set `DEMO_ACCESS_CODE` to something only you know
4. Share the console URL. It stops working when you close the terminals.

## C. Hosted (Render + Neon + Vercel)

Before you start: push this branch to GitHub and merge it into `master` (Render and Vercel deploy from GitHub).

### 1. Database: Neon (free)
1. Sign up at [neon.tech](https://neon.tech) and create a project in **AWS Asia Pacific (Singapore)**.
2. Copy the connection string with **connection pooling turned off** (the direct one; the hostname has no `-pooler`). The gateway uses Postgres features a pooler doesn't support.
3. Nothing else: the gateway creates its tables and enables `pgvector` on first start.

### 2. Gateway: Render (free)
1. Sign up at [render.com](https://render.com) with GitHub.
2. **New → Blueprint**, pick this repository. Render reads `render.yaml`.
3. Fill in the prompted values:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | the Neon direct connection string |
   | `GEMINI_API_KEY` | your key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
   | `CORS_ORIGINS` | your Vercel URL from step 3 (set a placeholder first, update it after) |
   | `DEMO_ACCESS_CODE` | a code you'll type on the login screen |
4. Deploy. The first start seeds ~3,200 synthetic events (about 30 s). Check `https://<service>.onrender.com/api/health`.

The free plan sleeps after ~15 minutes without traffic; the next request takes up to a minute to wake it. **Open the console 2 minutes before you present.**

### 3. Console: Vercel (free Hobby plan)
1. Sign up at [vercel.com](https://vercel.com) with GitHub → **Add New → Project** → this repo.
2. **Root Directory:** `web`. **Environment variable:** `NEXT_PUBLIC_API_URL=https://<service>.onrender.com`.
3. Deploy, then put the Vercel URL into Render's `CORS_ORIGINS` (Render redeploys automatically).

### 4. Optional: real Google sign-in (Firebase Spark, free)
Personas are enough for a demo. To also allow real accounts:
1. [console.firebase.google.com](https://console.firebase.google.com) → new project (stay on the free **Spark** plan) → **Authentication → Sign-in method → Google**.
2. **Authentication → Settings → Authorized domains:** add your Vercel domain.
3. **Project settings → General:** copy the Project ID and Web API key into Render as `FIREBASE_PROJECT_ID` and `FIREBASE_WEB_API_KEY`, and add your email to `CONSOLE_BOOTSTRAP_ADMINS`.

### Calling the hosted gateway like a bank app would
Render's environment page shows the generated `SF_DEMO_APP_KEY` (the "Advisor Assist" app key):
```python
from openai import OpenAI
client = OpenAI(base_url="https://<service>.onrender.com/v1", api_key="<SF_DEMO_APP_KEY>")
client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "Confirm TFN 123 456 782"}])
```

## Things to know

- **Synthetic data only.** The Gemini free tier allows Google to review and train on prompts. The gateway redacts identifiers first, but never put real customer data through the hosted demo.
- **Gemini free-tier limits** are per model per day. When a model is busy or out of quota the gateway falls back to the next tier, and finally to clearly labelled simulated answers.
- **Google Cloud** remains the production target (see `docs/SYSTEM_DESIGN.md` §3.3). Nothing here needs to change to move there later: same image, same database schema, different hosting.
