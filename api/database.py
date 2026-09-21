"""
Enterprise audit store.

Demo mode: local SQLite file, zero setup. Production target: Postgres via
Supabase, connected read-replica-style to existing enterprise systems. The
schema and query functions below are what would move over unchanged — only
the connection string in config.py changes.

The audit log NEVER stores raw PII: only the already-redacted prompt/response
text and metadata about what was found and what the policy engine decided.
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime

import config

_DB_PATH = config.DATABASE_URL.replace("sqlite:///", "")


@contextmanager
def get_conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                department TEXT NOT NULL,
                department_label TEXT NOT NULL,
                user_label TEXT NOT NULL,
                prompt_redacted TEXT NOT NULL,
                response_redacted TEXT,
                cache_hit INTEGER NOT NULL DEFAULT 0,
                model_used TEXT,
                model_label TEXT,
                tier TEXT,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cost_usd REAL DEFAULT 0,
                cost_if_no_cache REAL DEFAULT 0,
                latency_ms INTEGER DEFAULT 0,
                policy_allowed INTEGER NOT NULL DEFAULT 1,
                policy_reason TEXT,
                pii_types_json TEXT NOT NULL DEFAULT '[]',
                pii_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs (ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_dept ON audit_logs (department)")


def insert_audit_log(**kwargs) -> int:
    kwargs.setdefault("ts", datetime.utcnow().isoformat())
    kwargs["pii_types_json"] = json.dumps(kwargs.pop("pii_types", []))
    cols = ", ".join(kwargs.keys())
    placeholders = ", ".join("?" for _ in kwargs)
    with get_conn() as conn:
        cur = conn.execute(
            f"INSERT INTO audit_logs ({cols}) VALUES ({placeholders})",
            list(kwargs.values()),
        )
        return cur.lastrowid


def get_recent_logs(limit: int = 50, department: str | None = None) -> list[dict]:
    query = "SELECT * FROM audit_logs"
    params: list = []
    if department:
        query += " WHERE department = ?"
        params.append(department)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with get_conn() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_summary_stats(since_ts: str | None = None) -> dict:
    where, params = ("WHERE ts >= ?", [since_ts]) if since_ts else ("", [])
    with get_conn() as conn:
        row = conn.execute(
            f"""
            SELECT
                COUNT(*) AS total_requests,
                COALESCE(SUM(cache_hit), 0) AS cache_hits,
                COALESCE(SUM(pii_count), 0) AS total_pii_redactions,
                COALESCE(SUM(cost_usd), 0) AS total_cost,
                COALESCE(SUM(cost_if_no_cache), 0) AS total_cost_if_no_cache,
                COALESCE(SUM(CASE WHEN policy_allowed = 0 THEN 1 ELSE 0 END), 0) AS blocked_requests,
                COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
            FROM audit_logs {where}
            """,
            params,
        ).fetchone()
    d = _row_to_dict(row)
    d["cache_hit_rate"] = (d["cache_hits"] / d["total_requests"]) if d["total_requests"] else 0
    d["savings_usd"] = round(d["total_cost_if_no_cache"] - d["total_cost"], 4)
    d["savings_pct"] = (
        round(d["savings_usd"] / d["total_cost_if_no_cache"] * 100, 1)
        if d["total_cost_if_no_cache"] > 0
        else 0
    )
    return d


def get_department_breakdown(since_ts: str | None = None) -> list[dict]:
    where, params = ("WHERE ts >= ?", [since_ts]) if since_ts else ("", [])
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT department, department_label,
                   COUNT(*) AS requests,
                   COALESCE(SUM(pii_count), 0) AS pii_redactions,
                   COALESCE(SUM(cache_hit), 0) AS cache_hits,
                   COALESCE(SUM(cost_usd), 0) AS cost_usd,
                   COALESCE(SUM(CASE WHEN policy_allowed = 0 THEN 1 ELSE 0 END), 0) AS blocked_requests
            FROM audit_logs {where}
            GROUP BY department, department_label
            ORDER BY requests DESC
            """,
            params,
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_pii_type_breakdown(since_ts: str | None = None) -> list[dict]:
    where, params = ("WHERE ts >= ?", [since_ts]) if since_ts else ("", [])
    with get_conn() as conn:
        rows = conn.execute(f"SELECT pii_types_json FROM audit_logs {where}", params).fetchall()
    counts: dict[str, int] = {}
    for r in rows:
        for t in json.loads(r["pii_types_json"]):
            counts[t] = counts.get(t, 0) + 1
    return [{"pii_type": k, "count": v} for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]


def get_daily_timeseries(days: int = 14) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT day, requests, pii_redactions, cache_hits, cost_usd, cost_if_no_cache FROM (
                SELECT substr(ts, 1, 10) AS day,
                       COUNT(*) AS requests,
                       COALESCE(SUM(pii_count), 0) AS pii_redactions,
                       COALESCE(SUM(cache_hit), 0) AS cache_hits,
                       COALESCE(SUM(cost_usd), 0) AS cost_usd,
                       COALESCE(SUM(cost_if_no_cache), 0) AS cost_if_no_cache
                FROM audit_logs
                GROUP BY day
                ORDER BY day DESC
                LIMIT ?
            )
            ORDER BY day ASC
            """,
            (days,),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def count_logs() -> int:
    with get_conn() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM audit_logs").fetchone()["c"]


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    if "pii_types_json" in d:
        d["pii_types"] = json.loads(d.pop("pii_types_json"))
    for bool_field in ("cache_hit", "policy_allowed"):
        if bool_field in d:
            d[bool_field] = bool(d[bool_field])
    return d
