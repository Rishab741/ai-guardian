"""Read-side queries over the audit trail for the executive console."""
from datetime import datetime, timedelta, timezone

from . import db

_ALLOWED = "decision = 'allowed'"


def _since(window_days: int | None):
    return datetime.now(timezone.utc) - timedelta(days=window_days) if window_days else None


async def summary(tenant_id: str, since: datetime | None = None) -> dict:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"""
            select count(*) as total_requests,
                   count(*) filter (where cache_hit) as cache_hits,
                   coalesce(sum(pii_count), 0) as total_pii_redactions,
                   coalesce(sum(cost_usd), 0) as total_cost,
                   coalesce(sum(cost_if_no_cache), 0) as total_cost_if_no_cache,
                   count(*) filter (where decision = 'blocked') as blocked_requests,
                   coalesce(avg(latency_ms) filter (where {_ALLOWED}), 0) as avg_latency_ms,
                   count(distinct end_user_id) as active_users,
                   count(*) filter (where end_user_id is not null) as attributed_requests
            from audit_events
            where tenant_id = $1 and ($2::timestamptz is null or ts >= $2)
            """,
            tenant_id, since,
        )
    d = dict(row)
    total = d["total_requests"]
    d["avg_latency_ms"] = float(d["avg_latency_ms"])
    d["cache_hit_rate"] = d["cache_hits"] / total if total else 0
    d["savings_usd"] = round(d["total_cost_if_no_cache"] - d["total_cost"], 4)
    d["savings_pct"] = round(d["savings_usd"] / d["total_cost_if_no_cache"] * 100, 1) if d["total_cost_if_no_cache"] > 0 else 0
    d["identity_coverage"] = d["attributed_requests"] / total if total else 0
    return d


async def departments(tenant_id: str, since: datetime | None = None) -> list[dict]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select department, max(department_label) as department_label, count(*) as requests,
                   coalesce(sum(pii_count), 0) as pii_redactions,
                   count(*) filter (where cache_hit) as cache_hits,
                   coalesce(sum(cost_usd), 0) as cost_usd,
                   count(*) filter (where decision = 'blocked') as blocked_requests
            from audit_events
            where tenant_id = $1 and ($2::timestamptz is null or ts >= $2)
            group by department
            order by requests desc
            """,
            tenant_id, since,
        )
    return [dict(r) for r in rows]


async def pii_types(tenant_id: str, since: datetime | None = None) -> list[dict]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select t as pii_type, count(*) as count
            from audit_events, unnest(pii_types) as t
            where tenant_id = $1 and ($2::timestamptz is null or ts >= $2)
            group by t order by count desc
            """,
            tenant_id, since,
        )
    return [dict(r) for r in rows]


async def timeseries(tenant_id: str, days: int) -> list[dict]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select to_char(date_trunc('day', ts at time zone 'Australia/Sydney'), 'YYYY-MM-DD') as day,
                   count(*) as requests,
                   coalesce(sum(pii_count), 0) as pii_redactions,
                   count(*) filter (where cache_hit) as cache_hits,
                   count(*) filter (where decision = 'blocked') as blocked_requests,
                   coalesce(sum(cost_usd), 0) as cost_usd,
                   coalesce(sum(cost_if_no_cache), 0) as cost_if_no_cache
            from audit_events
            where tenant_id = $1 and ts >= now() - make_interval(days => $2)
            group by 1 order by 1
            """,
            tenant_id, days,
        )
    return [dict(r) for r in rows]


async def recent(tenant_id: str, limit: int, department: str | None = None, user: str | None = None) -> list[dict]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select e.id, e.ts, e.source, e.department, e.department_label, e.app_name, e.end_user_id,
                   coalesce(u.display_name, e.end_user_id, e.app_name, 'Console') as user_label,
                   u.title as user_title, e.prompt_redacted, e.response_redacted, e.cache_hit, e.model_used,
                   e.tier, e.cost_usd, e.latency_ms, e.decision, e.policy_reason, e.flags, e.pii_types,
                   e.pii_count, e.fallbacks, e.stream, e.hash
            from audit_events e
            left join end_users u on u.tenant_id = e.tenant_id and u.id = e.end_user_id
            where e.tenant_id = $1 and ($2::text is null or e.department = $2) and ($3::text is null or e.end_user_id = $3)
            order by e.id desc
            limit $4
            """,
            tenant_id, department, user, limit,
        )
    out = []
    for r in rows:
        d = dict(r)
        d["ts"] = d["ts"].isoformat()
        d["policy_allowed"] = d["decision"] == "allowed"
        d["model_label"] = d["tier"]
        out.append(d)
    return out


async def risky_users(tenant_id: str, since: datetime | None, limit: int = 10) -> list[dict]:
    """Users ranked by sensitive-data exposure and policy violations."""
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select e.end_user_id as user_id, u.display_name, u.title, max(e.department_label) as department_label,
                   count(*) as requests,
                   count(*) filter (where e.decision = 'blocked') as blocked,
                   coalesce(sum(e.pii_count), 0) as pii_exposures,
                   count(*) filter (where 'prompt_injection' = any(e.flags)) as injection_flags,
                   max(e.ts) as last_seen
            from audit_events e
            left join end_users u on u.tenant_id = e.tenant_id and u.id = e.end_user_id
            where e.tenant_id = $1 and e.end_user_id is not null and ($2::timestamptz is null or e.ts >= $2)
            group by e.end_user_id, u.display_name, u.title
            order by (count(*) filter (where e.decision = 'blocked')) * 5 + coalesce(sum(e.pii_count), 0) desc
            limit $3
            """,
            tenant_id, since, limit,
        )
    return [{**dict(r), "last_seen": r["last_seen"].isoformat(),
             "risk_score": r["blocked"] * 5 + r["pii_exposures"] + r["injection_flags"] * 10} for r in rows]


async def apps(tenant_id: str, since: datetime | None) -> list[dict]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select coalesce(e.app_name, 'Console Playground') as app_name, count(*) as requests,
                   count(distinct e.end_user_id) as users,
                   count(*) filter (where e.decision = 'blocked') as blocked,
                   coalesce(sum(e.pii_count), 0) as pii_exposures,
                   count(*) filter (where e.cache_hit) as cache_hits,
                   max(e.ts) as last_seen
            from audit_events e
            where e.tenant_id = $1 and ($2::timestamptz is null or e.ts >= $2)
            group by 1 order by requests desc
            """,
            tenant_id, since,
        )
    return [{**dict(r), "last_seen": r["last_seen"].isoformat()} for r in rows]


async def user_profile(tenant_id: str, user_id: str, days: int) -> dict | None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        person = await conn.fetchrow(
            "select id, display_name, title, department from end_users where tenant_id = $1 and id = $2", tenant_id, user_id
        )
        if person is None:
            return None
        totals = await conn.fetchrow(
            """
            select count(*) as requests, count(*) filter (where decision = 'blocked') as blocked,
                   coalesce(sum(pii_count), 0) as pii_exposures,
                   count(*) filter (where 'prompt_injection' = any(flags)) as injection_flags,
                   count(distinct app_name) as apps
            from audit_events where tenant_id = $1 and end_user_id = $2 and ts >= now() - make_interval(days => $3)
            """,
            tenant_id, user_id, days,
        )
        daily = await conn.fetch(
            """
            select to_char(date_trunc('day', ts at time zone 'Australia/Sydney'), 'YYYY-MM-DD') as day,
                   count(*) as requests, count(*) filter (where decision = 'blocked') as blocked,
                   coalesce(sum(pii_count), 0) as pii
            from audit_events where tenant_id = $1 and end_user_id = $2 and ts >= now() - make_interval(days => $3)
            group by 1 order by 1
            """,
            tenant_id, user_id, days,
        )
        classes = await conn.fetch(
            """
            select t as pii_type, count(*) as count from audit_events, unnest(pii_types) t
            where tenant_id = $1 and end_user_id = $2 and ts >= now() - make_interval(days => $3)
            group by t order by count desc
            """,
            tenant_id, user_id, days,
        )
    dept_label = await _department_label(tenant_id, person["department"])
    return {"user": {**dict(person), "department_label": dept_label}, "totals": dict(totals),
            "daily": [dict(r) for r in daily], "data_classes": [dict(r) for r in classes]}


async def _department_label(tenant_id: str, dept: str) -> str:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval("select label from departments where tenant_id = $1 and id = $2", tenant_id, dept) or dept
