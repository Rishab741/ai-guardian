"""
Runtime configuration, read once from the environment (and api/.env in local
development). Every environment runs the same code; only these values differ.

DEMO_MODE no longer means "fake everything". It enables presenter-only
features (seeded history, persona switcher, simulator, reset). Whether model
calls are real is controlled separately by LLM_PROVIDER.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _bool(name: str, default: bool) -> bool:
    val = os.getenv(name)
    if val is None or val.strip() == "":
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    val = os.getenv(name)
    return int(val) if val and val.strip() else default


def _float(name: str, default: float) -> float:
    val = os.getenv(name)
    return float(val) if val and val.strip() else default


def _list(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


DEMO_MODE = _bool("DEMO_MODE", True)
ENVIRONMENT = os.getenv("ENVIRONMENT", "local")  # local | demo | production

DATABASE_URL = os.getenv("DATABASE_URL", "") or "postgresql://sf:sf_dev_password@localhost:5433/sovereignfabric"
DB_POOL_MAX = _int("DB_POOL_MAX", 5)

# "gemini" calls the real API; "simulated" returns deterministic canned
# answers (offline launcher, load tests, traffic simulator).
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")

# Model IDs live only here. Verified against this key's tier on 2026-10-14;
# re-check in AI Studio before a demo, since free-tier availability changes.
MODEL_FAST = os.getenv("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite")
MODEL_BALANCED = os.getenv("GEMINI_BALANCED_MODEL", "gemini-3.6-flash")
MODEL_DEEP = os.getenv("GEMINI_DEEP_MODEL", "gemini-3.8-flash")
EMBED_MODEL = os.getenv("GEMINI_EMBED_MODEL", "gemini-embedding-001")
EMBED_DIM = 768  # fixed by the cache_entries.embedding column
REASONING_EFFORT = os.getenv("GEMINI_REASONING_EFFORT", "low")

# Free-tier pacing per model (requests per minute / per day). Conservative
# defaults; the quota manager falls through to the next tier when exhausted.
MODEL_RPM = _int("MODEL_RPM", 10)
MODEL_RPD = _int("MODEL_RPD", 250)
PROVIDER_TIMEOUT_S = _float("PROVIDER_TIMEOUT_S", 25.0)
MODEL_COOLDOWN_S = _float("MODEL_COOLDOWN_S", 60.0)
# Last-resort fallback when every live model is unavailable. Responses are
# always labelled "simulated" in the trace and the audit log.
ALLOW_SIMULATED_FALLBACK = _bool("ALLOW_SIMULATED_FALLBACK", True)

CACHE_SIMILARITY_THRESHOLD = _float("CACHE_SIMILARITY_THRESHOLD", 0.92)
CACHE_TTL_HOURS = _int("CACHE_TTL_HOURS", 24)

DEFAULT_TENANT = os.getenv("DEFAULT_TENANT", "harbour")
# Stable key for the seeded "Advisor Assist" demo app. If unset, the seed step
# generates one and prints it once.
DEMO_APP_KEY = os.getenv("SF_DEMO_APP_KEY", "")

CORS_ORIGINS = _list("CORS_ORIGINS", "http://localhost:3000")
MAX_BODY_BYTES = _int("MAX_BODY_BYTES", 1_000_000)
MAX_MESSAGES = _int("MAX_MESSAGES", 128)


def validate() -> None:
    """Fail at startup rather than mid-demo."""
    if LLM_PROVIDER not in ("gemini", "simulated"):
        raise RuntimeError(f"LLM_PROVIDER must be 'gemini' or 'simulated', got {LLM_PROVIDER!r}")
    if LLM_PROVIDER == "gemini" and not GEMINI_API_KEY:
        raise RuntimeError("LLM_PROVIDER=gemini but GEMINI_API_KEY is not set")
