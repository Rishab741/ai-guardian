"""Presenter-only features: demo IdP, simulator, warm-up, payload trace."""
import openai

from app import config, db

from .conftest import ADVISOR_KEY, fetchrow, token_for

APP = {"Authorization": f"Bearer {ADVISOR_KEY}"}


async def test_demo_idp_issues_verified_identity_for_fictional_staff(http, client):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """insert into end_users (tenant_id, id, external_ref, display_name, title, department, synthetic)
               values ('harbour', 'finn.ferreira', 'finn.ferreira@harbourbank.example', 'Finn Ferreira',
                       'Home Loan Specialist', 'retail_banking', true) on conflict do nothing""")
    people = (await http.get("/api/demo/directory", headers=APP)).json()
    assert any(p["id"] == "finn.ferreira" for p in people)

    token = (await http.post("/api/demo/idp-token", headers=APP, json={"user_id": "finn.ferreira"})).json()["token"]
    raw = await client.chat.completions.with_raw_response.create(
        model="gpt-4o", messages=[{"role": "user", "content": "Offset vs redraw in one line"}],
        extra_headers={"X-SF-User-Token": token})
    row = await fetchrow("select end_user_id, user_verified from audit_events where id = $1", int(raw.headers["x-sf-audit-id"]))
    assert row["user_verified"] and row["end_user_id"] == "finn.ferreira"

    assert (await http.post("/api/demo/idp-token", headers=APP, json={"user_id": "nobody"})).status_code == 404


async def test_payload_trace_shows_only_redacted_text(http):
    r = await http.post("/v1/chat/completions", headers={**APP, "X-SF-Debug": "1"},
                        json={"model": "gpt-4o", "messages": [{"role": "user", "content": "Confirm TFN 123 456 782"}]})
    trace = r.json()["sf_trace"]
    sent = " ".join(m["content"] for m in trace["messages_sent"])
    assert "⟦AU_TFN_1⟧" in sent and "123 456 782" not in sent
    plain = await http.post("/v1/chat/completions", headers=APP,
                            json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]})
    assert "sf_trace" not in plain.json()

    blocked = await http.post("/v1/chat/completions", headers={**APP, "X-SF-Debug": "1"},
                              json={"model": "gpt-4o", "messages": [{"role": "user", "content": "Medicare 2123 45670 1"}]})
    assert blocked.status_code == 403 and blocked.json()["sf_trace"]["blocked"] is True


async def test_simulator_scenario_and_warmup(http):
    auth = {"Authorization": await token_for(http, "executive")}
    ids = (await http.post("/api/demo/tick", headers=auth, json={"scenario": "card_exfiltration"})).json()["audit_ids"]
    row = await fetchrow("select source, decision, department from audit_events where id = $1", ids[0])
    assert dict(row) == {"source": "simulator", "decision": "blocked", "department": "technology"}
    assert len((await http.post("/api/demo/tick", headers=auth, json={"count": 3})).json()["audit_ids"]) == 3
    warm = (await http.post("/api/demo/warmup", headers=auth)).json()
    assert warm["ok"] and [c["name"] for c in warm["checks"]] == ["Database", "Embeddings", "Fast model"]


async def test_demo_routes_vanish_outside_demo_mode(http, monkeypatch):
    monkeypatch.setattr(config, "DEMO_MODE", False)
    auth = {"Authorization": f"Bearer {ADVISOR_KEY}"}
    assert (await http.get("/api/demo/directory", headers=auth)).status_code == 404
