"""
Who is calling the gateway.

Apps authenticate with virtual API keys (`sf-live-…`); only a SHA-256 hash is
stored. End users are identified by what the app forwards: the OpenAI `user`
field or an `X-SF-User` header. These are *unverified* claims and are
recorded as such; verified end-user identity (a signed JWT from the bank's
identity provider) arrives in Phase 2.
"""
import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass

from . import db

KEY_PREFIX = "sf-live-"


@dataclass
class AppIdentity:
    tenant_id: str
    app_id: uuid.UUID
    app_name: str
    default_department: str


@dataclass
class EndUser:
    id: str
    display_name: str
    department: str
    verified: bool


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def new_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


async def create_key(app_id: uuid.UUID, key: str | None = None) -> str:
    """Store a key for an app and return the plaintext (shown once)."""
    key = key or new_key()
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "insert into app_keys (app_id, prefix, key_hash) values ($1, $2, $3) on conflict (key_hash) do nothing",
            app_id,
            key[: len(KEY_PREFIX) + 6],
            hash_key(key),
        )
    return key


_key_cache: dict[str, tuple[float, AppIdentity | None]] = {}
_KEY_CACHE_TTL_S = 30.0


async def resolve_key(key: str) -> AppIdentity | None:
    h = hash_key(key)
    hit = _key_cache.get(h)
    if hit and time.monotonic() - hit[0] < _KEY_CACHE_TTL_S:
        return hit[1]
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            select a.tenant_id, a.id, a.name, a.default_department
            from app_keys k join apps a on a.id = k.app_id
            where k.key_hash = $1 and k.revoked_at is null and not a.disabled
            """,
            h,
        )
        if row is not None:
            await conn.execute(
                "update app_keys set last_used_at = now() where key_hash = $1 and (last_used_at is null or last_used_at < now() - interval '1 minute')",
                h,
            )
    ident = AppIdentity(row["tenant_id"], row["id"], row["name"], row["default_department"]) if row else None
    _key_cache[h] = (time.monotonic(), ident)
    return ident


async def resolve_end_user(tenant_id: str, claimed: str | None, fallback_department: str) -> EndUser | None:
    """Look up the claimed user by id or external reference (e.g. email).
    Unknown users are registered on first sight under the app's default
    department, so a real pilot builds its user list without manual setup."""
    if not claimed:
        return None
    claimed = claimed.strip()[:200]
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "select id, display_name, department from end_users where tenant_id = $1 and (id = $2 or external_ref = $2)",
            tenant_id,
            claimed,
        )
        if row is None:
            row = await conn.fetchrow(
                """
                insert into end_users (tenant_id, id, external_ref, display_name, department)
                values ($1, $2, $2, $2, $3)
                on conflict (tenant_id, id) do update set id = excluded.id
                returning id, display_name, department
                """,
                tenant_id,
                claimed,
                fallback_department,
            )
    return EndUser(row["id"], row["display_name"], row["department"], verified=False)
