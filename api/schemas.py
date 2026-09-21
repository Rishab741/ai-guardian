from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    department: str = "retail_banking"
    user_label: str = "demo.user@enterprise.local"


class PipelineStep(BaseModel):
    step: str
    label: str
    status: str  # "ok" | "blocked" | "hit" | "miss"
    detail: str


class RedactionOut(BaseModel):
    pii_type: str
    token: str


class ChatResponse(BaseModel):
    audit_id: int
    allowed: bool
    response: str
    department_label: str
    cache_hit: bool
    model_used: str | None
    model_label: str | None
    tier: str | None
    cost_usd: float
    latency_ms: int
    redactions: list[RedactionOut]
    pipeline: list[PipelineStep]
