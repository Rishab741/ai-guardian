"""
Model provider adapters. Every adapter speaks the same small interface, so
routing is provider-neutral. v1 ships Gemini (through Google's
OpenAI-compatible endpoint, so the translation layer is thin) and a
deterministic simulated provider.
"""
import asyncio
import hashlib
import math
import random
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

import openai
from openai import AsyncOpenAI

from . import config


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool, status: int | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.status = status


@dataclass
class ChatParams:
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    stop: list[str] | str | None = None


@dataclass
class ChatResult:
    text: str
    input_tokens: int
    output_tokens: int
    finish_reason: str = "stop"


@dataclass
class StreamUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: str = "stop"


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


class GeminiProvider:
    name = "gemini"

    def __init__(self) -> None:
        self._client = AsyncOpenAI(
            api_key=config.GEMINI_API_KEY,
            base_url=config.GEMINI_BASE_URL,
            timeout=config.PROVIDER_TIMEOUT_S,
            max_retries=0,  # retries are the router's job (it moves to another model)
        )

    def _kwargs(self, params: ChatParams) -> dict:
        kw: dict = {"reasoning_effort": config.REASONING_EFFORT}
        if params.temperature is not None:
            kw["temperature"] = params.temperature
        if params.top_p is not None:
            kw["top_p"] = params.top_p
        if params.max_tokens is not None:
            kw["max_tokens"] = params.max_tokens
        if params.stop:
            kw["stop"] = params.stop
        return kw

    async def chat(self, model: str, messages: list[dict], params: ChatParams) -> ChatResult:
        try:
            resp = await self._client.chat.completions.create(model=model, messages=messages, **self._kwargs(params))
        except openai.APIError as e:
            raise _translate(e) from e
        choice = resp.choices[0]
        text = choice.message.content or ""
        usage = resp.usage
        return ChatResult(
            text=text,
            input_tokens=usage.prompt_tokens if usage else estimate_tokens(str(messages)),
            output_tokens=usage.completion_tokens if usage else estimate_tokens(text),
            finish_reason=choice.finish_reason or "stop",
        )

    async def stream(self, model: str, messages: list[dict], params: ChatParams, usage: StreamUsage) -> AsyncIterator[str]:
        try:
            stream = await self._client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                stream_options={"include_usage": True},
                **self._kwargs(params),
            )
            async for chunk in stream:
                if chunk.usage:
                    usage.input_tokens = chunk.usage.prompt_tokens or 0
                    usage.output_tokens = chunk.usage.completion_tokens or 0
                for choice in chunk.choices:
                    if choice.finish_reason:
                        usage.finish_reason = choice.finish_reason
                    if choice.delta and choice.delta.content:
                        yield choice.delta.content
        except openai.APIError as e:
            raise _translate(e) from e

    async def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            resp = await self._client.embeddings.create(
                model=config.EMBED_MODEL, input=texts, dimensions=config.EMBED_DIM
            )
        except openai.APIError as e:
            raise _translate(e) from e
        return [d.embedding for d in resp.data]


def _translate(e: openai.APIError) -> ProviderError:
    if isinstance(e, openai.APITimeoutError):
        return ProviderError("provider timed out", retryable=True, status=504)
    if isinstance(e, openai.APIConnectionError):
        return ProviderError("provider unreachable", retryable=True, status=502)
    if isinstance(e, openai.APIStatusError):
        status = e.status_code
        # 404 (model retired) is retryable in the routing sense: another
        # model may still serve the request.
        retryable = status in (404, 408, 429) or status >= 500
        return ProviderError(f"{status}: {_reason(e)}", retryable=retryable, status=status)
    return ProviderError(str(e), retryable=True)


def _reason(e: openai.APIStatusError) -> str:
    """The provider's own explanation (e.g. 'API key not valid'), shortened."""
    body = e.body
    msg = None
    if isinstance(body, dict):
        err = body.get("error", body)
        msg = err.get("message") if isinstance(err, dict) else None
    elif isinstance(body, list) and body and isinstance(body[0], dict):
        msg = body[0].get("error", {}).get("message")
    return (msg or e.message or "rejected").strip().splitlines()[0][:160]


_TEMPLATES = [
    "Here's a summary of {subject}: the position is within normal operating parameters and consistent with the "
    "last reporting cycle. No compliance exceptions are outstanding. I'd recommend circulating to the business "
    "owner for sign-off before the next deadline.",
    "I've reviewed {subject}. Key figures are consistent with prior periods; routine sign-off is appropriate "
    "unless the audit team flags a variance above 5%. Supporting detail has been cross-referenced against the "
    "latest source-of-truth extract.",
    "For {subject}, the current position looks stable. Consider revisiting next quarter or if the underlying "
    "data changes. No immediate action is required, though it's worth flagging to stakeholders in the standard "
    "reporting cycle.",
]


class SimulatedProvider:
    """Deterministic, offline. Echoes any ⟦tokens⟧ from the prompt so the
    re-hydration path is exercised exactly as with a live model."""

    name = "simulated"

    def _answer(self, messages: list[dict]) -> str:
        last = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "") or ""
        subject = last.strip().rstrip("?.! ")
        if len(subject) > 90:
            subject = subject[:87] + "..."
        seed = int(hashlib.sha256(last.encode()).hexdigest(), 16)
        return _TEMPLATES[seed % len(_TEMPLATES)].format(subject=f'"{subject or "this request"}"')

    async def chat(self, model: str, messages: list[dict], params: ChatParams) -> ChatResult:
        text = self._answer(messages)
        await asyncio.sleep(random.uniform(0.25, 0.6))
        return ChatResult(text=text, input_tokens=estimate_tokens(str(messages)), output_tokens=estimate_tokens(text))

    async def stream(self, model: str, messages: list[dict], params: ChatParams, usage: StreamUsage) -> AsyncIterator[str]:
        text = self._answer(messages)
        usage.input_tokens = estimate_tokens(str(messages))
        usage.output_tokens = estimate_tokens(text)
        # Small irregular chunks, so tokens get split mid-way like real streams.
        i = 0
        while i < len(text):
            step = random.randint(3, 9)
            yield text[i:i + step]
            i += step
            await asyncio.sleep(0.015)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [local_embedding(t) for t in texts]


_WORD_RE = re.compile(r"[a-z0-9]+")


def local_embedding(text: str) -> list[float]:
    """Hashed bag-of-words (unigrams + bigrams). No network; used offline and
    as the fallback when the embedding API is unavailable. Entries are tagged
    with their embedding model so the two vector spaces never mix."""
    vec = [0.0] * config.EMBED_DIM
    words = _WORD_RE.findall(text.lower())
    grams = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
    for g in grams:
        h = int.from_bytes(hashlib.blake2b(g.encode(), digest_size=8).digest(), "big")
        vec[h % config.EMBED_DIM] += 1.0 if (h >> 63) == 0 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


LOCAL_EMBED_MODEL = "local-hash-v1"

_gemini: GeminiProvider | None = None
_simulated = SimulatedProvider()


def get(name: str):
    global _gemini
    if name == "simulated":
        return _simulated
    if name == "gemini":
        if _gemini is None:
            _gemini = GeminiProvider()
        return _gemini
    raise KeyError(name)
