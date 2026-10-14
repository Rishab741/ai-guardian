"""
The request pipeline shared by the OpenAI-compatible API (/v1) and the
console playground (/api/chat):

  identify → policy → redact → cache → route (with fallback) → output scan
  → re-hydrate → audit

Every stage appends a TraceStep, which the console renders and which makes
each decision explainable after the fact.
"""
import asyncio
import time
import uuid
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from . import audit, cache, config, policy, providers, routing
from .providers import ChatParams, ProviderError, StreamUsage
from .redaction import PII_LABELS, RehydrationStats, StreamRehydrator, Vault, detect, mask_value, redact, rehydrate

PLACEHOLDER_INSTRUCTION = (
    "Some values in this conversation were replaced with placeholders such as ⟦EMAIL_1⟧ to protect privacy. "
    "Where you refer to one of those values, write its placeholder exactly as given. Never guess the underlying value."
)


@dataclass
class Caller:
    tenant_id: str
    source: str  # gateway | console | simulator
    endpoint: str
    department: str
    app_id: uuid.UUID | None = None
    app_name: str | None = None
    end_user_id: str | None = None
    end_user_label: str | None = None
    user_verified: bool = False


@dataclass
class TraceStep:
    step: str
    label: str
    status: str  # ok | blocked | hit | miss | skipped | warn
    detail: str


class GatewayError(Exception):
    def __init__(self, status: int, code: str, message: str, audit_id: int | None = None, trace: list | None = None,
                 department_label: str | None = None):
        super().__init__(message)
        self.department_label = department_label
        self.status = status
        self.code = code
        self.message = message
        self.audit_id = audit_id
        self.trace = trace or []


@dataclass
class Prepared:
    caller: Caller
    request_id: uuid.UUID
    t0: float
    decision: policy.Decision
    vault: Vault
    messages: list[dict]  # redacted, ready for the provider
    prompt_redacted: str
    pii_types: list[str]
    tier: str
    model_requested: str | None
    params: ChatParams
    partition: str | None
    embedding: cache.Embedded | None
    cache_hit: cache.CacheHit | None
    trace: list[TraceStep] = field(default_factory=list)


@dataclass
class Outcome:
    audit_id: int
    request_id: uuid.UUID
    text: str
    response_redacted: str
    model_used: str
    tier: str
    cache_hit: bool
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int
    finish_reason: str
    redactions: list[dict]
    trace: list[TraceStep]


# ── rate limiting ────────────────────────────────────────────────────────────

_rate_windows: dict[str, deque] = {}


def _rate_limited(key: str, per_minute: int) -> bool:
    now = time.monotonic()
    w = _rate_windows.setdefault(key, deque())
    while w and now - w[0] > 60:
        w.popleft()
    if len(w) >= per_minute:
        return True
    w.append(now)
    return False


# ── helpers ──────────────────────────────────────────────────────────────────

def _content_text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    # OpenAI content-part arrays; only text parts are supported in v1.
    return "\n".join(p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text")


def _conversation_text(messages: list[dict]) -> str:
    if len(messages) == 1:
        return messages[0]["content"]
    return "\n".join(f"{m['role']}: {m['content']}" for m in messages)


def _redaction_list(vault: Vault) -> list[dict]:
    return [{"pii_type": t, "token": f"⟦{tid}⟧"} for tid, (t, _) in vault._by_token.items()]


def _scan_output(text: str, decision: policy.Decision) -> tuple[str, int]:
    """Mask PII the model itself introduced (raw output only contains
    placeholders for legitimate values)."""
    found = [d for d in detect(text) if d.pii_type not in decision.allowed_raw_types]
    if not found:
        return text, 0
    out, cursor = [], 0
    for d in found:
        out.append(text[cursor:d.start])
        out.append(mask_value(d.pii_type, d.value))
        cursor = d.end
    out.append(text[cursor:])
    return "".join(out), len(found)


def _base_event(p: Prepared) -> dict:
    c = p.caller
    return {
        "tenant_id": c.tenant_id,
        "request_id": p.request_id,
        "source": c.source,
        "endpoint": c.endpoint,
        "app_id": c.app_id,
        "app_name": c.app_name,
        "end_user_id": c.end_user_id,
        "user_verified": c.user_verified,
        "department": p.decision.department,
        "department_label": p.decision.department_label,
        "policy_version": p.decision.policy_version,
        "flags": p.decision.flags,
        "prompt_redacted": p.prompt_redacted[:8000],
        "pii_types": p.pii_types,
        "pii_count": len(p.pii_types),
        "model_requested": p.model_requested,
    }


# ── stage 1: everything before the model call ───────────────────────────────

async def prepare(
    caller: Caller, raw_messages: list[dict], model_requested: str | None, params: ChatParams, use_cache: bool = True,
) -> Prepared:
    t0 = time.perf_counter()
    request_id = uuid.uuid4()
    trace: list[TraceStep] = []

    messages = [{"role": m["role"], "content": _content_text(m.get("content"))} for m in raw_messages]
    raw_text = "\n".join(m["content"] for m in messages)

    who = caller.app_name or "Console"
    user = caller.end_user_label or caller.end_user_id
    trace.append(TraceStep(
        "identity", "Identity", "ok",
        f"{who}" + (f" · {user} ({'verified' if caller.user_verified else 'unverified claim'})" if user else " · no end-user identity forwarded"),
    ))

    detections = [d for m in messages for d in detect(m["content"])]
    pii_types = [d.pii_type for d in detections]

    active = await policy.get_active(caller.tenant_id)
    decision = policy.evaluate(active, caller.department, pii_types, raw_text)

    rate_key = f"{caller.tenant_id}|{caller.end_user_id or caller.app_id or 'console'}"
    if decision.allowed and _rate_limited(rate_key, decision.rate_limit_per_user_per_min):
        decision.allowed = False
        decision.reason = f"Rate limit: more than {decision.rate_limit_per_user_per_min} requests per minute."

    flags_note = f" Flags: {', '.join(decision.flags)}." if decision.flags else ""
    trace.append(TraceStep(
        "auth_policy", "Auth & Policy Check", "ok" if decision.allowed else "blocked",
        (decision.reason or f"Entitlements verified for {decision.department_label} (policy v{decision.policy_version}).") + flags_note,
    ))

    vault = Vault()
    skip = frozenset(decision.allowed_raw_types)
    redacted_messages = []
    for m in messages:
        text, _ = redact(m["content"], vault, skip)
        redacted_messages.append({"role": m["role"], "content": text})

    if detections:
        kinds = ", ".join(sorted({PII_LABELS.get(t, t) for t in pii_types}))
        raw_note = f" Sent unredacted by policy: {', '.join(decision.allowed_raw_types)}." if decision.allowed_raw_types else ""
        trace.append(TraceStep("redaction", "PII/PHI Redaction", "ok", f"{len(vault)} value(s) tokenized before leaving the boundary: {kinds}.{raw_note}"))
    else:
        trace.append(TraceStep("redaction", "PII/PHI Redaction", "ok", "No sensitive identifiers detected."))

    prompt_redacted = _conversation_text(redacted_messages)

    prepared = Prepared(
        caller=caller, request_id=request_id, t0=t0, decision=decision, vault=vault, messages=redacted_messages,
        prompt_redacted=prompt_redacted, pii_types=pii_types, tier="fast", model_requested=model_requested,
        params=params, partition=None, embedding=None, cache_hit=None, trace=trace,
    )

    if not decision.allowed:
        trace.append(TraceStep("cache", "Semantic Cache Lookup", "skipped", "Skipped: request blocked."))
        trace.append(TraceStep("routing", "Model Routing", "skipped", "Skipped: request blocked. Nothing left the boundary."))
        [audit_id] = await audit.append([{
            **_base_event(prepared),
            "decision": "blocked",
            "policy_reason": decision.reason,
            "response_redacted": "[request blocked by policy]",
            "gateway_overhead_ms": int((time.perf_counter() - t0) * 1000),
        }])
        trace.append(TraceStep("audit", "Audit Logging", "ok", f"Blocked request logged as audit #{audit_id}."))
        raise GatewayError(403, "policy_blocked", decision.reason or "Blocked by policy.", audit_id, trace,
                           decision.department_label)

    forced = routing.requested_tier(model_requested)
    tier = forced or routing.choose_tier(prompt_redacted, len(messages))
    prepared.tier = policy.cap_tier(tier, decision.max_tier)

    if use_cache:
        prepared.partition = cache.partition_key(caller.tenant_id, decision.department, decision.policy_version, prepared.tier)
        prepared.embedding = await cache.embed(prompt_redacted)
        prepared.cache_hit = await cache.lookup(caller.tenant_id, prepared.partition, vault.signature, prepared.embedding)
        if prepared.cache_hit:
            trace.append(TraceStep(
                "cache", "Semantic Cache Lookup", "hit",
                f"Matched an equivalent prior request ({prepared.cache_hit.similarity:.0%} similarity) in this department's partition; model call avoided.",
            ))
        else:
            degraded = " (local embedding fallback)" if prepared.embedding.degraded else ""
            trace.append(TraceStep("cache", "Semantic Cache Lookup", "miss", f"No equivalent prior request in this partition{degraded}."))
    else:
        trace.append(TraceStep("cache", "Semantic Cache Lookup", "skipped", "Caching disabled for this request."))

    if vault:
        prepared.messages = [{"role": "system", "content": PLACEHOLDER_INSTRUCTION}] + redacted_messages
    return prepared


# ── stage 2: model call with fallback ────────────────────────────────────────

def _provider_for(tier: str):
    if tier == "simulated" or config.LLM_PROVIDER == "simulated":
        return providers.get("simulated")
    return providers.get("gemini")


def _model_name(tier: str) -> str:
    if tier == "simulated" or config.LLM_PROVIDER == "simulated":
        return f"sf-simulated-{tier}" if tier != "simulated" else "sf-simulated"
    return routing.model_for(tier)


async def _call(p: Prepared) -> tuple[providers.ChatResult, str, str, list[routing.Hop]]:
    hops: list[routing.Hop] = []
    for tier in routing.chain(p.tier):
        model = _model_name(tier)
        provider = _provider_for(tier)
        if provider.name != "simulated":
            reason = await routing.quota.reserve(model)
            if reason:
                hops.append(routing.Hop(tier, model, f"skipped:{reason}"))
                continue
        try:
            result = await provider.chat(model, p.messages, p.params)
            hops.append(routing.Hop(tier, model, "ok"))
            return result, tier, model, hops
        except ProviderError as e:
            routing.quota.penalise(model, e)
            hops.append(routing.Hop(tier, model, f"failed:{e.status}"))
            if not e.retryable:
                raise GatewayError(502, "provider_error", f"Model provider rejected the request ({e.status}).") from e
    raise GatewayError(503, "no_model_available", "All model tiers are currently unavailable. Try again shortly.")


def _routing_step(p: Prepared, tier: str, model: str, hops: list[routing.Hop]) -> TraceStep:
    detail = f"Routed to {routing.TIER_LABELS[tier]} ({model})"
    if tier != p.tier:
        detail += f"; requested {routing.TIER_LABELS[p.tier]}"
    detours = [f"{h.model} {h.outcome.split(':', 1)[1].replace('_', ' ')}" for h in hops if h.outcome != "ok"]
    if detours:
        detail += f". Fallback: {'; '.join(detours)}"
    status = "warn" if tier == "simulated" else "ok"
    return TraceStep("routing", "Model Routing", status, detail + ".")


async def complete(p: Prepared) -> Outcome:
    hops: list[routing.Hop] = []
    if p.cache_hit:
        raw = p.cache_hit.response_redacted
        tier, model = "cached", p.cache_hit.model_used
        in_tok, out_tok = providers.estimate_tokens(p.prompt_redacted), providers.estimate_tokens(raw)
        cost_usd, finish = 0.0, "stop"
        cost_if_no_cache = routing.cost(p.tier, in_tok, out_tok)
        p.trace.append(TraceStep("routing", "Model Routing", "ok", "Served from cache; no model call made."))
        masked = 0
    else:
        result, tier, model, hops = await _call(p)
        p.trace.append(_routing_step(p, tier, model, hops))
        raw, masked = _scan_output(result.text, p.decision)
        in_tok, out_tok, finish = result.input_tokens, result.output_tokens, result.finish_reason
        cost_usd = cost_if_no_cache = routing.cost(tier, in_tok, out_tok)
        if p.embedding is not None and tier != "simulated":
            await cache.store(p.caller.tenant_id, p.partition, p.vault.signature, p.embedding,
                              p.prompt_redacted, raw, model, tier)

    stats = RehydrationStats()
    text = rehydrate(raw, p.vault, p.decision.rehydrate, stats)
    p.trace.append(_rehydration_step(stats, masked))

    latency_ms = int((time.perf_counter() - p.t0) * 1000)
    [audit_id] = await audit.append([{
        **_base_event(p),
        "decision": "allowed",
        "response_redacted": raw[:8000],
        "output_pii_masked": masked,
        "cache_hit": p.cache_hit is not None,
        "cache_similarity": p.cache_hit.similarity if p.cache_hit else None,
        "model_used": model,
        "provider": "cache" if p.cache_hit else _provider_for(tier).name,
        "tier": tier,
        "fallbacks": [f"{h.model}:{h.outcome}" for h in hops if h.outcome != "ok"],
        "input_tokens": in_tok,
        "output_tokens": out_tok,
        "cost_usd": cost_usd,
        "cost_if_no_cache": cost_if_no_cache,
        "latency_ms": latency_ms,
        "rehydrated": stats.rehydrated,
        "rehydration_misses": stats.misses,
    }])
    p.trace.append(TraceStep("audit", "Audit Logging", "ok", f"Hash-chained record written as audit #{audit_id}."))

    return Outcome(
        audit_id=audit_id, request_id=p.request_id, text=text, response_redacted=raw, model_used=model, tier=tier,
        cache_hit=p.cache_hit is not None, input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost_usd,
        latency_ms=latency_ms, finish_reason=finish, redactions=_redaction_list(p.vault), trace=p.trace,
    )


def _rehydration_step(stats: RehydrationStats, masked_output: int) -> TraceStep:
    parts = []
    if stats.rehydrated:
        parts.append(f"{stats.rehydrated} value(s) restored for the user")
    if stats.masked:
        parts.append(f"{stats.masked} kept masked by policy")
    if stats.misses:
        parts.append(f"{stats.misses} unrecognised placeholder(s) left as-is")
    if masked_output:
        parts.append(f"{masked_output} model-introduced identifier(s) masked")
    detail = "; ".join(parts) + "." if parts else "Nothing to restore."
    return TraceStep("rehydration", "Re-hydration & Output Scan", "warn" if stats.misses else "ok", detail)


# ── streaming variant ────────────────────────────────────────────────────────

@dataclass
class StreamResult:
    """Filled in as the stream runs; read by the caller after it finishes."""
    audit_id: int | None = None
    model_used: str = ""
    tier: str = ""
    finish_reason: str = "stop"
    input_tokens: int = 0
    output_tokens: int = 0


async def stream(p: Prepared, out: StreamResult) -> AsyncIterator[str]:
    """Yields re-hydrated text. Fallback is possible until the first chunk
    arrives; after that the model is committed. Model-introduced PII can't be
    un-sent in a stream, so it's counted and flagged in the audit record."""
    rehydrator = StreamRehydrator(p.vault, p.decision.rehydrate)
    raw_parts: list[str] = []
    hops: list[routing.Hop] = []
    usage = StreamUsage()
    tier = model = ""
    decision = "allowed"

    try:
        if p.cache_hit:
            tier, model = "cached", p.cache_hit.model_used
            text = p.cache_hit.response_redacted
            raw_parts.append(text)
            for i in range(0, len(text), 24):
                piece = rehydrator.feed(text[i:i + 24])
                if piece:
                    yield piece
            usage.input_tokens = providers.estimate_tokens(p.prompt_redacted)
            usage.output_tokens = providers.estimate_tokens(text)
        else:
            gen = None
            first = None
            for t in routing.chain(p.tier):
                m = _model_name(t)
                provider = _provider_for(t)
                if provider.name != "simulated":
                    reason = await routing.quota.reserve(m)
                    if reason:
                        hops.append(routing.Hop(t, m, f"skipped:{reason}"))
                        continue
                gen = provider.stream(m, p.messages, p.params, usage).__aiter__()
                try:
                    first = await asyncio.wait_for(gen.__anext__(), timeout=config.PROVIDER_TIMEOUT_S)
                except StopAsyncIteration:
                    first = ""
                except (ProviderError, asyncio.TimeoutError) as e:
                    err = e if isinstance(e, ProviderError) else ProviderError("first chunk timed out", retryable=True, status=504)
                    routing.quota.penalise(m, err)
                    hops.append(routing.Hop(t, m, f"failed:{err.status}"))
                    gen = None
                    if not err.retryable:
                        raise GatewayError(502, "provider_error", f"Model provider rejected the request ({err.status}).") from e
                    continue
                hops.append(routing.Hop(t, m, "ok"))
                tier, model = t, m
                break
            if gen is None:
                raise GatewayError(503, "no_model_available", "All model tiers are currently unavailable. Try again shortly.")

            if first:
                raw_parts.append(first)
                piece = rehydrator.feed(first)
                if piece:
                    yield piece
            async for chunk in gen:
                raw_parts.append(chunk)
                piece = rehydrator.feed(chunk)
                if piece:
                    yield piece
        tail = rehydrator.flush()
        if tail:
            yield tail
    except ProviderError:
        decision = "error"
        raise GatewayError(502, "provider_error", "The model stream was interrupted.")
    finally:
        raw = "".join(raw_parts)
        _, masked = _scan_output(raw, p.decision)
        flags = list(p.decision.flags) + (["output_pii_in_stream"] if masked else [])
        cost_usd = 0.0 if p.cache_hit else routing.cost(tier, usage.input_tokens, usage.output_tokens) if tier else 0.0
        cost_if_no_cache = routing.cost(p.tier, usage.input_tokens, usage.output_tokens)
        if p.embedding is not None and not p.cache_hit and tier and tier != "simulated" and decision == "allowed" and raw:
            await cache.store(p.caller.tenant_id, p.partition, p.vault.signature, p.embedding,
                              p.prompt_redacted, raw, model, tier)
        [out.audit_id] = await audit.append([{
            **_base_event(p),
            "flags": flags,
            "decision": decision if tier else "error",
            "policy_reason": None if tier else "no model available",
            "response_redacted": raw[:8000],
            "output_pii_masked": masked,
            "cache_hit": p.cache_hit is not None,
            "cache_similarity": p.cache_hit.similarity if p.cache_hit else None,
            "model_used": model or None,
            "provider": "cache" if p.cache_hit else (_provider_for(tier).name if tier else None),
            "tier": tier or None,
            "fallbacks": [f"{h.model}:{h.outcome}" for h in hops if h.outcome != "ok"],
            "stream": True,
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cost_usd": cost_usd,
            "cost_if_no_cache": cost_if_no_cache,
            "latency_ms": int((time.perf_counter() - p.t0) * 1000),
            "rehydrated": rehydrator.stats.rehydrated,
            "rehydration_misses": rehydrator.stats.misses,
        }])
        out.model_used, out.tier = model, tier
        out.finish_reason = usage.finish_reason
        out.input_tokens, out.output_tokens = usage.input_tokens, usage.output_tokens
