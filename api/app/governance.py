"""
Policy change management and console activity log.

A policy change is proposed as a new version in 'pending_approval'. It
becomes active only when a different console user with approve_policy
approves it (two-person rule); the previous active version is superseded.
Every step is written to admin_events, which the evidence pack reports as
change-management evidence.

Impact simulation replays recent audit records (department + data classes
found) against the proposed document, so an approver sees "this would have
blocked N more requests last week" before deciding. Raw prompt text is never
stored, so deny terms can't be replayed; the result says so.
"""
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from . import db, policy
from .console_auth import ConsoleUser
from .redaction import PII_LABELS, Vault, detect, redact

Action = Literal["allow", "redact", "block"]
Tier = Literal["fast", "balanced", "deep"]


class DepartmentRules(BaseModel):
    data_classes: dict[str, Action] = Field(default_factory=lambda: {"*": "redact"})
    rehydrate: dict[str, bool] = Field(default_factory=dict)
    max_tier: Tier = "deep"
    rate_limit_per_user_per_min: int = Field(30, ge=1, le=1000)

    @field_validator("data_classes", "rehydrate")
    @classmethod
    def known_classes(cls, v: dict) -> dict:
        unknown = [k for k in v if k != "*" and k not in PII_LABELS]
        if unknown:
            raise ValueError(f"unknown data class(es): {', '.join(unknown)}")
        return v


class GlobalRules(BaseModel):
    deny_terms: list[str] = Field(default_factory=list, max_length=50)
    prompt_injection: Literal["off", "flag", "block"] = "flag"
    rehydrate: dict[str, bool] = Field(default_factory=dict)

    @field_validator("deny_terms")
    @classmethod
    def tidy_terms(cls, v: list[str]) -> list[str]:
        terms = [t.strip() for t in v if t.strip()]
        if any(len(t) > 80 for t in terms):
            raise ValueError("deny terms must be 80 characters or fewer")
        return terms


class PolicyDoc(BaseModel):
    departments: dict[str, DepartmentRules]
    global_: GlobalRules = Field(default_factory=GlobalRules, alias="global")

    def dump(self) -> dict:
        return self.model_dump(by_alias=True)


async def log(user: ConsoleUser, action: str, target: str = "", detail: dict | None = None) -> None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "insert into admin_events (tenant_id, actor, actor_role, action, target, detail) values ($1, $2, $3, $4, $5, $6)",
            user.tenant_id, user.email, user.role, action, target, detail or {},
        )


async def _departments(tenant_id: str) -> dict[str, str]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("select id, label from departments where tenant_id = $1", tenant_id)
    return {r["id"]: r["label"] for r in rows}


async def validate_doc(tenant_id: str, doc: PolicyDoc) -> dict:
    known = await _departments(tenant_id)
    unknown = [d for d in doc.departments if d not in known]
    if unknown:
        raise ValueError(f"unknown department(s): {', '.join(unknown)}")
    return doc.dump()


async def list_versions(tenant_id: str) -> list[dict]:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """select version, status, note, decision_note, created_by, created_at, approved_by, approved_at, doc
               from policies where tenant_id = $1 order by version desc""",
            tenant_id,
        )
    return [{**dict(r), "created_at": r["created_at"].isoformat(),
             "approved_at": r["approved_at"].isoformat() if r["approved_at"] else None} for r in rows]


async def propose(user: ConsoleUser, doc: dict, note: str) -> int:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("select pg_advisory_xact_lock(hashtext('sf_policy_' || $1))", user.tenant_id)
            pending = await conn.fetchval(
                "select version from policies where tenant_id = $1 and status = 'pending_approval'", user.tenant_id
            )
            if pending:
                raise ValueError(f"Version {pending} is already waiting for approval. Approve or reject it first.")
            version = await conn.fetchval(
                "select coalesce(max(version), 0) + 1 from policies where tenant_id = $1", user.tenant_id
            )
            await conn.execute(
                """insert into policies (tenant_id, version, doc, status, created_by, note)
                   values ($1, $2, $3, 'pending_approval', $4, $5)""",
                user.tenant_id, version, doc, user.email, note.strip()[:500],
            )
    await log(user, "policy.proposed", f"v{version}", {"note": note[:500]})
    return version


async def decide(user: ConsoleUser, version: int, approve: bool, note: str) -> None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "select status, created_by from policies where tenant_id = $1 and version = $2 for update",
                user.tenant_id, version,
            )
            if row is None:
                raise LookupError(f"No policy version {version}.")
            if row["status"] != "pending_approval":
                raise ValueError(f"Version {version} is {row['status'].replace('_', ' ')}, not waiting for approval.")
            if row["created_by"] == user.email:
                raise PermissionError("Two-person rule: the person who proposed a change can't approve it.")
            if approve:
                await conn.execute(
                    "update policies set status = 'superseded' where tenant_id = $1 and status = 'active'", user.tenant_id
                )
            await conn.execute(
                """update policies set status = $3, approved_by = $4, approved_at = now(), decision_note = $5
                   where tenant_id = $1 and version = $2""",
                user.tenant_id, version, "active" if approve else "rejected", user.email, note.strip()[:500] or None,
            )
    policy.invalidate(user.tenant_id)
    await log(user, "policy.approved" if approve else "policy.rejected", f"v{version}", {"note": note[:500]})


async def simulate_prompt(tenant_id: str, doc: dict, department: str, prompt: str) -> dict:
    """The same prompt under the active and the proposed policy."""
    active = await policy.get_active(tenant_id)
    proposed = policy.ActivePolicy(tenant_id, active.version + 1, doc, active.department_labels)
    pii = [d.pii_type for d in detect(prompt)]

    def outcome(p: policy.ActivePolicy) -> dict:
        d = policy.evaluate(p, department, pii, prompt)
        text, _ = redact(prompt, Vault(), frozenset(d.allowed_raw_types))
        return {"allowed": d.allowed, "reason": d.reason, "flags": d.flags, "sent_to_model": text if d.allowed else None,
                "max_tier": d.max_tier}

    return {"data_classes": sorted(set(pii)), "active": outcome(active), "proposed": outcome(proposed)}


async def simulate_impact(tenant_id: str, doc: dict, days: int = 7) -> dict:
    """Replay recent traffic: how many requests would change outcome."""
    active = await policy.get_active(tenant_id)
    proposed = policy.ActivePolicy(tenant_id, active.version + 1, doc, active.department_labels)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """select department, pii_types, flags, decision, policy_reason from audit_events
               where tenant_id = $1 and ts >= $2 and endpoint = '/v1/chat/completions'""",
            tenant_id, since,
        )
    by_dept: dict[str, dict] = {}
    totals = {"replayed": 0, "newly_blocked": 0, "newly_allowed": 0, "blocked_before": 0, "blocked_after": 0}
    for r in rows:
        if (r["policy_reason"] or "").startswith(("Rate limit", "Restricted term")):
            continue  # can't be replayed without the raw prompt
        injected = "prompt_injection" in r["flags"]

        def blocked(p: policy.ActivePolicy) -> bool:
            d = policy.evaluate(p, r["department"], r["pii_types"], "")
            return not d.allowed or (injected and p.doc.get("global", {}).get("prompt_injection") == "block")

        before, after = blocked(active), blocked(proposed)
        totals["replayed"] += 1
        totals["blocked_before"] += before
        totals["blocked_after"] += after
        dept = by_dept.setdefault(r["department"], {"department": r["department"],
                                                    "department_label": active.department_labels.get(r["department"], r["department"]),
                                                    "requests": 0, "newly_blocked": 0, "newly_allowed": 0})
        dept["requests"] += 1
        if after and not before:
            totals["newly_blocked"] += 1
            dept["newly_blocked"] += 1
        elif before and not after:
            totals["newly_allowed"] += 1
            dept["newly_allowed"] += 1
    return {
        "window_days": days, **totals,
        "by_department": sorted(by_dept.values(), key=lambda d: -(d["newly_blocked"] + d["newly_allowed"])),
        "note": "Replays data classes and prompt-injection flags. Deny terms and rate limits need the original prompt, which is never stored.",
    }


def policy_packs(department_ids: list[str]) -> dict[str, dict]:
    """Starting points offered during onboarding."""
    def doc(per_dept, glob) -> dict:
        return {"departments": {d: per_dept(d) for d in department_ids}, "global": glob}

    sensitive = {"AU_TFN": "block", "AU_MEDICARE": "block", "CREDIT_CARD": "block", "*": "redact"}
    return {
        "apra_baseline": {
            "label": "APRA CPS 234 baseline",
            "summary": "Redact every identifier; block health and card data outside the teams that need it; flag prompt injection.",
            "doc": {**policy.DEFAULT_POLICY,
                    "departments": {d: policy.DEFAULT_POLICY["departments"].get(d, {"data_classes": {"*": "redact"}})
                                    for d in department_ids}},
        },
        "strict": {
            "label": "Strict",
            "summary": "Block TFN, Medicare and card numbers everywhere except Legal & Risk; block prompt injection; cap model tier.",
            "doc": doc(lambda d: {"data_classes": {"*": "redact"}} if d == "legal_risk"
                       else {"data_classes": sensitive, "max_tier": "balanced"},
                       {"deny_terms": [], "prompt_injection": "block", "rehydrate": {"CREDIT_CARD": False}}),
        },
        "observe": {
            "label": "Observe only (pilot)",
            "summary": "Redact and log everything, block nothing. For a shadow pilot that measures exposure before enforcing.",
            "doc": doc(lambda d: {"data_classes": {"*": "redact"}},
                       {"deny_terms": [], "prompt_injection": "flag", "rehydrate": {}}),
        },
    }
