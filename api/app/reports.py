"""
APRA evidence pack: audit-trail facts arranged by the control areas a
CPS 234 (information security) and CPS 230 (operational risk, material
service providers) review asks about. It is supporting evidence for those
reviews, not a compliance determination.
"""
from datetime import datetime, timedelta, timezone

from . import audit, db, stats
from .redaction import PII_LABELS


async def evidence(tenant_id: str, days: int) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        tenant = await conn.fetchrow("select name, settings from tenants where id = $1", tenant_id)
        providers = await conn.fetch(
            """
            select coalesce(provider, 'none') as provider, model_used, count(*) as calls,
                   count(*) filter (where decision = 'error') as errors,
                   percentile_cont(0.5) within group (order by latency_ms) as p50_ms,
                   percentile_cont(0.95) within group (order by latency_ms) as p95_ms
            from audit_events
            where tenant_id = $1 and ts >= $2 and decision <> 'blocked' and model_used is not null
            group by 1, 2 order by calls desc
            """,
            tenant_id, since,
        )
        fallbacks = await conn.fetchval(
            "select count(*) from audit_events where tenant_id = $1 and ts >= $2 and cardinality(fallbacks) > 0",
            tenant_id, since,
        )
        simulated = await conn.fetchval(
            "select count(*) from audit_events where tenant_id = $1 and ts >= $2 and provider = 'simulated' and source <> 'simulator'",
            tenant_id, since,
        )
        console_users = await conn.fetch(
            "select display_name, title, role, last_login_at from console_users where tenant_id = $1 order by role, display_name",
            tenant_id,
        )
        changes = await conn.fetch(
            """select ts, actor, actor_role, action, target, detail from admin_events
               where tenant_id = $1 and ts >= $2 order by ts desc limit 100""",
            tenant_id, since,
        )
        policies = await conn.fetch(
            """select version, status, created_by, created_at, approved_by, approved_at, note
               from policies where tenant_id = $1 order by version desc limit 10""",
            tenant_id,
        )
        flags = await conn.fetchval(
            "select count(*) from audit_events where tenant_id = $1 and ts >= $2 and 'prompt_injection' = any(flags)",
            tenant_id, since,
        )
        verified = await conn.fetchval(
            "select count(*) from audit_events where tenant_id = $1 and ts >= $2 and user_verified", tenant_id, since,
        )

    summary = await stats.summary(tenant_id, since)
    total_calls = sum(p["calls"] for p in providers) or 1
    return {
        "tenant": tenant["name"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": {"from": since.isoformat(), "to": datetime.now(timezone.utc).isoformat(), "days": days},
        "summary": summary,
        "cps234": {
            "classification": [
                {"data_class": r["pii_type"], "label": PII_LABELS.get(r["pii_type"], r["pii_type"]), "occurrences": r["count"]}
                for r in await stats.pii_types(tenant_id, since)
            ],
            "access_control": [
                {**dict(u), "last_login_at": u["last_login_at"].isoformat() if u["last_login_at"] else None}
                for u in console_users
            ],
            "identity_coverage": {"verified_requests": verified, "total_requests": summary["total_requests"]},
            "detection": {
                "blocked_requests": summary["blocked_requests"],
                "prompt_injection_flags": flags,
                "riskiest_users": await stats.risky_users(tenant_id, since, 5),
            },
            "audit_integrity": await audit.verify(tenant_id),
            "change_management": {
                "policy_versions": [
                    {**dict(p), "created_at": p["created_at"].isoformat(),
                     "approved_at": p["approved_at"].isoformat() if p["approved_at"] else None}
                    for p in policies
                ],
                "console_actions": [{**dict(c), "ts": c["ts"].isoformat()} for c in changes],
            },
        },
        "cps230": {
            "service_providers": [
                {**dict(p), "share": round(p["calls"] / total_calls, 3),
                 "p50_ms": float(p["p50_ms"] or 0), "p95_ms": float(p["p95_ms"] or 0)}
                for p in providers
            ],
            "resilience": {"requests_rerouted": fallbacks, "served_by_offline_fallback": simulated,
                           "cache_hit_rate": summary["cache_hit_rate"]},
        },
    }
