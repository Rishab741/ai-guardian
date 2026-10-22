"""Phase 4: policy change management, live feed, app keys, evidence pack."""
import asyncio
import copy

import openai
import pytest

from app import audit, feed
from app.policy import DEFAULT_POLICY

from .conftest import token_for


async def auth(http, role):
    return {"Authorization": await token_for(http, role)}


def doc_blocking_email_in_retail() -> dict:
    doc = copy.deepcopy(DEFAULT_POLICY)
    doc["departments"]["retail_banking"]["data_classes"]["EMAIL"] = "block"
    return doc


async def test_policy_change_needs_a_second_person_and_then_takes_effect(http, client):
    q = [{"role": "user", "content": "Email jo.bloggs@example.com about her statement"}]
    await client.chat.completions.create(model="sf-fast", messages=q, extra_headers={"X-SF-Cache": "no-store"})

    impact = await http.post("/api/policies/simulate/impact", headers=await auth(http, "ciso"),
                             json={"doc": doc_blocking_email_in_retail(), "days": 7})
    assert impact.status_code == 200 and impact.json()["newly_blocked"] >= 1

    proposed = await http.post("/api/policies", headers=await auth(http, "ciso"),
                               json={"doc": doc_blocking_email_in_retail(), "note": "Stop customer emails leaving"})
    assert proposed.status_code == 200
    version = proposed.json()["version"]

    again = await http.post("/api/policies", headers=await auth(http, "ciso"), json={"doc": DEFAULT_POLICY})
    assert again.status_code == 409  # one pending change at a time

    assert (await http.post(f"/api/policies/{version}/approve", headers=await auth(http, "ciso"), json={})).status_code == 403
    ok = await http.post(f"/api/policies/{version}/approve", headers=await auth(http, "executive"), json={"note": "Agreed"})
    assert ok.status_code == 200

    with pytest.raises(openai.PermissionDeniedError):
        await client.chat.completions.create(model="sf-fast", messages=q, extra_headers={"X-SF-Cache": "no-store"})

    # restore for other tests: propose the default again and approve it
    v2 = (await http.post("/api/policies", headers=await auth(http, "ciso"), json={"doc": DEFAULT_POLICY})).json()["version"]
    await http.post(f"/api/policies/{v2}/approve", headers=await auth(http, "executive"), json={})
    versions = (await http.get("/api/policies", headers=await auth(http, "executive"))).json()
    assert [v["status"] for v in versions[:3]] == ["active", "superseded", "superseded"]


async def test_invalid_policy_is_rejected(http):
    bad = copy.deepcopy(DEFAULT_POLICY)
    bad["departments"]["finance"]["data_classes"]["PASSPORT"] = "block"
    r = await http.post("/api/policies", headers=await auth(http, "ciso"), json={"doc": bad})
    assert r.status_code == 422 and "PASSPORT" in r.text


async def test_prompt_simulation_compares_active_and_proposed(http):
    r = await http.post("/api/policies/simulate/prompt", headers=await auth(http, "executive"), json={
        "doc": doc_blocking_email_in_retail(), "department": "retail_banking", "prompt": "Write to a@b.com"})
    body = r.json()
    assert body["active"]["allowed"] and body["active"]["sent_to_model"] == "Write to ⟦EMAIL_1⟧"
    assert not body["proposed"]["allowed"]


async def test_live_feed_receives_audit_events():
    q = await feed.subscribe()
    try:
        await audit.append([{"tenant_id": "harbour", "source": "gateway", "endpoint": "/v1/chat/completions",
                             "department": "finance", "department_label": "Finance", "decision": "allowed",
                             "prompt_redacted": "feed test"}])
        event = await asyncio.wait_for(q.get(), timeout=5)
        assert event["department"] == "finance" and event["tenant_id"] == "harbour"
    finally:
        feed.unsubscribe(q)


async def test_app_lifecycle_and_key_rotation(http):
    admin = await auth(http, "tenant_admin")
    created = (await http.post("/api/apps", headers=admin, json={"name": "Wealth Copilot", "default_department": "finance"})).json()
    key = created["api_key"]
    app_client = openai.AsyncOpenAI(base_url="http://gateway/v1", api_key=key, http_client=http, max_retries=0)
    await app_client.chat.completions.create(model="sf-fast", messages=[{"role": "user", "content": "hello"}])

    rotated = (await http.post(f"/api/apps/{created['id']}/rotate-key", headers=admin)).json()
    with pytest.raises(openai.AuthenticationError):
        await app_client.chat.completions.create(model="sf-fast", messages=[{"role": "user", "content": "hello"}])
    fresh = openai.AsyncOpenAI(base_url="http://gateway/v1", api_key=rotated["api_key"], http_client=http, max_retries=0)
    await fresh.chat.completions.create(model="sf-fast", messages=[{"role": "user", "content": "hello"}])
    assert (await http.get("/api/apps", headers=await auth(http, "developer"))).status_code == 403


async def test_evidence_pack(http):
    r = await http.get("/api/reports/evidence?days=30", headers=await auth(http, "compliance"))
    pack = r.json()
    assert r.status_code == 200
    assert pack["cps234"]["audit_integrity"]["ok"] is True
    assert pack["cps230"]["service_providers"]
    assert any(e["action"] == "policy.approved" for e in pack["cps234"]["change_management"]["console_actions"])
    assert (await http.get("/api/reports/evidence", headers=await auth(http, "developer"))).status_code == 403


async def test_person_view_respects_privacy(http, client):
    await client.chat.completions.create(model="sf-fast", user="isla.doyle@harbourbank.example",
                                         messages=[{"role": "user", "content": "Card 4111 1111 1111 1111 please"}])
    ciso = (await http.get("/api/people/isla.doyle@harbourbank.example", headers=await auth(http, "ciso"))).json()
    assert ciso["totals"]["requests"] >= 1 and ciso["identity_visible"]
    admin = await http.get("/api/people/isla.doyle@harbourbank.example", headers=await auth(http, "tenant_admin"))
    assert admin.status_code == 403  # IT admins don't get people risk views


async def test_compliance_check_compares_every_department(http):
    r = await http.post("/api/compliance/evaluate", headers=await auth(http, "executive"),
                        json={"prompt": "Check Medicare 2123 45670 1 and email a@b.com"})
    body = r.json()
    by_dept = {o["department"]: o for o in body["outcomes"]}
    assert [d["pii_type"] for d in body["detections"]] == ["AU_MEDICARE", "EMAIL"]
    assert not by_dept["retail_banking"]["allowed"] and "Medicare" in by_dept["retail_banking"]["reason"]
    assert by_dept["legal_risk"]["allowed"] and by_dept["legal_risk"]["sent_to_model"] == "Check Medicare ⟦AU_MEDICARE_1⟧ and email ⟦EMAIL_1⟧"
    assert (await http.post("/api/compliance/evaluate", headers=await auth(http, "developer"), json={"prompt": "x"})).status_code == 403
    assert (await http.get("/api/directory", headers=await auth(http, "executive"))).status_code == 200
