"""
Production auth (used only when DEMO_MODE=false): verifies a Supabase Auth
JWT sent as `Authorization: Bearer <token>` and loads the caller's
department/role from the `profiles` table (see supabase_schema.sql).

Verification uses Supabase's JWT Signing Keys (JWKS, asymmetric) rather than
the legacy shared HS256 secret Supabase has deprecated — the backend only
ever holds a public key it fetches from Supabase, never a shared secret, so
there's nothing here that can be used to forge a token. The JWKS endpoint is
derived from SUPABASE_URL; no separate secret to configure.

Demo mode never enforces this — chat stays open and department-selectable in
the UI, exactly as it always has, for frictionless sales demos.
"""
from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

import config
import db_postgres

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        # Matches Supabase's documented JWKS discovery URL. Cross-check
        # against Settings -> API -> JWT Keys in the dashboard if this ever
        # 404s for a given project.
        jwks_url = f"{config.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
    return _jwks_client


@dataclass
class AuthedUser:
    id: str
    email: str
    department: str | None
    role: str


async def get_current_user(authorization: str | None = Header(default=None)) -> AuthedUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1]

    try:
        signing_key = _get_jwks_client().get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            # Supabase's new signing keys are asymmetric — ES256 (P-256) is
            # the current default, RS256 is the other option it offers.
            # Never accept HS256 here: that would let anyone who knows the
            # (deprecated, but possibly still-active) legacy shared secret
            # forge a token accepted by this asymmetric-only check, and
            # accepting both classes at once reopens the algorithm-confusion
            # hole this migration exists to close.
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
    except Exception as e:
        raise HTTPException(401, f"Invalid or expired token: {e}")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(401, "Token missing subject claim")

    pool = await db_postgres.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT department, role FROM profiles WHERE id = $1", user_id)

    if row is None:
        raise HTTPException(403, "No profile found for this account. Ask an administrator to assign one.")

    return AuthedUser(id=user_id, email=payload.get("email", ""), department=row["department"], role=row["role"])


async def optional_auth(authorization: str | None = Header(default=None)) -> AuthedUser | None:
    """Demo mode: no auth at all (returns None). Production mode: delegates
    to get_current_user, so an invalid/missing token still 401s."""
    if config.DEMO_MODE:
        return None
    return await get_current_user(authorization)
