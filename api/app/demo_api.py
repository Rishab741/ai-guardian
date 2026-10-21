"""
Presenter-only routes (DEMO_MODE). They don't exist in a production
deployment: every route here returns 404 when DEMO_MODE is off.

* Demo identity provider for Advisor Assist: the mock bank app looks up a
  fictional employee and gets a signed identity token for them, standing in
  for the bank's Entra ID. Authenticated with the app's own API key and
  limited to synthetic people.
* Traffic simulator ticks and scenarios for the Command Centre.
* Warm-up: touches the database, embeddings and the fast model so the first
  live request on stage isn't a cold one.
"""
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import cache, config, console_auth, db, providers, routing, simulator
from .console_auth import ConsoleUser, require
from .identity import AppIdentity
from .openai_api import require_app

router = APIRouter(prefix="/api/demo")


def _demo_only() -> None:
    if not config.DEMO_MODE:
        raise HTTPException(404)


@router.get("/directory", dependencies=[Depends(_demo_only)])
async def directory(app: AppIdentity = Depends(require_app)):
    """Fictional employees in the app's department (what a real app would
    get from the bank's directory)."""
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """select id, display_name, title, department from end_users
               where tenant_id = $1 and synthetic and department = $2 order by display_name""",
            app.tenant_id, app.default_department,
        )
    return [dict(r) for r in rows]


class TokenRequest(BaseModel):
    user_id: str


@router.post("/idp-token", dependencies=[Depends(_demo_only)])
async def idp_token(body: TokenRequest, app: AppIdentity = Depends(require_app)):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        person = await conn.fetchrow(
            "select external_ref, display_name, department from end_users where tenant_id = $1 and id = $2 and synthetic",
            app.tenant_id, body.user_id,
        )
    if person is None:
        raise HTTPException(404, "No such fictional employee.")
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"iss": console_auth.DEMO_IDP_ISSUER, "email": person["external_ref"], "name": person["display_name"],
         "department": person["department"], "iat": now, "exp": now + timedelta(minutes=15)},
        console_auth.demo_secret(), algorithm="HS256",
    )
    return {"token": token, "expires_in": 900}


class Tick(BaseModel):
    count: int = Field(1, ge=1, le=5)
    scenario: str | None = None


@router.get("/scenarios", dependencies=[Depends(_demo_only)])
async def scenarios(user: ConsoleUser = Depends(require())):
    return {k: v["label"] for k, v in simulator.SCENARIOS.items()}


@router.post("/tick", dependencies=[Depends(_demo_only)])
async def tick(body: Tick, user: ConsoleUser = Depends(require())):
    if body.scenario and body.scenario not in simulator.SCENARIOS:
        raise HTTPException(422, "Unknown scenario.")
    ids = await simulator.tick(user.tenant_id, body.count, body.scenario)
    return {"audit_ids": ids}


@router.post("/warmup", dependencies=[Depends(_demo_only)])
async def warmup(user: ConsoleUser = Depends(require())):
    checks = []

    async def timed(name, fn):
        t = time.perf_counter()
        try:
            detail = await fn()
            checks.append({"name": name, "ok": True, "ms": int((time.perf_counter() - t) * 1000), "detail": detail})
        except Exception as e:  # report every failure; the presenter decides
            checks.append({"name": name, "ok": False, "ms": int((time.perf_counter() - t) * 1000), "detail": str(e)[:200]})

    async def database():
        pool = await db.get_pool()
        async with pool.acquire() as conn:
            n = await conn.fetchval("select count(*) from audit_events where tenant_id = $1", user.tenant_id)
        return f"{n:,} audit records"

    async def embeddings():
        e = await cache.embed("warm-up")
        return f"{e.model}{' (local fallback)' if e.degraded else ''}"

    async def model():
        if config.LLM_PROVIDER == "simulated":
            return "offline mode: simulated answers"
        await providers.get("gemini").chat(routing.model_for("fast"), [{"role": "user", "content": "Reply with OK"}],
                                               providers.ChatParams(max_tokens=5))
        return f"{routing.model_for('fast')} answered"

    await timed("Database", database)
    await timed("Embeddings", embeddings)
    await timed("Fast model", model)
    return {"ok": all(c["ok"] for c in checks), "checks": checks}
