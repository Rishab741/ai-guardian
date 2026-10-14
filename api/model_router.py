"""
Model routing + generation for the AI Control Gateway.

Production (DEMO_MODE=false): calls the real Gemini API, picking the model
tier below based on the same complexity heuristic used in demo mode.

Demo mode: simulates routing decisions and cost/latency against realistic
per-model pricing, and generates a grounded canned response so the chat UI
and dashboard behave exactly as they would in production, without requiring
a live API key the night before a demo.
"""
import asyncio
import random
import re
import time
from dataclasses import dataclass

import config

# Real production LLM calls carry a system prompt, retrieved context (RAG
# chunks, policy documents, prior conversation turns) well beyond the raw
# user prompt — commonly 800-2000+ tokens for a business-grade integration.
# A single-line demo prompt with no injected context would understate real
# enterprise unit economics, so this models that fixed overhead explicitly.
CONTEXT_OVERHEAD_TOKENS = 1200

# Per-1K-token pricing (USD). Approximate Gemini list prices at time of
# writing — verify against https://ai.google.dev/pricing before relying on
# exact cost figures; update these two blocks if Google's pricing changes.
MODEL_TIERS = {
    "fast": {
        "name": config.GEMINI_FAST_MODEL,
        "label": "Fast Tier",
        "in_cost": 0.0001,
        "out_cost": 0.0004,
        "base_latency_ms": 380,
    },
    "deep": {
        "name": config.GEMINI_DEEP_MODEL,
        "label": "Deep Reasoning Tier",
        "in_cost": 0.00125,
        "out_cost": 0.01,
        "base_latency_ms": 1200,
    },
}

_COMPLEX_KEYWORDS = re.compile(
    r"\b(analy[sz]e|compare|strategy|forecast|risk|summar(?:y|ize|ise)|draft|explain why|"
    r"reconcile|audit|compliance|projection|scenario)\b",
    re.IGNORECASE,
)


@dataclass
class ModelResponse:
    text: str
    model_used: str
    model_label: str
    tier: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def estimate_input_tokens(prompt_redacted: str) -> int:
    """Prompt tokens plus the fixed system-prompt/RAG-context overhead a
    real production call would carry. Used for both live chat and seeded
    history so unit economics stay consistent everywhere they're computed."""
    return CONTEXT_OVERHEAD_TOKENS + _estimate_tokens(prompt_redacted)


def estimate_cost(prompt_redacted: str, response_text: str) -> tuple[str, float]:
    """What a fresh model call for this prompt/response pair would cost —
    used to value a cache hit (no call was actually made) so 'savings'
    reflects a real avoided cost, not a token-price coefficient."""
    tier = choose_tier(prompt_redacted)
    spec = MODEL_TIERS[tier]
    input_tokens = estimate_input_tokens(prompt_redacted)
    output_tokens = _estimate_tokens(response_text)
    cost = (input_tokens / 1000) * spec["in_cost"] + (output_tokens / 1000) * spec["out_cost"]
    return tier, round(cost, 6)


def choose_tier(prompt_redacted: str) -> str:
    word_count = len(prompt_redacted.split())
    is_complex = bool(_COMPLEX_KEYWORDS.search(prompt_redacted)) or word_count > 40
    return "deep" if is_complex else "fast"


_TEMPLATES = [
    "Based on the data available, {subject} shows a moderate upward trend over the reporting period, "
    "with no material anomalies flagged against policy thresholds. Variance against the prior quarter "
    "sits within the normal band, and no line items require escalation at this time.",
    "Here is a summary: {subject} is within normal operating parameters. I've cross-checked this against "
    "the last reporting cycle and found no outstanding compliance exceptions. Recommend circulating to the "
    "relevant business owner for sign-off before the next reporting deadline.",
    "I've reviewed {subject}. The key figures are consistent with prior periods; recommend routine sign-off "
    "unless the audit team flags a variance above 5%. Supporting detail has been cross-referenced against "
    "the most recent source-of-truth extract, and no discrepancies were identified.",
    "For {subject}, the current position looks stable. Consider revisiting this analysis next quarter or "
    "if underlying source data is updated. No immediate action is required, though it's worth flagging to "
    "the relevant stakeholders as part of the standard reporting cycle.",
]


def _generate_text(prompt_redacted: str) -> str:
    subject = prompt_redacted.strip().rstrip("?.! ")
    if len(subject) > 60:
        subject = subject[:57] + "..."
    if not subject:
        subject = "this request"
    template = random.choice(_TEMPLATES)
    return template.format(subject=f'"{subject}"')


async def generate(prompt_redacted: str) -> ModelResponse:
    if config.DEMO_MODE:
        return await _generate_demo(prompt_redacted)
    return await _generate_live(prompt_redacted)


async def _generate_demo(prompt_redacted: str) -> ModelResponse:
    tier = choose_tier(prompt_redacted)
    spec = MODEL_TIERS[tier]

    latency_ms = spec["base_latency_ms"] + random.randint(-80, 220)
    await asyncio.sleep(min(latency_ms, 900) / 1000)
    text = _generate_text(prompt_redacted)

    return _build_response(prompt_redacted, text, tier, latency_ms)


async def _generate_live(prompt_redacted: str) -> ModelResponse:
    import gemini_client

    tier = choose_tier(prompt_redacted)
    spec = MODEL_TIERS[tier]

    start = time.time()
    client = gemini_client.get_client()
    response = await client.aio.models.generate_content(
        model=spec["name"],
        contents=prompt_redacted,
    )
    latency_ms = int((time.time() - start) * 1000)
    text = (response.text or "").strip() or "The model returned an empty response."

    return _build_response(prompt_redacted, text, tier, latency_ms)


def _build_response(prompt_redacted: str, text: str, tier: str, latency_ms: int) -> ModelResponse:
    spec = MODEL_TIERS[tier]
    input_tokens = estimate_input_tokens(prompt_redacted)
    output_tokens = _estimate_tokens(text)
    cost = (input_tokens / 1000) * spec["in_cost"] + (output_tokens / 1000) * spec["out_cost"]

    return ModelResponse(
        text=text,
        model_used=spec["name"],
        model_label=spec["label"],
        tier=tier,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=round(cost, 6),
        latency_ms=int(latency_ms),
    )
