import os
from dotenv import load_dotenv

load_dotenv()


def _bool(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


DEMO_MODE = _bool(os.getenv("DEMO_MODE"), default=True)

# Production stack: Gemini (LLM + embeddings) + Supabase (Postgres w/ pgvector, Auth).
# Chosen to keep the whole stack on free tiers — see the production-mode plan.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_FAST_MODEL = os.getenv("GEMINI_FAST_MODEL", "gemini-2.0-flash")
GEMINI_DEEP_MODEL = os.getenv("GEMINI_DEEP_MODEL", "gemini-2.5-pro")
GEMINI_EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "text-embedding-004")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
# Auth tokens are verified via Supabase's JWT Signing Keys (JWKS, asymmetric)
# rather than the legacy shared HS256 secret — see auth.py. No separate
# secret to configure: the JWKS endpoint is derived from SUPABASE_URL.
#
# Note: the backend never calls Supabase's REST/PostgREST or Admin API — it
# talks to Postgres directly over the wire protocol via DATABASE_URL, and
# reads auth.users directly for scripts/manage_user.py. That means the
# service_role key has no role in this codebase; it's deliberately not
# read here. If a future change adds a real REST/Admin API call, reintroduce
# it then rather than holding an unused secret today.

# Postgres connection string (Supabase's "connection pooling" URI in production;
# any Postgres works, e.g. for local dev against a self-hosted instance).
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sovereignfabric.db")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

# In demo mode we never had real production integrations configured, so if
# someone flips DEMO_MODE off without supplying keys we fail loudly instead
# of silently pretending to call a live vendor.
if not DEMO_MODE:
    missing = [
        name
        for name, val in [
            ("GEMINI_API_KEY", GEMINI_API_KEY),
            ("SUPABASE_URL", SUPABASE_URL),
            ("DATABASE_URL", DATABASE_URL if not DATABASE_URL.startswith("sqlite") else ""),
        ]
        if not val
    ]
    if missing:
        raise RuntimeError(
            f"DEMO_MODE=false but missing production credentials: {', '.join(missing)}"
        )
