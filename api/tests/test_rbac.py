"""Console access control: every route is protected, and each role sees
exactly what it should."""
from datetime import datetime, timedelta, timezone

import jwt
import openai
import pytest

from app import config, db
from app.console_auth import DEMO_IDP_ISSUER, DEMO_ISSUER
from app.main import app

from .conftest import fetchrow, token_for

PUBLIC = {("GET", "/api/health"), ("GET", "/api/auth/config"), ("POST", "/api/auth/demo-login")}


async def test_every_console_route_requires_sign_in(http):
    checked = 0
    for path, ops in app.openapi()["paths"].items():
        if not path.startswith("/api/"):
            continue
        for method in (m.upper() for m in ops):
            if (method, path) in PUBLIC:
                continue
            r = await http.request(method, path, json={})
            assert r.status_code == 401, f"{method} {path} returned {r.status_code} without a session"
            checked += 1
    assert checked >= 14  # guards against the enumeration silently finding nothing


MATRIX = {
    # endpoint: roles allowed (everything else must get 403)
    ("GET", "/api/stats/summary"): {"executive", "ciso", "compliance", "tenant_admin"},
    ("GET", "/api/stats/risky-users"): {"executive", "ciso", "compliance"},
    ("GET", "/api/audit-logs?limit=5"): {"executive", "ciso", "compliance", "tenant_admin"},
    ("GET", "/api/audit/verify"): {"ciso", "compliance"},
    ("GET", "/api/discovery-report"): {"executive", "ciso", "compliance", "tenant_admin"},
    ("POST", "/api/chat"): {"ciso", "tenant_admin", "developer"},
}
ROLES = ("executive", "ciso", "compliance", "tenant_admin", "developer")


@pytest.mark.parametrize("endpoint", list(MATRIX))
async def test_role_matrix(http, endpoint):
    method, path = endpoint
    for role in ROLES:
        r = await http.request(method, path, headers={"Authorization": await token_for(http, role)},
                               json={"message": "hello", "department": "finance"} if method == "POST" else None)
        expected = 200 if role in MATRIX[endpoint] else 403
        assert r.status_code == expected, f"{role} {method} {path}: {r.status_code}"


async def test_prompt_contents_need_audit_detail(http):
    await http.post("/api/chat", headers={"Authorization": await token_for(http, "ciso")},
                    json={"message": "Draft a note about TFN 123 456 782", "department": "legal_risk"})
    admin = (await http.get("/api/audit-logs?limit=3", headers={"Authorization": await token_for(http, "tenant_admin")})).json()
    ciso = (await http.get("/api/audit-logs?limit=3", headers={"Authorization": await token_for(http, "ciso")})).json()
    assert all(r["prompt_redacted"].startswith("[restricted") for r in admin)
    assert any("⟦AU_TFN_1⟧" in r["prompt_redacted"] for r in ciso)


async def test_executives_see_pseudonyms_when_privacy_mode_requires(http, client):
    await client.chat.completions.create(model="sf-fast", user="amelia.whitlock@harbourbank.example",
                                         messages=[{"role": "user", "content": "Summarise churn for retail"}])
    exec_auth = {"Authorization": await token_for(http, "executive")}
    named = (await http.get("/api/stats/risky-users", headers=exec_auth)).json()
    assert any(r["user_id"] == "amelia.whitlock@harbourbank.example" for r in named)

    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute("update tenants set settings = settings || '{\"privacy_mode\": \"pseudonymous\"}'::jsonb")
    try:
        hidden = (await http.get("/api/stats/risky-users", headers=exec_auth)).json()
        assert hidden and all(r["user_id"].startswith("User ") for r in hidden)
        ciso = (await http.get("/api/stats/risky-users", headers={"Authorization": await token_for(http, "ciso")})).json()
        assert any("@" in r["user_id"] for r in ciso)
    finally:
        async with pool.acquire() as conn:
            await conn.execute("update tenants set settings = settings || '{\"privacy_mode\": \"named\"}'::jsonb")


async def test_forged_and_expired_tokens_are_rejected(http):
    persona = (await http.get("/api/auth/config")).json()["personas"][0]
    now = datetime.now(timezone.utc)
    forged = jwt.encode({"iss": DEMO_ISSUER, "sub": persona["id"], "exp": now + timedelta(hours=1)}, "wrong-secret-xxxxxxxxxxxxxxxxxxxxxxxx", "HS256")
    expired = jwt.encode({"iss": DEMO_ISSUER, "sub": persona["id"], "exp": now - timedelta(minutes=1)}, config.DEMO_TOKEN_SECRET, "HS256")
    for t in (forged, expired, "not-a-jwt"):
        assert (await http.get("/api/auth/me", headers={"Authorization": f"Bearer {t}"})).status_code == 401


async def test_access_code_gate(http, monkeypatch):
    monkeypatch.setattr(config, "DEMO_ACCESS_CODE", "harbour-2026")
    persona = (await http.get("/api/auth/config")).json()["personas"][0]
    bad = await http.post("/api/auth/demo-login", json={"persona_id": persona["id"], "access_code": "guess"})
    good = await http.post("/api/auth/demo-login", json={"persona_id": persona["id"], "access_code": "harbour-2026"})
    assert bad.status_code == 403 and good.status_code == 200


def _user_token(claims: dict, secret: str | None = None) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"iss": DEMO_IDP_ISSUER, "exp": now + timedelta(minutes=5), **claims},
                      secret or config.DEMO_TOKEN_SECRET, "HS256")


async def test_verified_user_token_sets_identity_and_department(client):
    token = _user_token({"email": "noah.chen@harbourbank.example", "name": "Noah Chen", "department": "finance"})
    raw = await client.chat.completions.with_raw_response.create(
        model="sf-fast", user="someone-else@example.com",  # an unverified claim must not win
        messages=[{"role": "user", "content": "Reconcile the ledger"}],
        extra_headers={"X-SF-User-Token": token},
    )
    row = await fetchrow("select end_user_id, user_verified, department from audit_events where id = $1",
                         int(raw.headers["x-sf-audit-id"]))
    assert dict(row) == {"end_user_id": "noah.chen@harbourbank.example", "user_verified": True, "department": "finance"}


async def test_bad_user_token_is_rejected(client):
    with pytest.raises(openai.AuthenticationError) as exc:
        await client.chat.completions.create(
            model="sf-fast", messages=[{"role": "user", "content": "hi"}],
            extra_headers={"X-SF-User-Token": _user_token({"email": "x@y.z"}, secret="not-the-idp-secret-xxxxxxxxxxxxx")},
        )
    assert exc.value.code == "invalid_user_token"
