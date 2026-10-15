"""
Live activity feed. One LISTEN connection per process receives the audit
writer's NOTIFY events (from any instance) and fans them out to connected
console streams. Clients that fall behind lose old events rather than
slowing everyone down.
"""
import asyncio
import json
import logging

import asyncpg

from . import config, db

log = logging.getLogger(__name__)

_subscribers: set[asyncio.Queue] = set()
_conn: asyncpg.Connection | None = None
_lock = asyncio.Lock()


def _on_notify(_conn, _pid, _channel, payload: str) -> None:
    try:
        event = json.loads(payload)
    except ValueError:
        return
    for q in list(_subscribers):
        if q.full():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
        q.put_nowait(event)


async def _ensure_listener() -> None:
    global _conn
    async with _lock:
        if _conn is not None and not _conn.is_closed():
            return
        _conn = await asyncpg.connect(db._asyncpg_dsn(config.DATABASE_URL))
        await _conn.add_listener("sf_audit", _on_notify)
        log.info("live feed listening on sf_audit")


async def subscribe() -> asyncio.Queue:
    await _ensure_listener()
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


async def close() -> None:
    global _conn
    if _conn is not None:
        await _conn.close()
        _conn = None
