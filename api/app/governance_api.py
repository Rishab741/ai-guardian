"""
Console routes for Phase 4: live feed, people and app risk, policy change
management, tenant setup and the APRA evidence pack. Same rules as
console_api: every route declares its permission.
"""
import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ValidationError

from . import console_auth, db, feed, governance, identity, reports, stats
from .console_api import _pseudonym, _since
from .console_auth import ConsoleUser, require
from .governance import PolicyDoc

router = APIRouter(prefix="/api")


# ── live feed ────────────────────────────────────────────────────────────────

@router.get("/events/stream")
async def event_stream(request: Request, user: ConsoleUser = Depends(require("view_dashboards"))):
    """Server-sent events: one line per audited request, as it happens."""
    names = await console_auth.can_see_identities(user)
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("select id, display_name from end_users where tenant_id = $1", user.tenant_id)
        staff = await conn.fetch("select email, display_name from console_users where tenant_id = $1", user.tenant_id)
    display = {r["id"]: r["display_name"] for r in rows}
    console_names = {r["email"]: r["display_name"] for r in staff}
    queue = await feed.subscribe()

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if event.get("tenant_id") != user.tenant_id:
                    continue
                uid = event.get("end_user_id")
                if uid and event.get("source") != "console":
                    event["user_label"] = display.get(uid, uid) if names else _pseudonym(uid)
                    if not names:
                        event["end_user_id"] = event["user_label"]
                else:
                    # Playground requests are made by console staff, who are always named.
                    event["user_label"] = console_names.get(uid or "", event.get("app_name") or "Console")
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            feed.unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"})


# ── people and apps ──────────────────────────────────────────────────────────

@router.get("/stats/apps")
async def stats_apps(window_days: int = 30, user: ConsoleUser = Depends(require("view_dashboards"))):
    return await stats.apps(user.tenant_id, _since(window_days))


async def _resolve_person(user: ConsoleUser, ref: str) -> str | None:
    """Accept a real id, or a pseudonym from a privacy-mode view."""
    if not ref.startswith("User "):
        return ref
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        ids = await conn.fetch("select id from end_users where tenant_id = $1", user.tenant_id)
    return next((r["id"] for r in ids if _pseudonym(r["id"]) == ref), None)


@router.get("/people/{ref}")
async def person(ref: str, days: int = 30, user: ConsoleUser = Depends(require("view_risk"))):
    user_id = await _resolve_person(user, ref)
    profile = await stats.user_profile(user.tenant_id, user_id, min(max(days, 1), 365)) if user_id else None
    if profile is None:
        raise HTTPException(404, "No such person in this tenant.")
    names = await console_auth.can_see_identities(user)
    events = await stats.recent(user.tenant_id, 25, None, user_id)
    for e in events:
        if not user.can("view_audit_detail"):
            e["prompt_redacted"], e["response_redacted"] = "[restricted: requires audit-detail access]", None
        if not names:
            e["user_label"] = e["end_user_id"] = _pseudonym(user_id)
    if not names:
        profile["user"].update(id=_pseudonym(user_id), display_name=_pseudonym(user_id), title="")
    return {**profile, "events": events, "identity_visible": names}


# ── policy change management ─────────────────────────────────────────────────

class Proposal(BaseModel):
    doc: dict
    note: str = Field("", max_length=500)


class Decision(BaseModel):
    note: str = Field("", max_length=500)


class PromptTest(BaseModel):
    doc: dict
    department: str
    prompt: str = Field(..., min_length=1, max_length=4000)


class ImpactRequest(BaseModel):
    doc: dict
    days: int = Field(7, ge=1, le=90)


async def _checked(user: ConsoleUser, raw: dict) -> dict:
    try:
        return await governance.validate_doc(user.tenant_id, PolicyDoc.model_validate(raw))
    except (ValidationError, ValueError) as e:
        raise HTTPException(422, f"Policy isn't valid: {e}")


@router.get("/policies")
async def policies(user: ConsoleUser = Depends(require("view_dashboards"))):
    return await governance.list_versions(user.tenant_id)


@router.get("/policies/packs")
async def policy_packs(user: ConsoleUser = Depends(require("draft_policy"))):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        depts = [r["id"] for r in await conn.fetch("select id from departments where tenant_id = $1", user.tenant_id)]
    return governance.policy_packs(depts)


@router.post("/policies")
async def propose_policy(body: Proposal, user: ConsoleUser = Depends(require("draft_policy"))):
    doc = await _checked(user, body.doc)
    try:
        version = await governance.propose(user, doc, body.note)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"version": version, "status": "pending_approval"}


@router.post("/policies/{version}/approve")
async def approve_policy(version: int, body: Decision, user: ConsoleUser = Depends(require("approve_policy"))):
    return await _decide(user, version, True, body.note)


@router.post("/policies/{version}/reject")
async def reject_policy(version: int, body: Decision, user: ConsoleUser = Depends(require("approve_policy"))):
    return await _decide(user, version, False, body.note)


async def _decide(user: ConsoleUser, version: int, approve: bool, note: str) -> dict:
    try:
        await governance.decide(user, version, approve, note)
    except LookupError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {"version": version, "status": "active" if approve else "rejected"}


@router.post("/policies/simulate/prompt")
async def simulate_prompt(body: PromptTest, user: ConsoleUser = Depends(require("view_dashboards"))):
    doc = await _checked(user, body.doc)
    return await governance.simulate_prompt(user.tenant_id, doc, body.department, body.prompt)


@router.post("/policies/simulate/impact")
async def simulate_impact(body: ImpactRequest, user: ConsoleUser = Depends(require("view_dashboards"))):
    doc = await _checked(user, body.doc)
    return await governance.simulate_impact(user.tenant_id, doc, body.days)


# ── tenant setup ─────────────────────────────────────────────────────────────

class Settings(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=120)
    privacy_mode: str | None = Field(None, pattern="^(named|pseudonymous)$")
    employee_notice: str | None = Field(None, max_length=1500)
    sso: dict | None = None
    onboarding: dict | None = None


@router.get("/settings")
async def get_settings(user: ConsoleUser = Depends(require())):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("select name, settings from tenants where id = $1", user.tenant_id)
    return {"name": row["name"], **row["settings"]}


@router.put("/settings")
async def put_settings(body: Settings, user: ConsoleUser = Depends(require("manage_settings"))):
    patch = body.model_dump(exclude_none=True)
    name = patch.pop("name", None)
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "update tenants set settings = settings || $2, name = coalesce($3, name) where id = $1",
            user.tenant_id, patch, name,
        )
    await governance.log(user, "settings.updated", "", {"fields": sorted(patch) + (["name"] if name else [])})
    return await get_settings(user)


class NewDepartment(BaseModel):
    id: str = Field(..., pattern="^[a-z][a-z0-9_]{1,40}$")
    label: str = Field(..., min_length=2, max_length=80)


@router.post("/departments")
async def add_department(body: NewDepartment, user: ConsoleUser = Depends(require("manage_settings"))):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        status = await conn.execute(
            "insert into departments (tenant_id, id, label) values ($1, $2, $3) on conflict do nothing",
            user.tenant_id, body.id, body.label,
        )
    if status.endswith(" 0"):
        raise HTTPException(409, "That department already exists.")
    await governance.log(user, "department.added", body.id, {"label": body.label})
    return {"id": body.id, "label": body.label,
            "note": "New departments have no entitlements until a policy version that includes them is approved."}


class NewApp(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    description: str = Field("", max_length=300)
    default_department: str


@router.get("/apps")
async def list_apps(user: ConsoleUser = Depends(require("manage_apps"))):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select a.id, a.name, a.description, a.default_department, a.disabled, a.created_at,
                   (select prefix from app_keys k where k.app_id = a.id and k.revoked_at is null order by created_at desc limit 1) as key_prefix,
                   (select max(last_used_at) from app_keys k where k.app_id = a.id) as last_used_at
            from apps a where a.tenant_id = $1 order by a.created_at
            """,
            user.tenant_id,
        )
    return [{**dict(r), "id": str(r["id"]), "created_at": r["created_at"].isoformat(),
             "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None} for r in rows]


@router.post("/apps")
async def create_app(body: NewApp, user: ConsoleUser = Depends(require("manage_apps"))):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        if not await conn.fetchval("select exists(select 1 from departments where tenant_id = $1 and id = $2)",
                                   user.tenant_id, body.default_department):
            raise HTTPException(422, "Unknown department.")
        app_id = await conn.fetchval(
            """insert into apps (tenant_id, name, description, default_department) values ($1, $2, $3, $4)
               on conflict (tenant_id, name) do nothing returning id""",
            user.tenant_id, body.name.strip(), body.description.strip(), body.default_department,
        )
    if app_id is None:
        raise HTTPException(409, "An app with that name already exists.")
    key = await identity.create_key(app_id)
    await governance.log(user, "app.created", body.name, {"department": body.default_department})
    return {"id": str(app_id), "name": body.name, "api_key": key,
            "note": "Copy this key now. Only a hash is stored, so it can't be shown again."}


@router.post("/apps/{app_id}/rotate-key")
async def rotate_key(app_id: str, user: ConsoleUser = Depends(require("manage_apps"))):
    try:
        aid = uuid.UUID(app_id)
    except ValueError:
        raise HTTPException(404, "No such app.")
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        name = await conn.fetchval("select name from apps where id = $1 and tenant_id = $2", aid, user.tenant_id)
        if name is None:
            raise HTTPException(404, "No such app.")
        await conn.execute("update app_keys set revoked_at = now() where app_id = $1 and revoked_at is null", aid)
    identity._key_cache.clear()
    key = await identity.create_key(aid)
    await governance.log(user, "app.key_rotated", name)
    return {"api_key": key, "note": "The previous key stopped working immediately."}


@router.get("/admin-events")
async def admin_events(limit: int = 50, user: ConsoleUser = Depends(require("view_audit_detail"))):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "select ts, actor, actor_role, action, target, detail from admin_events where tenant_id = $1 order by ts desc limit $2",
            user.tenant_id, min(limit, 200),
        )
    return [{**dict(r), "ts": r["ts"].isoformat()} for r in rows]


# ── evidence pack ────────────────────────────────────────────────────────────

@router.get("/reports/evidence")
async def evidence(days: int = 30, user: ConsoleUser = Depends(require("export_reports"))):
    days = min(max(days, 1), 365)
    pack = await reports.evidence(user.tenant_id, days)
    await governance.log(user, "report.generated", "apra_evidence_pack", {"days": days})
    return pack
