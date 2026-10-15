"""Contract tests: the official OpenAI SDK against the gateway."""
import openai
import pytest

from app import gateway, identity, providers
from app.providers import ProviderError

from .conftest import fetchrow, token_for

TFN_A = "123 456 782"
TFN_B = "876 543 210"  # also passes the mod-11 check


async def test_rejects_missing_or_bad_key(http):
    bad = openai.AsyncOpenAI(base_url="http://gateway/v1", api_key="sf-live-nope", http_client=http, max_retries=0)
    with pytest.raises(openai.AuthenticationError):
        await bad.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "hi"}])


async def test_completion_redacts_upstream_and_rehydrates_downstream(client):
    raw = await client.chat.completions.with_raw_response.create(
        model="gpt-4o", user="sam.holt@harbourbank.example",
        messages=[{"role": "user", "content": f"Confirm TFN {TFN_A} for jane@bank.com.au"}],
    )
    r = raw.parse()
    assert TFN_A in r.choices[0].message.content and "jane@bank.com.au" in r.choices[0].message.content
    row = await fetchrow("select * from audit_events where id = $1", int(raw.headers["x-sf-audit-id"]))
    assert row["prompt_redacted"] == "Confirm TFN ⟦AU_TFN_1⟧ for ⟦EMAIL_1⟧"
    assert TFN_A not in row["response_redacted"]
    assert row["end_user_id"] == "sam.holt@harbourbank.example" and row["app_name"] == "Advisor Assist"
    assert row["rehydrated"] >= 2


async def test_streaming_rehydrates_and_masks_cards(client):
    stream = await client.chat.completions.create(
        model="sf-fast", stream=True, messages=[{"role": "user", "content": "Card 4111 1111 1111 1111 for Mr Tom Brennan"}],
    )
    text = "".join([c.choices[0].delta.content or "" async for c in stream if c.choices])
    assert "Tom Brennan" in text and "[card •••• 1111]" in text and "4111 1111 1111 1111" not in text


async def test_policy_block_is_a_permission_error_and_audited(client):
    with pytest.raises(openai.PermissionDeniedError) as exc:
        await client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "Medicare 2123 45670 1"}])
    audit_id = int(exc.value.response.headers["x-sf-audit-id"])
    row = await fetchrow("select decision, prompt_redacted from audit_events where id = $1", audit_id)
    assert row["decision"] == "blocked" and row["prompt_redacted"] == "Medicare ⟦AU_MEDICARE_1⟧"


async def test_cached_answer_is_rehydrated_with_the_new_requests_values(client):
    """User B must get B's value back from an answer first generated for A."""
    q = "Please summarise the account status for the customer with TFN {}"
    first = await client.chat.completions.with_raw_response.create(
        model="sf-balanced", messages=[{"role": "user", "content": q.format(TFN_A)}])
    second = await client.chat.completions.with_raw_response.create(
        model="sf-balanced", messages=[{"role": "user", "content": q.format(TFN_B)}])
    assert first.headers["x-sf-cache"] == "miss" and second.headers["x-sf-cache"] == "hit"
    text = second.parse().choices[0].message.content
    assert TFN_B in text and TFN_A not in text


async def test_cache_is_partitioned_by_department(client, http):
    q = [{"role": "user", "content": "Explain our expense claim process in two lines"}]
    await client.chat.completions.create(model="sf-fast", messages=q)
    hit = await client.chat.completions.with_raw_response.create(model="sf-fast", messages=q)
    assert hit.headers["x-sf-cache"] == "hit"

    finance_app = await fetchrow("select id from apps where name = 'Finance Workbench'")
    key = await identity.create_key(finance_app["id"])
    finance = openai.AsyncOpenAI(base_url="http://gateway/v1", api_key=key, http_client=http, max_retries=0)
    other = await finance.chat.completions.with_raw_response.create(model="sf-fast", messages=q)
    assert other.headers["x-sf-cache"] == "miss"


async def test_fallback_moves_down_the_chain(client, monkeypatch):
    class Failing:
        name = "gemini"

        async def chat(self, *a, **k):
            raise ProviderError("overloaded", retryable=True, status=503)

    real = gateway._provider_for
    monkeypatch.setattr(gateway, "_provider_for", lambda tier: Failing() if tier == "deep" else real(tier))
    raw = await client.chat.completions.with_raw_response.create(
        model="sf-deep", messages=[{"role": "user", "content": "Analyze liquidity risk scenarios for Q3"}],
        extra_headers={"X-SF-Cache": "no-store"},
    )
    row = await fetchrow("select tier, fallbacks from audit_events where id = $1", int(raw.headers["x-sf-audit-id"]))
    assert row["tier"] == "balanced" and row["fallbacks"][0].endswith("failed:503")


async def test_unsupported_and_invalid_requests_use_openai_errors(client):
    with pytest.raises(openai.BadRequestError):
        await client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "x"}],
                                             tools=[{"type": "function", "function": {"name": "f", "parameters": {}}}])
    with pytest.raises(openai.BadRequestError):
        await client.chat.completions.create(model="gpt-4o", messages=[])


async def test_embeddings_are_computed_on_redacted_text(client):
    raw = await client.embeddings.with_raw_response.create(model="text-embedding-3-small", input=[f"TFN {TFN_A}"])
    e = raw.parse()
    assert len(e.data[0].embedding) == 768 and raw.headers["x-sf-redactions"] == "1"
    assert e.data[0].embedding == providers.local_embedding("TFN ⟦AU_TFN_1⟧")


async def test_models_list(client):
    assert {m.id async for m in client.models.list()} >= {"sf-auto", "sf-fast", "sf-deep"}


async def test_zz_no_raw_pii_persisted_and_chain_verifies(http):
    """Runs last (zz): scans everything the suite wrote."""
    for table, cols in (("audit_events", "prompt_redacted || coalesce(response_redacted, '')"),
                        ("cache_entries", "prompt_redacted || response_redacted")):
        row = await fetchrow(
            f"select count(*) as n from {table} where {cols} ~ $1",
            r"123 456 782|876 543 210|4111 1111|2123 45670|jane@bank|Tom Brennan",
        )
        assert row["n"] == 0, table
    verify = await http.get("/api/audit/verify", headers={"Authorization": await token_for(http, "ciso")})
    assert verify.json()["ok"] is True
