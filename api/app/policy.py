"""
Policy engine. Policies are versioned JSON documents per tenant (table
`policies`); exactly one version is active. Evaluation is pure and fast; the
active document is cached in memory for a few seconds so a change made in the
console reaches every gateway instance almost immediately.

Document shape:
{
  "departments": {
    "<dept_id>": {
      "data_classes": {"CREDIT_CARD": "block", "*": "redact"},   # allow | redact | block
      "rehydrate":    {"CREDIT_CARD": false},                     # default true
      "max_tier":     "deep",                                     # fast | balanced | deep
      "rate_limit_per_user_per_min": 30
    }
  },
  "global": {
    "deny_terms": ["Project Kestrel"],
    "prompt_injection": "flag",                                   # off | flag | block
    "rehydrate": {"CREDIT_CARD": false}
  }
}

"allow" sends the value to the model unredacted; "redact" tokenizes it;
"block" refuses the whole request.
"""
import re
import time
from dataclasses import dataclass, field

from . import db
from .redaction import PII_LABELS

TIERS = ("fast", "balanced", "deep")

DEFAULT_POLICY: dict = {
    "departments": {
        "retail_banking": {"data_classes": {"AU_MEDICARE": "block", "*": "redact"}},
        "finance": {"data_classes": {"AU_MEDICARE": "block", "*": "redact"}},
        "hr": {"data_classes": {"CREDIT_CARD": "block", "*": "redact"}},
        # Legal & Risk / Compliance is deliberately unrestricted: oversight
        # needs visibility across every data class. Values are still
        # tokenized before they leave the boundary.
        "legal_risk": {"data_classes": {"*": "redact"}},
        "technology": {
            "data_classes": {"AU_TFN": "block", "AU_MEDICARE": "block", "CREDIT_CARD": "block", "*": "redact"},
            "max_tier": "balanced",
        },
    },
    "global": {
        "deny_terms": ["Project Kestrel"],
        "prompt_injection": "flag",
        "rehydrate": {"CREDIT_CARD": False},
    },
}

DEFAULT_DEPARTMENTS = [
    ("retail_banking", "Retail Banking"),
    ("finance", "Finance"),
    ("hr", "Human Resources"),
    ("legal_risk", "Legal & Risk / Compliance"),
    ("technology", "Technology"),
]

_INJECTION_RE = re.compile(
    r"ignore (?:all |any )?(?:previous|prior|above) instructions|disregard (?:the |your )?(?:system|previous) prompt|"
    r"reveal (?:your |the )?system prompt|you are now (?:in )?developer mode|jailbreak",
    re.IGNORECASE,
)


@dataclass
class ActivePolicy:
    tenant_id: str
    version: int
    doc: dict
    department_labels: dict[str, str]


@dataclass
class Decision:
    allowed: bool
    department: str
    department_label: str
    policy_version: int
    reason: str | None = None
    blocked_types: list[str] = field(default_factory=list)
    allowed_raw_types: list[str] = field(default_factory=list)  # sent unredacted
    rehydrate: dict[str, bool] = field(default_factory=dict)
    max_tier: str = "deep"
    rate_limit_per_user_per_min: int = 30
    flags: list[str] = field(default_factory=list)


_cache: dict[str, tuple[float, ActivePolicy]] = {}
_CACHE_TTL_S = 5.0


async def get_active(tenant_id: str) -> ActivePolicy:
    hit = _cache.get(tenant_id)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL_S:
        return hit[1]
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "select version, doc from policies where tenant_id = $1 and status = 'active'", tenant_id
        )
        depts = await conn.fetch("select id, label from departments where tenant_id = $1", tenant_id)
    if row is None:
        raise LookupError(f"no active policy for tenant {tenant_id!r}")
    active = ActivePolicy(tenant_id, row["version"], row["doc"], {d["id"]: d["label"] for d in depts})
    _cache[tenant_id] = (time.monotonic(), active)
    return active


def invalidate(tenant_id: str) -> None:
    _cache.pop(tenant_id, None)


def evaluate(policy: ActivePolicy, department: str, pii_types: list[str], raw_text: str) -> Decision:
    doc = policy.doc
    dept_rules = doc.get("departments", {}).get(department, {})
    glob = doc.get("global", {})
    label = policy.department_labels.get(department, department)

    rehydrate = {**glob.get("rehydrate", {}), **dept_rules.get("rehydrate", {})}
    decision = Decision(
        allowed=True,
        department=department,
        department_label=label,
        policy_version=policy.version,
        rehydrate=rehydrate,
        max_tier=dept_rules.get("max_tier", "deep"),
        rate_limit_per_user_per_min=int(dept_rules.get("rate_limit_per_user_per_min", 30)),
    )

    if department not in policy.department_labels:
        decision.allowed = False
        decision.reason = f"Unknown department {department!r}: no entitlements configured."
        return decision

    classes = dept_rules.get("data_classes", {})
    default_action = classes.get("*", "redact")
    for t in sorted(set(pii_types)):
        action = classes.get(t, default_action)
        if action == "block":
            decision.blocked_types.append(t)
        elif action == "allow":
            decision.allowed_raw_types.append(t)

    lowered = raw_text.lower()
    hit_terms = [t for t in glob.get("deny_terms", []) if t and t.lower() in lowered]

    injection_mode = glob.get("prompt_injection", "flag")
    if injection_mode != "off" and _INJECTION_RE.search(raw_text):
        decision.flags.append("prompt_injection")

    if decision.blocked_types:
        names = ", ".join(PII_LABELS.get(t, t) for t in decision.blocked_types)
        decision.allowed = False
        decision.reason = f"Data class restriction: {label} is not entitled to send {names} to an external model."
    elif hit_terms:
        decision.allowed = False
        decision.reason = f"Restricted term detected ({', '.join(hit_terms)}); confidential project names may not leave the boundary."
    elif injection_mode == "block" and "prompt_injection" in decision.flags:
        decision.allowed = False
        decision.reason = "Prompt-injection pattern detected; blocked by policy."
    return decision


def cap_tier(tier: str, max_tier: str) -> str:
    return TIERS[min(TIERS.index(tier), TIERS.index(max_tier))]
