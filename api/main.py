from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config
import database
import model_router
import policy
import redaction
import roi
import seed_data
from schemas import ChatRequest, ChatResponse, PipelineStep, RedactionOut
from semantic_cache import cache as semantic_cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    seed_data.seed_if_empty()
    yield


app = FastAPI(title="SovereignFabric AI Control Gateway", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "demo_mode": config.DEMO_MODE, "cache_size": semantic_cache.size()}


@app.get("/api/departments")
def departments():
    return [{"id": k, "label": v["label"]} for k, v in policy.DEPARTMENTS.items()]


@app.post("/api/demo/reset")
def reset_demo():
    """Clear the in-memory semantic cache. Run this right before presenting so
    rehearsal traffic doesn't leave stale cache hits that break the
    miss-then-hit narrative of the guided demo. Audit history is untouched."""
    cleared = semantic_cache.size()
    semantic_cache.clear()
    return {"cache_entries_cleared": cleared}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    pipeline: list[PipelineStep] = []

    # Step 2 runs before step 1's final verdict because the policy engine
    # needs to know which data classes are present in this specific prompt.
    redaction_result = redaction.redact(req.message)
    detected_types = [r.pii_type for r in redaction_result.redactions]

    decision = policy.check(req.department, detected_types)
    pipeline.append(
        PipelineStep(
            step="auth_policy",
            label="Auth & Policy Check",
            status="ok" if decision.allowed else "blocked",
            detail=decision.reason or f"Entitlements verified for {decision.department_label}.",
        )
    )
    pipeline.append(
        PipelineStep(
            step="redaction",
            label="PII/PHI Redaction",
            status="ok",
            detail=(
                f"{len(redaction_result.redactions)} sensitive field(s) tokenized: "
                + ", ".join(sorted(set(detected_types))) if redaction_result.redactions
                else "No sensitive identifiers detected."
            ),
        )
    )

    if not decision.allowed:
        audit_id = database.insert_audit_log(
            department=req.department,
            department_label=decision.department_label,
            user_label=req.user_label,
            prompt_redacted=redaction_result.redacted_text,
            response_redacted="[request blocked by policy]",
            cache_hit=0,
            model_used=None,
            model_label=None,
            tier=None,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0,
            cost_if_no_cache=0,
            latency_ms=0,
            policy_allowed=0,
            policy_reason=decision.reason,
            pii_types=detected_types,
            pii_count=len(detected_types),
        )
        pipeline.append(PipelineStep(step="cache", label="Semantic Cache Lookup", status="ok", detail="Skipped — request blocked."))
        pipeline.append(PipelineStep(step="routing", label="Model Routing", status="ok", detail="Skipped — request blocked."))
        pipeline.append(PipelineStep(step="audit", label="Audit Logging", status="ok", detail=f"Blocked request logged as audit #{audit_id}."))
        return ChatResponse(
            audit_id=audit_id,
            allowed=False,
            response=f"Blocked by policy: {decision.reason}",
            department_label=decision.department_label,
            cache_hit=False,
            model_used=None,
            model_label=None,
            tier=None,
            cost_usd=0,
            latency_ms=0,
            redactions=[RedactionOut(pii_type=r.pii_type, token=r.token) for r in redaction_result.redactions],
            pipeline=pipeline,
        )

    cache_result = semantic_cache.lookup(redaction_result.redacted_text)
    if cache_result:
        entry, score = cache_result
        pipeline.append(
            PipelineStep(
                step="cache",
                label="Semantic Cache Lookup",
                status="hit",
                detail=f"Matched a prior equivalent query ({score:.0%} similarity) — model call avoided.",
            )
        )
        response_text = entry.response
        model_used, model_label, tier = entry.model_used, entry.model_used, "cached"
        cost_usd, latency_ms = 0.0, 35
        _, would_be_cost = model_router.estimate_cost(redaction_result.redacted_text, response_text)
        pipeline.append(PipelineStep(step="routing", label="Model Routing", status="ok", detail="Served from cache — no model call made."))
    else:
        pipeline.append(PipelineStep(step="cache", label="Semantic Cache Lookup", status="miss", detail="No sufficiently similar prior prompt found."))
        gen = await model_router.generate(redaction_result.redacted_text)
        response_text = gen.text
        model_used, model_label, tier = gen.model_used, gen.model_label, gen.tier
        cost_usd, latency_ms = gen.cost_usd, gen.latency_ms
        would_be_cost = gen.cost_usd
        semantic_cache.store(redaction_result.redacted_text, gen.text, gen.model_used)
        pipeline.append(
            PipelineStep(
                step="routing",
                label="Model Routing",
                status="ok",
                detail=f"Routed to {gen.model_label} ({gen.model_used}) based on query complexity.",
            )
        )

    audit_id = database.insert_audit_log(
        department=req.department,
        department_label=decision.department_label,
        user_label=req.user_label,
        prompt_redacted=redaction_result.redacted_text,
        response_redacted=response_text,
        cache_hit=int(bool(cache_result)),
        model_used=model_used,
        model_label=model_label,
        tier=tier,
        input_tokens=model_router.estimate_input_tokens(redaction_result.redacted_text),
        output_tokens=len(response_text) // 4,
        cost_usd=cost_usd,
        cost_if_no_cache=would_be_cost,
        latency_ms=latency_ms,
        policy_allowed=1,
        policy_reason=None,
        pii_types=detected_types,
        pii_count=len(detected_types),
    )
    pipeline.append(PipelineStep(step="audit", label="Audit Logging", status="ok", detail=f"Structured record written as audit #{audit_id}."))

    return ChatResponse(
        audit_id=audit_id,
        allowed=True,
        response=response_text,
        department_label=decision.department_label,
        cache_hit=bool(cache_result),
        model_used=model_used,
        model_label=model_label,
        tier=tier,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        redactions=[RedactionOut(pii_type=r.pii_type, token=r.token) for r in redaction_result.redactions],
        pipeline=pipeline,
    )


@app.get("/api/stats/summary")
def stats_summary():
    return database.get_summary_stats()


@app.get("/api/stats/departments")
def stats_departments():
    return database.get_department_breakdown()


@app.get("/api/stats/pii-types")
def stats_pii_types():
    return database.get_pii_type_breakdown()


@app.get("/api/stats/timeseries")
def stats_timeseries(days: int = 14):
    return database.get_daily_timeseries(days=days)


@app.get("/api/audit-logs")
def audit_logs(limit: int = 50, department: str | None = None):
    if limit > 500:
        raise HTTPException(400, "limit too large")
    return database.get_recent_logs(limit=limit, department=department)


@app.get("/api/roi-presets")
def roi_presets():
    return roi.PRESETS


@app.get("/api/roi-projection")
def roi_projection(
    employees: int = 25_000,
    queries_per_day: float = 20,
    window_days: int = 14,
    breach_cost_usd: float = roi.DEFAULT_BREACH_COST_USD,
):
    return roi.compute(employees, queries_per_day, window_days, breach_cost_usd)


@app.get("/api/discovery-report")
def discovery_report(window_days: int = 14):
    """Mirrors the 'Shadow Audit Wedge' pitch: a rolling recent window (the
    passive pilot), regardless of how much total history the audit log
    holds. Full-history trends live on /api/stats/* for the dashboard."""
    since_ts = (datetime.utcnow() - timedelta(days=window_days)).isoformat()
    summary = database.get_summary_stats(since_ts=since_ts)
    dept_breakdown = database.get_department_breakdown(since_ts=since_ts)
    pii_breakdown = database.get_pii_type_breakdown(since_ts=since_ts)
    observed_days = window_days

    findings = []
    for row in dept_breakdown:
        if row["pii_redactions"] > 0:
            findings.append(
                {
                    "severity": "high" if row["pii_redactions"] > 15 else "medium",
                    "title": f"Unmonitored PII exposure in {row['department_label']}",
                    "detail": (
                        f"{row['pii_redactions']} sensitive field(s) were present across {row['requests']} "
                        f"AI requests from {row['department_label']} over the observed window, previously "
                        f"flowing to external LLM vendors with no redaction, policy check, or audit trail."
                    ),
                }
            )
        if row["blocked_requests"] > 0:
            findings.append(
                {
                    "severity": "medium",
                    "title": f"Policy violations intercepted in {row['department_label']}",
                    "detail": (
                        f"{row['blocked_requests']} request(s) from {row['department_label']} were blocked "
                        f"for attempting to route out-of-entitlement data classes to an external model."
                    ),
                }
            )
    findings.sort(key=lambda f: 0 if f["severity"] == "high" else 1)

    daily_rate = summary["savings_usd"] / observed_days
    projected_annual_savings = round(daily_rate * 365, 2) if summary["total_requests"] else 0

    return {
        "summary": summary,
        "department_breakdown": dept_breakdown,
        "pii_type_breakdown": pii_breakdown,
        "findings": findings,
        "observed_days": observed_days,
        "projected_annual_savings_usd": projected_annual_savings,
    }
