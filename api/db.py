"""
Backend-agnostic data-layer entry point. Route handlers import this module
only — never `database` or `db_postgres` directly — so the same code runs
against SQLite (demo mode) or Postgres (production mode) unchanged.

database.py's functions are synchronous (fast local SQLite I/O); this wraps
them as async so callers can always `await db.*` regardless of which backend
is active underneath.
"""
import config

if config.DEMO_MODE:
    import database as _impl

    async def init_db():
        _impl.init_db()

    async def insert_audit_log(**kwargs) -> int:
        return _impl.insert_audit_log(**kwargs)

    async def get_recent_logs(limit: int = 50, department: str | None = None) -> list[dict]:
        return _impl.get_recent_logs(limit=limit, department=department)

    async def get_summary_stats(since_ts: str | None = None) -> dict:
        return _impl.get_summary_stats(since_ts=since_ts)

    async def get_department_breakdown(since_ts: str | None = None) -> list[dict]:
        return _impl.get_department_breakdown(since_ts=since_ts)

    async def get_pii_type_breakdown(since_ts: str | None = None) -> list[dict]:
        return _impl.get_pii_type_breakdown(since_ts=since_ts)

    async def get_daily_timeseries(days: int = 14) -> list[dict]:
        return _impl.get_daily_timeseries(days=days)

    async def count_logs() -> int:
        return _impl.count_logs()

    async def close():
        pass

else:
    import db_postgres as _impl

    init_db = _impl.init_db
    insert_audit_log = _impl.insert_audit_log
    get_recent_logs = _impl.get_recent_logs
    get_summary_stats = _impl.get_summary_stats
    get_department_breakdown = _impl.get_department_breakdown
    get_pii_type_breakdown = _impl.get_pii_type_breakdown
    get_daily_timeseries = _impl.get_daily_timeseries
    count_logs = _impl.count_logs
    close = _impl.close_pool
