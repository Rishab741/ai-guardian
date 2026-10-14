# Deploying SovereignFabric to production (zero-cost stack)

This turns `DEMO_MODE=false`: real Gemini calls, a real Postgres database
with pgvector semantic search, and real Supabase Auth logins with
role/department-based access control — all on free tiers.

Demo mode (`DEMO_MODE=true`, the default) needs none of this and keeps
working exactly as before; this is only for when you want the real thing
live at a URL.

## 1. Supabase (database + auth) — free tier

1. Create a project at [supabase.com](https://supabase.com) (pick the Sydney
   region if offered, for AU data residency).
2. From **Settings -> API**, copy the **Project URL** (needed by both
   frontend and backend) and the **anon public** key (frontend only). You
   do *not* need the **service_role** key — this backend talks to Postgres
   directly over `DATABASE_URL`, never through Supabase's REST/Admin API,
   so that key has no role here.
3. Nothing else to copy for auth: the backend verifies login tokens via
   Supabase's **JWT Signing Keys** (JWKS), fetched automatically from the
   Project URL you already copied — no separate secret to configure. (This
   project does not use the older shared "JWT Secret" method Supabase has
   deprecated; if your project still shows only a legacy secret and no JWKS
   endpoint at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, open
   **Settings -> API -> JWT Keys** and switch it to the new signing-key
   system first.)
4. From **Settings -> Database -> Connection string**, copy the **Connection
   pooling** URI (the `...pooler.supabase.com:6543/...` one — better suited
   to a serverless/free-tier backend than the direct connection), substitute
   in your database password, and paste it as `DATABASE_URL` in `api/.env`.
5. Apply the schema — no need to touch the Supabase SQL editor:
   ```
   cd api
   venv\Scripts\python.exe scripts\apply_schema.py
   ```
   This enables `pgvector` and creates the `profiles`, `audit_logs`, and
   `cache_entries` tables with RLS policies. Safe to re-run.
6. **Assign your first admin**: sign up once through the app's `/login` page
   (locally against this project, or once deployed), then run:
   ```
   venv\Scripts\python.exe scripts\manage_user.py you@company.com --role admin
   ```
   An admin can chat as any department (for demos/sales walkthroughs);
   everyone else needs a department assigned the same way:
   ```
   venv\Scripts\python.exe scripts\manage_user.py jane@company.com --department finance
   ```

## 2. Google Gemini API key — free tier

Get a key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

## 3. Backend on Render — free tier

1. New **Web Service** at [render.com](https://render.com), connect this repo,
   set the root directory to `api/`, environment **Docker** (uses
   `api/Dockerfile`).
2. Environment variables:
   ```
   DEMO_MODE=false
   GEMINI_API_KEY=<from step 2>
   SUPABASE_URL=<from step 1.2>
   DATABASE_URL=<from step 1.4>
   CORS_ORIGINS=<your Vercel URL, added after step 4 — update and redeploy>
   ```
3. Deploy. Render's free tier sleeps after ~15 min idle; the first request
   after a sleep takes 30-60s to cold-start. Fine for a pilot; upgrade the
   plan later if that's not acceptable for real users.

## 4. Frontend on Vercel — free tier

1. Import this repo at [vercel.com](https://vercel.com), set the project
   root directory to `web/`.
2. Environment variables:
   ```
   NEXT_PUBLIC_API_URL=<your Render URL from step 3>
   NEXT_PUBLIC_SUPABASE_URL=<from step 1.2>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<from step 1.2 — the anon key, not service_role>
   ```
3. Deploy. Then go back to Render and set `CORS_ORIGINS` to this Vercel URL,
   and redeploy the backend so it accepts requests from it.

## Verifying it's actually live

- `curl https://<render-url>/api/health` should return `"demo_mode": false`.
- Sign up at `https://<vercel-url>/login`, have an admin assign your
  department (step 1.6), then chat — the sidebar footer will read
  "Production · live pipeline" instead of "Demo mode."
- Send the same prompt twice: the second should hit the real pgvector cache
  (visible in the compliance pipeline trace) instead of a fresh Gemini call.

## What this is *not*

Deploying this does **not** make it certified to handle real customer PII
under the Privacy Act or APRA CPS 230 — that needs a security audit, and
legal/compliance sign-off, which are outside the scope of this codebase.
Treat a live deployment as a real, working technical demonstration for a
pilot audience with synthetic/test data, not a production system authorized
to process real customer data, until that separate review has happened.
