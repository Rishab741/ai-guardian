"""
Console authentication and role-based access control.

Two ways to get a console session, both ending in a bearer JWT:
  * Firebase Authentication (free Spark plan) ID tokens, verified against
    Google's public keys. Enabled when FIREBASE_PROJECT_ID is set. The email
    must belong to a provisioned console user (or CONSOLE_BOOTSTRAP_ADMINS).
  * Demo personas (DEMO_MODE only): the login screen's simulated SSO picker
    exchanges a persona for a short-lived HS256 token signed with
    DEMO_TOKEN_SECRET, optionally gated by DEMO_ACCESS_CODE.

Every /api route declares the permission it needs with Depends(require(...)).
The role is re-read from the database (briefly cached), so a role change
takes effect without waiting for tokens to expire.
"""
import asyncio
import hmac
import logging
import secrets
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header, HTTPException
from jwt import PyJWKClient

from . import config, db

log = logging.getLogger(__name__)

ROLES = ("platform_admin", "executive", "ciso", "compliance", "tenant_admin", "developer")

PERMISSIONS: dict[str, set[str]] = {
    "executive": {"view_dashboards", "view_risk", "approve_policy"},
    "ciso": {"view_dashboards", "view_risk", "view_audit_detail", "view_identities", "draft_policy",
             "export_reports", "verify_audit", "use_playground"},
    "compliance": {"view_dashboards", "view_risk", "view_audit_detail", "view_identities", "export_reports",
                   "verify_audit"},
    "tenant_admin": {"view_dashboards", "manage_apps", "manage_settings", "use_playground"},
    "developer": {"use_playground"},
}
ROLE_LABELS = {
    "platform_admin": "Platform admin", "executive": "Executive", "ciso": "CISO", "compliance": "Compliance",
    "tenant_admin": "IT admin", "developer": "Developer",
}

PERSONAS = [
    # email local part, name, title, role (all fictional)
    ("margaret.ellis", "Margaret Ellis", "Group Chief Executive", "executive"),
    ("robert.tan", "Robert Tan", "Chief Risk Officer", "executive"),
    ("daniel.okoye", "Daniel Okoye", "Chief Information Security Officer", "ciso"),
    ("fatima.rahman", "Fatima Rahman", "Head of Regulatory Compliance", "compliance"),
    ("chris.lam", "Chris Lam", "IT Platform Administrator", "tenant_admin"),
    ("jess.park", "Jess Park", "Software Engineer, Digital Channels", "developer"),
]

DEMO_ISSUER = "sf-demo"
DEMO_IDP_ISSUER = "sf-demo-idp"  # stands in for the bank's IdP when signing end-user tokens
_TOKEN_TTL = timedelta(hours=8)

# A per-process secret works for one local instance; multi-instance hosting
# must set DEMO_TOKEN_SECRET so every instance accepts the same tokens.
_demo_secret = config.DEMO_TOKEN_SECRET or secrets.token_urlsafe(48)
if config.DEMO_MODE and not config.DEMO_TOKEN_SECRET:
    log.warning("DEMO_TOKEN_SECRET not set; demo sessions won't survive a restart")


@dataclass
class ConsoleUser:
    id: str
    tenant_id: str
    email: str
    display_name: str
    title: str
    role: str
    persona: bool

    @property
    def permissions(self) -> set[str]:
        if self.role == "platform_admin":
            return set().union(*PERMISSIONS.values())
        return PERMISSIONS.get(self.role, set())

    def can(self, perm: str) -> bool:
        return perm in self.permissions


def demo_secret() -> str:
    return _demo_secret


def access_code_ok(code: str | None) -> bool:
    if not config.DEMO_ACCESS_CODE:
        return True
    return hmac.compare_digest((code or "").strip(), config.DEMO_ACCESS_CODE)


async def seed_personas() -> None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        for local, name, title, role in PERSONAS:
            await conn.execute(
                """insert into console_users (tenant_id, email, display_name, title, role, persona)
                   values ($1, $2, $3, $4, $5, true) on conflict (email) do nothing""",
                config.DEFAULT_TENANT, f"{local}@harbourbank.example", name, title, role,
            )


async def list_personas() -> list[dict]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select id, email, display_name, title, role from console_users where persona order by created_at, email"
        )
    return [{**dict(r), "id": str(r["id"]), "role_label": ROLE_LABELS[r["role"]]} for r in rows]


async def issue_demo_token(persona_id: str) -> str:
    user = await _load_by("id", persona_id)
    if user is None or not user.persona:
        raise HTTPException(404, "Unknown persona")
    await _touch(user.id)
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"iss": DEMO_ISSUER, "sub": user.id, "email": user.email, "iat": now, "exp": now + _TOKEN_TTL},
        _demo_secret, algorithm="HS256",
    )


_user_cache: dict[str, tuple[float, ConsoleUser | None]] = {}


async def _load_by(column: str, value: str) -> ConsoleUser | None:
    assert column in ("id", "email")
    key = f"{column}:{value}"
    hit = _user_cache.get(key)
    if hit and time.monotonic() - hit[0] < 15:
        return hit[1]
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        try:
            row = await conn.fetchrow(
                f"select id, tenant_id, email, display_name, title, role, persona from console_users where {column} = $1",
                value if column == "email" else _uuid(value),
            )
        except ValueError:
            row = None
    user = ConsoleUser(**{**dict(row), "id": str(row["id"])}) if row else None
    _user_cache[key] = (time.monotonic(), user)
    return user


def _uuid(v: str) -> uuid.UUID:
    return uuid.UUID(v)


async def _touch(user_id: str) -> None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute("update console_users set last_login_at = now() where id = $1", _uuid(user_id))


_firebase_jwks: PyJWKClient | None = None
_FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"


async def _from_firebase(token: str) -> ConsoleUser:
    global _firebase_jwks
    if _firebase_jwks is None:
        _firebase_jwks = PyJWKClient(_FIREBASE_JWKS_URL, cache_keys=True, lifespan=3600)
    pid = config.FIREBASE_PROJECT_ID
    try:
        key = await asyncio.to_thread(_firebase_jwks.get_signing_key_from_jwt, token)
        claims = jwt.decode(token, key.key, algorithms=["RS256"], audience=pid, issuer=f"https://securetoken.google.com/{pid}")
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"Invalid sign-in token: {e}")
    email = (claims.get("email") or "").lower()
    if not email or not claims.get("email_verified"):
        raise HTTPException(403, "Sign-in account has no verified email.")
    user = await _load_by("email", email)
    if user is None and email in config.CONSOLE_BOOTSTRAP_ADMINS:
        pool = await db.get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """insert into console_users (tenant_id, email, display_name, role) values ($1, $2, $3, 'platform_admin')
                   on conflict (email) do nothing""",
                config.DEFAULT_TENANT, email, claims.get("name") or email,
            )
        _user_cache.pop(f"email:{email}", None)
        user = await _load_by("email", email)
    if user is None:
        raise HTTPException(403, "This account hasn't been given console access. Ask your administrator.")
    return user


async def current_user(authorization: str | None = Header(default=None)) -> ConsoleUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in required.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        unverified = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        raise HTTPException(401, "Malformed token.")

    if unverified.get("iss") == DEMO_ISSUER:
        if not config.DEMO_MODE:
            raise HTTPException(401, "Demo sessions are disabled.")
        try:
            claims = jwt.decode(token, _demo_secret, algorithms=["HS256"], issuer=DEMO_ISSUER)
        except jwt.PyJWTError as e:
            raise HTTPException(401, f"Session expired or invalid: {e}")
        user = await _load_by("id", claims["sub"])
        if user is None:
            raise HTTPException(401, "Unknown user.")
        return user

    if config.FIREBASE_PROJECT_ID:
        return await _from_firebase(token)
    raise HTTPException(401, "Unrecognised token.")


def require(perm: str | None = None):
    """Dependency: any signed-in console user, or one holding `perm`."""

    async def dep(user: ConsoleUser = Depends(current_user)) -> ConsoleUser:
        if perm and not user.can(perm):
            raise HTTPException(403, f"Your role ({ROLE_LABELS[user.role]}) doesn't have access to this. Required: {perm}.")
        return user

    return dep


async def can_see_identities(user: ConsoleUser) -> bool:
    """CISO/compliance always see who did what. Executives see names only
    when the tenant's privacy mode is 'named'; otherwise pseudonyms."""
    if user.can("view_identities"):
        return True
    if user.role != "executive":
        return False
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        settings = await conn.fetchval("select settings from tenants where id = $1", user.tenant_id)
    return (settings or {}).get("privacy_mode", "named") == "named"
