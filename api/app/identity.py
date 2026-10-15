"""
Who is calling the gateway.

Apps authenticate with virtual API keys (`sf-live-…`); only a SHA-256 hash is
stored. End users are identified by what the app forwards: the OpenAI `user`
field or an `X-SF-User` header, which are *unverified* claims and recorded
as such, or a signed token from the bank's identity provider in
`X-SF-User-Token`, which is verified and wins over any claim.
"""
import asyncio
import hashlib
import secrets
import time
import uuid
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from . import config, db

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


class InvalidUserToken(Exception):
    pass


_idp_jwks: PyJWKClient | None = None


async def verify_user_token(tenant_id: str, token: str, fallback_department: str) -> EndUser:
    """Verify an end-user token from the bank's IdP (END_USER_JWKS_URL), or in
    demo mode one signed by the demo IdP. A `department` claim, when present,
    is authoritative and updates the user's record."""
    from .console_auth import DEMO_IDP_ISSUER, demo_secret

    global _idp_jwks
    try:
        if config.END_USER_JWKS_URL:
            if _idp_jwks is None:
                _idp_jwks = PyJWKClient(config.END_USER_JWKS_URL, cache_keys=True, lifespan=3600)
            key = await asyncio.to_thread(_idp_jwks.get_signing_key_from_jwt, token)
            claims = jwt.decode(
                token, key.key, algorithms=["RS256", "ES256"],
                audience=config.END_USER_AUDIENCE or None, issuer=config.END_USER_ISSUER or None,
                options={"verify_aud": bool(config.END_USER_AUDIENCE)},
            )
        elif config.DEMO_MODE:
            claims = jwt.decode(token, demo_secret(), algorithms=["HS256"], issuer=DEMO_IDP_ISSUER)
        else:
            raise InvalidUserToken("No identity provider is configured for verified user tokens.")
    except jwt.PyJWTError as e:
        raise InvalidUserToken(f"User token rejected: {e}") from e

    subject = (claims.get("email") or claims.get("preferred_username") or claims.get("sub") or "").lower()
    if not subject:
        raise InvalidUserToken("User token has no subject.")
    department = claims.get("department")
    name = claims.get("name") or subject
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            update end_users set department = coalesce($3, department)
            where tenant_id = $1 and (id = $2 or external_ref = $2)
            returning id, display_name, department
            """,
            tenant_id, subject, department,
        )
        if row is None:
            row = await conn.fetchrow(
                """
                insert into end_users (tenant_id, id, external_ref, display_name, department)
                values ($1, $2, $2, $3, $4)
                on conflict (tenant_id, id) do update set department = excluded.department
                returning id, display_name, department
                """,
                tenant_id, subject, name, department or fallback_department,
            )
    return EndUser(row["id"], row["display_name"], row["department"], verified=True)
