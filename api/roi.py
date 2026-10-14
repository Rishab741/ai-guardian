"""
Enterprise value projection: turns the small, literal dollar figures observed
in a demo-scale pilot into a defensible "what this is worth at your
organization's real volume" number.

Two components, kept separate rather than blended into one hand-wavy figure:

1. FinOps compute savings — a mechanical calculation: the per-request savings
   rate actually observed in the pilot (real, measured, tiny) multiplied by a
   realistic enterprise request volume (employees x queries/day x 365). This
   is the "bottom-up, audit-able" number.

2. Risk-adjusted exposure avoidance — the average cost of a single reportable
   data breach (industry-cited figure, not multiplied by exposure count,
   which would wildly overstate the number). The pilot's own PII-exposure
   count is shown as evidence of live risk, not as a multiplier. This is the
   "what's actually at stake" number, and for a compliance/governance product
   it is the dominant, and most defensible, driver of value.

Presets model realistic Australian-enterprise scale; all inputs are
overridable so the number is never presented as fixed or unfalsifiable.
"""
from datetime import datetime, timedelta

import db

# Widely-cited industry figure (IBM Cost of a Data Breach Report, global/AU
# figures have run in the $4-4.5M USD range for several consecutive years).
# Exposed as an editable input, not asserted as a precise/current fact —
# verify against the latest report before citing in a live presentation.
DEFAULT_BREACH_COST_USD = 4_400_000

PRESETS = {
    "mid": {"label": "Mid-size enterprise", "employees": 5_000, "queries_per_day": 10},
    "large": {"label": "Large enterprise", "employees": 25_000, "queries_per_day": 20},
    "major": {"label": "Major bank / insurer", "employees": 50_000, "queries_per_day": 30},
}


async def compute(
    employees: int,
    queries_per_day: float,
    window_days: int = 14,
    breach_cost_usd: float = DEFAULT_BREACH_COST_USD,
) -> dict:
    since_ts = (datetime.utcnow() - timedelta(days=window_days)).isoformat()
    summary = await db.get_summary_stats(since_ts=since_ts)
    total_requests = summary["total_requests"]

    avg_savings_per_request = (summary["savings_usd"] / total_requests) if total_requests else 0.0

    daily_requests = employees * queries_per_day
    annual_requests = daily_requests * 365

    finops_annual_savings_usd = round(avg_savings_per_request * annual_requests, 2)
    total_annual_value_usd = round(finops_annual_savings_usd + breach_cost_usd, 2)

    return {
        "inputs": {
            "employees": employees,
            "queries_per_day": queries_per_day,
            "window_days": window_days,
            "breach_cost_usd": breach_cost_usd,
        },
        "observed": {
            # Real, small, pilot-scale evidence — deliberately NOT multiplied
            # up to enterprise scale, which would produce an implausible
            # headline number even though the arithmetic is "correct".
            "pilot_requests": total_requests,
            "pilot_pii_exposures": summary["total_pii_redactions"],
            "avg_savings_per_request_usd": round(avg_savings_per_request, 6),
        },
        "enterprise_daily_requests": int(daily_requests),
        "enterprise_annual_requests": int(annual_requests),
        "finops_annual_savings_usd": finops_annual_savings_usd,
        "risk_avoided_usd": breach_cost_usd,
        "risk_avoided_source": "IBM Cost of a Data Breach Report (industry average, editable assumption)",
        "total_annual_value_usd": total_annual_value_usd,
    }
