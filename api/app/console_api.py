"""
Console API (/api/*), used by the executive console web app.

Phase 1 keeps the existing endpoint shapes so the current UI keeps working
on the new pipeline and audit trail. Phase 2 puts every route here behind
role checks; until then these are open and must not be exposed publicly.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import audit, cache, config, db, gateway, routing, stats
from .gateway import Caller, GatewayError
from .providers import ChatParams

router = APIRouter(prefix="/api")
TENANT = config.DEFAULT_TENANT

# Industry-cited average cost of a reportable breach (IBM Cost of a Data
# Breach). An editable assumption; verify against the latest report.
DEFAULT_BREACH_COST_USD = 4_400_000
ROI_PRESETS = {
    "mid": {"label": "Mid-size enterprise", "employees": 5_000, "queries_per_day": 10},
    "large": {"label": "Large enterprise", "employees": 25_000, "queries_per_day": 20},
    "major": {"label": "Major bank / insurer", "employees": 50_000, "queries_per_day": 30},
}


class PlaygroundRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    department: str = "retail_banking"
    user_label: str | None = None


@router.get("/health")
async def health():
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("select 1")
    return {
        "status": "ok",
        "demo_mode": config.DEMO_MODE,
        "environment": config.ENVIRONMENT,
        "llm_provider": config.LLM_PROVIDER,
        "models": {"fast": config.MODEL_FAST, "balanced": config.MODEL_BALANCED, "deep": config.MODEL_DEEP,
                   "embed": config.EMBED_MODEL},
        "cache_size": await cache.size(TENANT),
        "quota": routing.quota.snapshot(),
    }


@router.get("/departments")
async def departments():
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("select id, label from departments where tenant_id = $1 order by label", TENANT)
    return [dict(r) for r in rows]


@router.get("/me")
async def me():
    return None  # console sessions arrive in Phase 2


@router.post("/demo/reset")
async def reset_demo():
    """Clears the semantic cache so the miss-then-hit story works on stage.
    The audit trail is append-only and is never reset."""
    if not config.DEMO_MODE:
        raise HTTPException(404)
    return {"cache_entries_cleared": await cache.clear(TENANT)}


@router.post("/chat")
async def playground(req: PlaygroundRequest):
    """Console playground: same pipeline as /v1, attributed to the console."""
    caller = Caller(
        tenant_id=TENANT, source="console", endpoint="/api/chat", department=req.department,
        app_name="Console Playground", end_user_label=req.user_label,
    )
    try:
        p = await gateway.prepare(caller, [{"role": "user", "content": req.message}], "sf-auto", ChatParams())
        o = await gateway.complete(p)
    except GatewayError as e:
        if e.audit_id is None:
            return JSONResponse({"detail": e.message}, status_code=e.status)
        return _chat_response(
            audit_id=e.audit_id, allowed=False, response=f"Blocked by policy: {e.message}",
            department_label=e.department_label or req.department, trace=e.trace,
        )
    return _chat_response(
        audit_id=o.audit_id, allowed=True, response=o.text, department_label=p.decision.department_label,
        cache_hit=o.cache_hit, model_used=o.model_used, model_label=routing.TIER_LABELS.get(o.tier, "Cache"),
        tier=o.tier, cost_usd=o.cost_usd, latency_ms=o.latency_ms, redactions=o.redactions, trace=o.trace,
        prompt_redacted=p.prompt_redacted, response_redacted=o.response_redacted,
    )


def _chat_response(*, audit_id, allowed, response, department_label, trace, cache_hit=False, model_used=None,
                   model_label=None, tier=None, cost_usd=0.0, latency_ms=0, redactions=None,
                   prompt_redacted=None, response_redacted=None) -> dict:
    return {
        "audit_id": audit_id, "allowed": allowed, "response": response, "department_label": department_label,
        "cache_hit": cache_hit, "model_used": model_used, "model_label": model_label, "tier": tier,
        "cost_usd": cost_usd, "latency_ms": latency_ms, "redactions": redactions or [],
        "pipeline": [s.__dict__ for s in trace],
        "prompt_redacted": prompt_redacted, "response_redacted": response_redacted,
    }


@router.get("/stats/summary")
async def stats_summary():
    return await stats.summary(TENANT)


@router.get("/stats/departments")
async def stats_departments():
    return await stats.departments(TENANT)


@router.get("/stats/pii-types")
async def stats_pii_types():
    return await stats.pii_types(TENANT)


@router.get("/stats/timeseries")
async def stats_timeseries(days: int = 14):
    return await stats.timeseries(TENANT, min(max(days, 1), 365))


@router.get("/stats/risky-users")
async def stats_risky_users(window_days: int = 30, limit: int = 10):
    return await stats.risky_users(TENANT, _since(window_days), min(limit, 50))


@router.get("/audit-logs")
async def audit_logs(limit: int = 50, department: str | None = None, user: str | None = None):
    if limit > 500:
        raise HTTPException(400, "limit too large")
    return await stats.recent(TENANT, limit, department, user)


@router.get("/audit/verify")
async def audit_verify():
    return await audit.verify(TENANT)


@router.get("/roi-presets")
def roi_presets():
    return ROI_PRESETS


@router.get("/roi-projection")
async def roi_projection(employees: int = 25_000, queries_per_day: float = 20, window_days: int = 14,
                         breach_cost_usd: float = DEFAULT_BREACH_COST_USD):
    s = await stats.summary(TENANT, _since(window_days))
    total = s["total_requests"]
    per_request = s["savings_usd"] / total if total else 0.0
    daily = employees * queries_per_day
    finops = round(per_request * daily * 365, 2)
    return {
        "inputs": {"employees": employees, "queries_per_day": queries_per_day, "window_days": window_days,
                   "breach_cost_usd": breach_cost_usd},
        "observed": {"pilot_requests": total, "pilot_pii_exposures": s["total_pii_redactions"],
                     "avg_savings_per_request_usd": round(per_request, 6)},
        "enterprise_daily_requests": int(daily),
        "enterprise_annual_requests": int(daily * 365),
        "finops_annual_savings_usd": finops,
        "risk_avoided_usd": breach_cost_usd,
        "risk_avoided_source": "IBM Cost of a Data Breach Report (industry average, editable assumption)",
        "total_annual_value_usd": round(finops + breach_cost_usd, 2),
    }


@router.get("/discovery-report")
async def discovery_report(window_days: int = 14):
    since = _since(window_days)
    summary = await stats.summary(TENANT, since)
    depts = await stats.departments(TENANT, since)
    findings = []
    for row in depts:
        if row["pii_redactions"] > 0:
            findings.append({
                "severity": "high" if row["pii_redactions"] > 15 else "medium",
                "title": f"Sensitive data in {row['department_label']} AI traffic",
                "detail": (f"{row['pii_redactions']} sensitive field(s) appeared across {row['requests']} AI requests "
                           f"from {row['department_label']} in the window. Each was tokenized before leaving the "
                           f"boundary; without the gateway they would have reached the model provider as-is."),
            })
        if row["blocked_requests"] > 0:
            findings.append({
                "severity": "medium",
                "title": f"Policy violations intercepted in {row['department_label']}",
                "detail": (f"{row['blocked_requests']} request(s) from {row['department_label']} were blocked for "
                           f"attempting to send out-of-entitlement data classes to an external model."),
            })
    findings.sort(key=lambda f: 0 if f["severity"] == "high" else 1)
    return {
        "summary": summary,
        "department_breakdown": depts,
        "pii_type_breakdown": await stats.pii_types(TENANT, since),
        "findings": findings,
        "observed_days": window_days,
        "projected_annual_savings_usd": round(summary["savings_usd"] / window_days * 365, 2) if summary["total_requests"] else 0,
    }


def _since(window_days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=window_days)
