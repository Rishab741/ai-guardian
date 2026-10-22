"""
OpenAI-compatible surface: /v1/chat/completions (streaming and not),
/v1/models, /v1/embeddings. An unmodified OpenAI SDK works after changing
its base URL to this gateway and its API key to an `sf-live-…` app key.

Errors use OpenAI's {"error": {message, type, code}} envelope so SDKs raise
their normal exception types. Gateway metadata travels in X-SF-* headers.
"""
import json
import time
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from . import config, gateway, identity, policy, providers
from .gateway import Caller, GatewayError
from .providers import ChatParams
from .redaction import Vault, detect, redact

router = APIRouter(prefix="/v1")


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: Literal["system", "developer", "user", "assistant", "tool"]
    content: str | list[dict] | None = None
    name: str | None = None


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str = "sf-auto"
    messages: list[ChatMessage] = Field(..., min_length=1)
    stream: bool = False
    temperature: float | None = Field(None, ge=0, le=2)
    top_p: float | None = Field(None, ge=0, le=1)
    max_tokens: int | None = Field(None, ge=1, le=32_000)
    max_completion_tokens: int | None = Field(None, ge=1, le=32_000)
    stop: str | list[str] | None = None
    n: int = 1
    user: str | None = None
    tools: list | None = None
    functions: list | None = None


class EmbeddingRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str = "sf-embed"
    input: str | list[str]
    user: str | None = None


def openai_error(status: int, code: str, message: str, headers: dict | None = None) -> JSONResponse:
    err_type = {400: "invalid_request_error", 401: "authentication_error", 403: "permission_error",
                429: "rate_limit_error"}.get(status, "api_error")
    return JSONResponse({"error": {"message": message, "type": err_type, "param": None, "code": code}},
                        status_code=status, headers=headers)


class AuthFailure(Exception):
    def __init__(self, message: str, code: str = "invalid_api_key"):
        super().__init__(message)
        self.code = code


async def require_app(authorization: str | None = Header(default=None)) -> identity.AppIdentity:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AuthFailure("Missing API key. Use an sf-live-… key as the bearer token.")
    app = await identity.resolve_key(authorization.split(" ", 1)[1].strip())
    if app is None:
        raise AuthFailure("Invalid or revoked API key.")
    return app


async def _caller(app: identity.AppIdentity, claimed_user: str | None, user_token: str | None, endpoint: str) -> Caller:
    if user_token:
        try:
            user = await identity.verify_user_token(app.tenant_id, user_token, app.default_department)
        except identity.InvalidUserToken as e:
            raise AuthFailure(str(e), code="invalid_user_token") from e
    else:
        user = await identity.resolve_end_user(app.tenant_id, claimed_user, app.default_department)
    return Caller(
        tenant_id=app.tenant_id, source="gateway", endpoint=endpoint,
        department=user.department if user else app.default_department,
        app_id=app.app_id, app_name=app.app_name,
        end_user_id=user.id if user else None, end_user_label=user.display_name if user else None,
        user_verified=user.verified if user else False,
    )


def _sf_headers(request_id, audit_id=None, extra: dict | None = None) -> dict:
    h = {"X-SF-Request-Id": str(request_id)}
    if audit_id is not None:
        h["X-SF-Audit-Id"] = str(audit_id)
    h.update(extra or {})
    return h


@router.get("/models")
async def list_models(app: identity.AppIdentity = Depends(require_app)):
    now = int(time.time())
    ids = ["sf-auto", "sf-fast", "sf-balanced", "sf-deep", "sf-embed"]
    return {"object": "list", "data": [{"id": i, "object": "model", "created": now, "owned_by": "sovereignfabric"} for i in ids]}


@router.post("/chat/completions")
async def chat_completions(
    body: ChatCompletionRequest,
    app: identity.AppIdentity = Depends(require_app),
    x_sf_user: str | None = Header(default=None),
    x_sf_user_token: str | None = Header(default=None),
    x_sf_cache: str | None = Header(default=None),
    x_sf_debug: str | None = Header(default=None),
):
    # Demo only: echo what actually left the boundary, for the payload inspector.
    debug = config.DEMO_MODE and x_sf_debug == "1"
    if body.tools or body.functions:
        return openai_error(400, "unsupported_parameter", "Tool/function calling is not supported by this gateway version.")
    if body.n != 1:
        return openai_error(400, "unsupported_parameter", "Only n=1 is supported.")
    if len(body.messages) > config.MAX_MESSAGES:
        return openai_error(400, "too_many_messages", f"At most {config.MAX_MESSAGES} messages per request.")
    for m in body.messages:
        if isinstance(m.content, list) and any(p.get("type") != "text" for p in m.content if isinstance(p, dict)):
            return openai_error(400, "unsupported_content", "Only text content parts are supported.")

    caller = await _caller(app, x_sf_user or body.user, x_sf_user_token, "/v1/chat/completions")
    params = ChatParams(
        temperature=body.temperature, top_p=body.top_p,
        max_tokens=body.max_completion_tokens or body.max_tokens, stop=body.stop,
    )
    messages = [{"role": "system" if m.role == "developer" else m.role, "content": m.content} for m in body.messages]
    use_cache = (x_sf_cache or "").lower() != "no-store"

    try:
        prepared = await gateway.prepare(caller, messages, body.model, params, use_cache=use_cache)
    except GatewayError as e:
        resp = openai_error(e.status, e.code, e.message, _sf_headers("-", e.audit_id))
        if debug:
            resp = _with_trace(resp, {"audit_id": e.audit_id, "blocked": True, "messages_sent": None,
                                      "pipeline": [s.__dict__ for s in e.trace]})
        return resp

    completion_id = f"chatcmpl-{prepared.request_id.hex}"
    created = int(time.time())

    if not body.stream:
        try:
            outcome = await gateway.complete(prepared)
        except GatewayError as e:
            return openai_error(e.status, e.code, e.message, _sf_headers(prepared.request_id))
        payload = {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": outcome.model_used,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": outcome.text},
                         "finish_reason": outcome.finish_reason}],
            "usage": {"prompt_tokens": outcome.input_tokens, "completion_tokens": outcome.output_tokens,
                      "total_tokens": outcome.input_tokens + outcome.output_tokens},
        }
        if debug:
            payload["sf_trace"] = {
                "audit_id": outcome.audit_id, "blocked": False, "messages_sent": prepared.messages,
                "response_received": outcome.response_redacted, "redactions": outcome.redactions,
                "tier": outcome.tier, "model": outcome.model_used, "cache_hit": outcome.cache_hit,
                "pipeline": [s.__dict__ for s in outcome.trace],
            }
        return JSONResponse(
            payload,
            headers=_sf_headers(prepared.request_id, outcome.audit_id, {
                "X-SF-Cache": "hit" if outcome.cache_hit else "miss",
                "X-SF-Redactions": str(len(outcome.redactions)),
                "X-SF-Tier": outcome.tier,
            }),
        )

    result = gateway.StreamResult()
    agen = gateway.stream(prepared, result).__aiter__()
    # Pull the first piece before committing to a 200, so "no model
    # available" still surfaces as a proper HTTP error.
    try:
        first = await agen.__anext__()
    except StopAsyncIteration:
        first = ""
    except GatewayError as e:
        return openai_error(e.status, e.code, e.message, _sf_headers(prepared.request_id))

    def chunk(delta: dict, finish: str | None = None, **extra) -> str:
        payload = {"id": completion_id, "object": "chat.completion.chunk", "created": created,
                   "model": result.model_used or body.model,
                   "choices": [{"index": 0, "delta": delta, "finish_reason": finish}], **extra}
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def sse():
        yield chunk({"role": "assistant", "content": first})
        try:
            async for piece in agen:
                yield chunk({"content": piece})
        except GatewayError as e:
            yield f"data: {json.dumps({'error': {'message': e.message, 'type': 'api_error', 'code': e.code}})}\n\n"
            return
        # sf_audit_id is an extension field; OpenAI SDKs ignore unknown fields.
        yield chunk({}, result.finish_reason, sf_audit_id=result.audit_id,
                    usage={"prompt_tokens": result.input_tokens, "completion_tokens": result.output_tokens,
                           "total_tokens": result.input_tokens + result.output_tokens})
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream",
                             headers=_sf_headers(prepared.request_id, None, {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}))


@router.post("/embeddings")
async def embeddings(
    body: EmbeddingRequest,
    app: identity.AppIdentity = Depends(require_app),
    x_sf_user: str | None = Header(default=None),
    x_sf_user_token: str | None = Header(default=None),
):
    """Embeddings are computed on redacted text, so vectors stored in the
    bank's own vector database can't be inverted back to identifiers."""
    from . import audit

    inputs = [body.input] if isinstance(body.input, str) else body.input
    if not inputs or len(inputs) > 100:
        return openai_error(400, "invalid_input", "Provide between 1 and 100 inputs.")
    caller = await _caller(app, x_sf_user or body.user, x_sf_user_token, "/v1/embeddings")
    active = await policy.get_active(caller.tenant_id)
    pii_types = [d.pii_type for t in inputs for d in detect(t)]
    decision = policy.evaluate(active, caller.department, pii_types, "\n".join(inputs))
    vault = Vault()
    redacted = [redact(t, vault, frozenset(decision.allowed_raw_types))[0] for t in inputs]

    base = {
        "tenant_id": caller.tenant_id, "request_id": uuid.uuid4(), "source": "gateway", "endpoint": "/v1/embeddings",
        "app_id": caller.app_id, "app_name": caller.app_name, "end_user_id": caller.end_user_id,
        "user_verified": caller.user_verified, "department": decision.department, "department_label": decision.department_label,
        "policy_version": decision.policy_version, "prompt_redacted": "\n".join(redacted)[:8000],
        "pii_types": pii_types, "pii_count": len(pii_types), "model_requested": body.model,
    }
    if not decision.allowed:
        [audit_id] = await audit.append([{**base, "decision": "blocked", "policy_reason": decision.reason}])
        return openai_error(403, "policy_blocked", decision.reason or "Blocked by policy.", _sf_headers(base["request_id"], audit_id))

    provider = providers.get("simulated" if config.LLM_PROVIDER == "simulated" else "gemini")
    try:
        vectors = await provider.embed(redacted)
    except providers.ProviderError as e:
        return openai_error(503, "provider_error", f"Embedding provider unavailable ({e.status}).")
    tokens = sum(providers.estimate_tokens(t) for t in redacted)
    [audit_id] = await audit.append([{**base, "decision": "allowed", "model_used": config.EMBED_MODEL,
                                      "provider": provider.name, "input_tokens": tokens}])
    return JSONResponse(
        {"object": "list", "model": config.EMBED_MODEL,
         "data": [{"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)],
         "usage": {"prompt_tokens": tokens, "total_tokens": tokens}},
        headers=_sf_headers(base["request_id"], audit_id, {"X-SF-Redactions": str(len(vault))}),
    )


def _with_trace(resp: JSONResponse, trace: dict) -> JSONResponse:
    body = json.loads(resp.body)
    body["sf_trace"] = trace
    return JSONResponse(body, status_code=resp.status_code, headers={
        k: v for k, v in resp.headers.items() if k.lower().startswith("x-sf-")})


def install_error_handlers(app) -> None:
    from fastapi.exception_handlers import request_validation_exception_handler
    from fastapi.exceptions import RequestValidationError

    @app.exception_handler(AuthFailure)
    async def _auth(_: Request, exc: AuthFailure):
        return openai_error(401, exc.code, str(exc))

    @app.exception_handler(RequestValidationError)
    async def _invalid(request: Request, exc: RequestValidationError):
        if not request.url.path.startswith("/v1/"):
            return await request_validation_exception_handler(request, exc)
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(x) for x in first.get("loc", []) if x != "body")
        return openai_error(400, "invalid_request", f"{where}: {first.get('msg', 'invalid request')}")
