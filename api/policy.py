"""Auth & policy layer: entitlements + data-class restrictions per department."""
from dataclasses import dataclass

DEPARTMENTS = {
    "finance": {"label": "Finance", "blocked_pii": ["AU_MEDICARE"]},
    "hr": {"label": "Human Resources", "blocked_pii": ["CREDIT_CARD"]},
    "retail_banking": {"label": "Retail Banking", "blocked_pii": ["AU_MEDICARE"]},
    # Legal & Risk/Compliance is deliberately unrestricted — its function
    # requires visibility across every data class for audit purposes.
    "legal_risk": {"label": "Legal & Risk / Compliance", "blocked_pii": []},
    "technology": {"label": "Technology", "blocked_pii": ["AU_TFN", "AU_MEDICARE", "CREDIT_CARD"]},
}

DEFAULT_DEPARTMENT = "retail_banking"


@dataclass
class PolicyDecision:
    allowed: bool
    department_label: str
    reason: str | None = None
    blocked_pii_types: list[str] | None = None


def check(department: str, detected_pii_types: list[str]) -> PolicyDecision:
    dept = DEPARTMENTS.get(department, DEPARTMENTS[DEFAULT_DEPARTMENT])
    blocked = sorted(set(detected_pii_types) & set(dept["blocked_pii"]))
    if blocked:
        return PolicyDecision(
            allowed=False,
            department_label=dept["label"],
            reason=f"Data class restriction: {dept['label']} is not entitled to route {', '.join(blocked)} to an external model.",
            blocked_pii_types=blocked,
        )
    return PolicyDecision(allowed=True, department_label=dept["label"])
