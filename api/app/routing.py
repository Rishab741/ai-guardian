"""
Tier selection, per-model quota tracking and the fallback chain.

A request gets a tier from a complexity heuristic (capped by policy), then is
tried against that tier's model and, if the model is rate-limited, overloaded,
retired or slow, the next one down the chain. Every hop is recorded so the
trace and audit log show exactly what happened.
"""
import re
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from . import config, db
from .providers import ProviderError

TIER_LABELS = {"fast": "Fast Tier", "balanced": "Balanced Tier", "deep": "Deep Reasoning Tier", "simulated": "Simulated (offline)"}

# List-price estimates per 1K tokens (USD), used to value cache hits and
# routing savings. Free-tier calls actually cost $0; these show what the
# same traffic would cost at paid rates. Editable assumptions.
PRICING = {
    "fast": {"in": 0.0001, "out": 0.0004},
    "balanced": {"in": 0.0003, "out": 0.0025},
    "deep": {"in": 0.00125, "out": 0.01},
    "simulated": {"in": 0.0, "out": 0.0},
}

_COMPLEX_RE = re.compile(
    r"\b(analy[sz]e|compare|strategy|forecast|risk|summar(?:y|ize|ise)|explain why|reconcile|audit|"
    r"compliance|projection|scenario|assess|evaluate)\b",
    re.IGNORECASE,
)

MODEL_ALIASES = {"sf-fast": "fast", "sf-balanced": "balanced", "sf-deep": "deep"}


def choose_tier(text: str, n_messages: int) -> str:
    words = len(text.split())
    if _COMPLEX_RE.search(text) or words > 150:
        return "deep"
    if words > 30 or n_messages > 4:
        return "balanced"
    return "fast"


def requested_tier(model: str | None) -> str | None:
    """Explicit tier from an sf-* alias; anything else (sf-auto, gpt-4o, …)
    means 'route automatically'."""
    return MODEL_ALIASES.get((model or "").lower())


def model_for(tier: str) -> str:
    return {"fast": config.MODEL_FAST, "balanced": config.MODEL_BALANCED, "deep": config.MODEL_DEEP}[tier]


def chain(tier: str) -> list[str]:
    order = {"deep": ["deep", "balanced", "fast"], "balanced": ["balanced", "fast"], "fast": ["fast", "balanced"]}[tier]
    if config.ALLOW_SIMULATED_FALLBACK:
        order.append("simulated")
    return order


def cost(tier: str, input_tokens: int, output_tokens: int) -> float:
    p = PRICING[tier]
    return round(input_tokens / 1000 * p["in"] + output_tokens / 1000 * p["out"], 6)


@dataclass
class Hop:
    tier: str
    model: str
    outcome: str  # ok | skipped:<why> | failed:<status>


@dataclass
class QuotaManager:
    """Requests-per-minute window kept in memory; requests-per-day counted
    in Postgres so every instance shares it. A model that fails with a
    retryable error is cooled down for a while instead of being hammered."""

    _windows: dict[str, deque] = field(default_factory=dict)
    _cooldown_until: dict[str, float] = field(default_factory=dict)

    def available(self, model: str) -> str | None:
        """None if usable now, else a short reason."""
        now = time.monotonic()
        if self._cooldown_until.get(model, 0) > now:
            return "cooling_down"
        window = self._windows.setdefault(model, deque())
        while window and now - window[0] > 60:
            window.popleft()
        if len(window) >= config.MODEL_RPM:
            return "rpm_limit"
        return None

    async def reserve(self, model: str) -> str | None:
        reason = self.available(model)
        if reason:
            return reason
        pool = await db.get_pool()
        async with pool.acquire() as conn:
            used = await conn.fetchval(
                """
                insert into model_quota_usage (model, day, requests) values ($1, $2, 1)
                on conflict (model, day) do update set requests = model_quota_usage.requests + 1
                returning requests
                """,
                model,
                _quota_day(),
            )
        if used > config.MODEL_RPD:
            return "daily_quota"
        self._windows[model].append(time.monotonic())
        return None

    def penalise(self, model: str, err: ProviderError) -> None:
        if err.retryable:
            self._cooldown_until[model] = time.monotonic() + config.MODEL_COOLDOWN_S

    def snapshot(self) -> dict:
        now = time.monotonic()
        return {
            m: {"cooling_down_s": max(0, round(self._cooldown_until.get(m, 0) - now)), "last_minute": len(w)}
            for m, w in self._windows.items()
        }


def _quota_day() -> date:
    # Gemini daily quotas reset at midnight Pacific; UTC-8 is close enough
    # for pacing without a timezone database.
    return datetime.fromtimestamp(time.time() - 8 * 3600, tz=timezone.utc).date()


quota = QuotaManager()
