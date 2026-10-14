"""Postgres connection pool and schema migrations."""
import json
import logging
from pathlib import Path

import asyncpg

from . import config

log = logging.getLogger(__name__)

_MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # jsonb columns round-trip as native Python dicts/lists.
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            config.DATABASE_URL,
            min_size=1,
            max_size=config.DB_POOL_MAX,
            init=_init_connection,
        )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def migrate() -> list[str]:
    """Apply any migration files not yet recorded, in name order. Concurrent
    starts (two Cloud Run instances) are serialised by an advisory lock."""
    pool = await get_pool()
    applied_now: list[str] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("select pg_advisory_xact_lock(hashtext('sf_migrations'))")
            await conn.execute(
                "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
            )
            done = {r["name"] for r in await conn.fetch("select name from schema_migrations")}
            for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
                if path.name in done:
                    continue
                log.info("applying migration %s", path.name)
                await conn.execute(path.read_text(encoding="utf-8"))
                await conn.execute("insert into schema_migrations (name) values ($1)", path.name)
                applied_now.append(path.name)
    return applied_now
