import os
from dotenv import load_dotenv

load_dotenv()


def _bool(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


DEMO_MODE = _bool(os.getenv("DEMO_MODE"), default=True)

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX = os.getenv("PINECONE_INDEX", "sovereignfabric-cache")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sovereignfabric.db")
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

# In demo mode we never had real production integrations configured, so if
# someone flips DEMO_MODE off without supplying keys we fail loudly instead
# of silently pretending to call a live vendor.
if not DEMO_MODE:
    missing = [
        name
        for name, val in [
            ("OPENAI_API_KEY", OPENAI_API_KEY),
            ("PINECONE_API_KEY", PINECONE_API_KEY),
            ("SUPABASE_URL", SUPABASE_URL),
            ("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY),
        ]
        if not val
    ]
    if missing:
        raise RuntimeError(
            f"DEMO_MODE=false but missing production credentials: {', '.join(missing)}"
        )
