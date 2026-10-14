"""
Production audit store: Postgres (Supabase) via asyncpg.

Mirrors database.py's function signatures exactly (same names, same return
shapes) so main.py and seed_data.py can call through db.py's dispatch shim
without caring which backend is active. Unlike database.py, this module does
NOT create its own schema — run supabase_schema.sql once in the Supabase SQL
editor first; init_db() here only verifies it exists.
"""
import json

import asyncpg

import config

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            config.DATABASE_URL,
            min_size=1,
            max_size=5,
            # Supabase's recommended "Connection pooling" URI runs through
            # PgBouncer in transaction mode, which hands each query to a
            # possibly-different backend connection — asyncpg's default
            # server-side prepared-statement cache breaks against that
            # (intermittent "prepared statement does not exist" errors
            # under concurrent load). Disabling it is the documented fix.
            statement_cache_size=0,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def init_db() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        exists = await conn.fetchval(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audit_logs')"
        )
    if not exists:
        raise RuntimeError(
            "Postgres schema not found. Run api/supabase_schema.sql in your Supabase "
            "project's SQL editor, then restart the backend."
        )


async def insert_audit_log(**kwargs) -> int:
    ts = kwargs.pop("ts", None)
    pii_types = kwargs.pop("pii_types", [])
    kwargs["pii_types"] = json.dumps(pii_types)
    if ts is not None:
        kwargs["ts"] = ts

    cols = list(kwargs.keys())
    col_exprs = [f"${i + 1}::jsonb" if c == "pii_types" else f"${i + 1}" for i, c in enumerate(cols)]
    sql = f"INSERT INTO audit_logs ({', '.join(cols)}) VALUES ({', '.join(col_exprs)}) RETURNING id"

    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, *[kwargs[c] for c in cols])
    return row["id"]


async def get_recent_logs(limit: int = 50, department: str | None = None) -> list[dict]:
    pool = await get_pool()
    query = "SELECT * FROM audit_logs"
    params: list = []
    if department:
        query += " WHERE department = $1"
        params.append(department)
    query += f" ORDER BY id DESC LIMIT ${len(params) + 1}"
    params.append(limit)
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    return [_row_to_dict(r) for r in rows]


async def get_summary_stats(since_ts: str | None = None) -> dict:
    where, params = ("WHERE ts >= $1::timestamptz", [since_ts]) if since_ts else ("", [])
    query = f"""
        SELECT
            COUNT(*) AS total_requests,
            COALESCE(SUM(cache_hit::int), 0) AS cache_hits,
            COALESCE(SUM(pii_count), 0) AS total_pii_redactions,
            COALESCE(SUM(cost_usd), 0) AS total_cost,
            COALESCE(SUM(cost_if_no_cache), 0) AS total_cost_if_no_cache,
            COALESCE(SUM(CASE WHEN policy_allowed = false THEN 1 ELSE 0 END), 0) AS blocked_requests,
            COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
        FROM audit_logs {where}
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, *params)
    d = dict(row)
    d["total_requests"] = int(d["total_requests"])
    d["cache_hits"] = int(d["cache_hits"])
    d["cache_hit_rate"] = (d["cache_hits"] / d["total_requests"]) if d["total_requests"] else 0
    d["savings_usd"] = round(d["total_cost_if_no_cache"] - d["total_cost"], 4)
    d["savings_pct"] = (
        round(d["savings_usd"] / d["total_cost_if_no_cache"] * 100, 1) if d["total_cost_if_no_cache"] > 0 else 0
    )
    return d


async def get_department_breakdown(since_ts: str | None = None) -> list[dict]:
    where, params = ("WHERE ts >= $1::timestamptz", [since_ts]) if since_ts else ("", [])
    query = f"""
        SELECT department, department_label,
               COUNT(*) AS requests,
               COALESCE(SUM(pii_count), 0) AS pii_redactions,
               COALESCE(SUM(cache_hit::int), 0) AS cache_hits,
               COALESCE(SUM(cost_usd), 0) AS cost_usd,
               COALESCE(SUM(CASE WHEN policy_allowed = false THEN 1 ELSE 0 END), 0) AS blocked_requests
        FROM audit_logs {where}
        GROUP BY department, department_label
        ORDER BY requests DESC
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    return [dict(r) for r in rows]


async def get_pii_type_breakdown(since_ts: str | None = None) -> list[dict]:
    where, params = ("WHERE ts >= $1::timestamptz", [since_ts]) if since_ts else ("", [])
    query = f"SELECT pii_types::text AS pii_types FROM audit_logs {where}"
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *params)
    counts: dict[str, int] = {}
    for r in rows:
        for t in json.loads(r["pii_types"]):
            counts[t] = counts.get(t, 0) + 1
    return [{"pii_type": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]


async def get_daily_timeseries(days: int = 14) -> list[dict]:
    query = """
        SELECT day, requests, pii_redactions, cache_hits, cost_usd, cost_if_no_cache FROM (
            SELECT to_char(ts, 'YYYY-MM-DD') AS day,
                   COUNT(*) AS requests,
                   COALESCE(SUM(pii_count), 0) AS pii_redactions,
                   COALESCE(SUM(cache_hit::int), 0) AS cache_hits,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd,
                   COALESCE(SUM(cost_if_no_cache), 0) AS cost_if_no_cache
            FROM audit_logs
            GROUP BY day
            ORDER BY day DESC
            LIMIT $1
        ) sub
        ORDER BY day ASC
    """
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, days)
    return [dict(r) for r in rows]


async def count_logs() -> int:
    pool = await get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT COUNT(*) FROM audit_logs")


def _row_to_dict(row: asyncpg.Record) -> dict:
    d = dict(row)
    if isinstance(d.get("pii_types"), str):
        d["pii_types"] = json.loads(d["pii_types"])
    return d
