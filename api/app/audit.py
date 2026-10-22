"""
Append-only, hash-chained audit trail.

Each event stores prev_hash and hash = SHA-256(prev_hash || canonical JSON of
the event). Appends are serialised per tenant (row lock on the chain head),
so the chain is linear even with several gateway instances. verify() replays
the chain and reports the first event that doesn't match.

After commit, a NOTIFY on channel 'sf_audit' carries a small summary for the
live executive feed.
"""
import hashlib
import json
import uuid
from datetime import datetime, timezone

from . import db

GENESIS = "0" * 64

# Fields covered by the hash, in a fixed order. Adding a field later means a
# new hash version, never a silent change to this list.
HASHED_FIELDS = (
    "tenant_id", "ts", "request_id", "source", "endpoint", "app_id", "app_name", "end_user_id", "user_verified",
    "department", "department_label", "decision", "policy_version", "policy_reason", "flags", "prompt_redacted",
    "response_redacted", "pii_types", "pii_count", "output_pii_masked", "cache_hit", "cache_similarity",
    "model_requested", "model_used", "provider", "tier", "fallbacks", "stream", "input_tokens", "output_tokens",
    "cost_usd", "cost_if_no_cache", "latency_ms", "gateway_overhead_ms", "rehydrated", "rehydration_misses",
)

_DEFAULTS = {
    "app_id": None, "app_name": None, "end_user_id": None, "user_verified": False, "policy_version": None,
    "policy_reason": None, "flags": [], "response_redacted": None, "pii_types": [], "pii_count": 0,
    "output_pii_masked": 0, "cache_hit": False, "cache_similarity": None, "model_requested": None,
    "model_used": None, "provider": None, "tier": None, "fallbacks": [], "stream": False, "input_tokens": 0,
    "output_tokens": 0, "cost_usd": 0.0, "cost_if_no_cache": 0.0, "latency_ms": 0, "gateway_overhead_ms": 0,
    "rehydrated": 0, "rehydration_misses": 0,
}


def _canonical(event: dict) -> str:
    def norm(v):
        if isinstance(v, datetime):
            return v.astimezone(timezone.utc).isoformat(timespec="microseconds")
        if isinstance(v, uuid.UUID):
            return str(v)
        if isinstance(v, float):
            return repr(v)
        return v

    return json.dumps({k: norm(event.get(k)) for k in HASHED_FIELDS}, sort_keys=True, separators=(",", ":"))


def compute_hash(prev_hash: str, event: dict) -> str:
    return hashlib.sha256((prev_hash + _canonical(event)).encode()).hexdigest()


def _complete(event: dict) -> dict:
    e = {**_DEFAULTS, **event}
    e.setdefault("ts", datetime.now(timezone.utc))
    e.setdefault("request_id", uuid.uuid4())
    if isinstance(e["request_id"], str):
        e["request_id"] = uuid.UUID(e["request_id"])
    if isinstance(e["app_id"], str):
        e["app_id"] = uuid.UUID(e["app_id"])
    # Postgres keeps microseconds; trim so the hash survives the round trip.
    e["ts"] = e["ts"].astimezone(timezone.utc)
    for k in ("cost_usd", "cost_if_no_cache"):
        e[k] = float(e[k])
    if e["cache_similarity"] is not None:
        e["cache_similarity"] = float(e["cache_similarity"])
    return e


async def append(events: list[dict], notify: bool = True) -> list[int]:
    """Insert events (all for the same tenant) in order. Returns their ids."""
    if not events:
        return []
    tenant_id = events[0]["tenant_id"]
    rows = [_complete(e) for e in events]
    cols = list(HASHED_FIELDS) + ["prev_hash", "hash"]
    placeholders = ", ".join(f"${i + 1}" for i in range(len(cols)))
    sql = f"insert into audit_events ({', '.join(cols)}) values ({placeholders}) returning id"

    pool = await db.get_pool()
    ids: list[int] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "insert into audit_chain_heads (tenant_id, last_id, last_hash) values ($1, 0, $2) on conflict do nothing",
                tenant_id,
                GENESIS,
            )
            head = await conn.fetchrow(
                "select last_id, last_hash from audit_chain_heads where tenant_id = $1 for update", tenant_id
            )
            prev = head["last_hash"]
            for e in rows:
                e["prev_hash"] = prev
                e["hash"] = compute_hash(prev, e)
                prev = e["hash"]
            if len(rows) <= 10:
                for e in rows:
                    ids.append(await conn.fetchval(sql, *[e[c] for c in cols]))
            else:
                # Bulk loads (seeding) go in one COPY instead of a round trip per
                # row, which matters when the database is across the internet.
                # The chain-head row lock serialises appends per tenant, and COPY
                # assigns identities in row order, so the new ids are the next
                # ones for this tenant.
                await conn.copy_records_to_table(
                    "audit_events", records=[tuple(e[c] for c in cols) for e in rows], columns=cols
                )
                ids = [r["id"] for r in await conn.fetch(
                    "select id from audit_events where tenant_id = $1 and id > $2 order by id", tenant_id, head["last_id"]
                )]
                assert len(ids) == len(rows), "bulk audit append returned an unexpected number of rows"
            await conn.execute(
                "update audit_chain_heads set last_id = $2, last_hash = $3 where tenant_id = $1", tenant_id, ids[-1], prev
            )
            if notify:
                for e, id_ in zip(rows, ids):
                    await conn.execute("select pg_notify('sf_audit', $1)", json.dumps(_feed_summary(id_, e)))
    return ids


def _feed_summary(id_: int, e: dict) -> dict:
    return {
        "id": id_,
        "tenant_id": e["tenant_id"],
        "ts": e["ts"].isoformat(),
        "source": e["source"],
        "app_name": e["app_name"],
        "end_user_id": e["end_user_id"],
        "department": e["department"],
        "department_label": e["department_label"],
        "decision": e["decision"],
        "pii_types": e["pii_types"],
        "cache_hit": e["cache_hit"],
        "tier": e["tier"],
        "flags": e["flags"],
    }


async def verify(tenant_id: str) -> dict:
    """Replay the chain. Returns {ok, checked, first_bad_id}."""
    pool = await db.get_pool()
    prev = GENESIS
    checked = 0
    async with pool.acquire() as conn:
        async with conn.transaction():
            cur = conn.cursor(
                f"select id, {', '.join(HASHED_FIELDS)}, prev_hash, hash from audit_events where tenant_id = $1 order by id",
                tenant_id,
            )
            async for row in cur:
                r = dict(row)
                if r["prev_hash"] != prev or compute_hash(prev, r) != r["hash"]:
                    return {"ok": False, "checked": checked, "first_bad_id": r["id"]}
                prev = r["hash"]
                checked += 1
    return {"ok": True, "checked": checked, "first_bad_id": None}
