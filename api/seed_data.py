"""
Seeds up to a year of realistic historical audit activity so the executive
dashboard and CISO discovery report showcase real trends and savings at
scale, not an empty cold start. Idempotent: no-ops if the audit log already
has data.

Volume ramps up over the year (sparse early, denser recently) to tell a
believable adoption-growth story rather than a flat uniform spread.
"""
import random
from datetime import datetime, timedelta

import database
import model_router
import policy
import redaction as redaction_mod

# Each entry is a prompt that exercises a specific, named scenario so the
# seeded data covers every PII type, every department's policy outcome, and
# a range of routine/no-PII traffic — not just one or two demo prompts.
_SAMPLE_PROMPTS = [
    # Routine, no sensitive data — fast tier
    "What's a good subject line for the monthly customer newsletter?",
    "Draft a policy explainer on Privacy Act obligations for new hires.",
    "Forecast staffing needs for the contact centre next quarter.",
    "Compare vendor pricing for our new CRM rollout.",
    "Summarize APRA CPS 230 operational resilience obligations for our board pack.",
    "Compare this year's compliance incident count to last year.",
    "Analyze churn trends across our retail banking segment this quarter.",
    "Draft an internal FAQ about our new expense claim process.",
    "Suggest three headline options for the Q4 investor update.",
    "Summarize the key changes in the latest RBA cash rate statement.",
    # Tax File Number
    "What is the TFN validation rule we use for onboarding? Example: 123 456 782",
    "Please analyze this customer record for TFN 123 456 782 and confirm eligibility.",
    "Cross-check TFN 123 456 782 against the withholding declaration on file.",
    # Medicare
    "Reconcile the Medicare provider number 2123 45670 1 against our claims record.",
    "Verify Medicare number 2123 45670 1 matches the health insurance claim submitted.",
    # ABN
    "Explain why the audit flagged ABN 51 824 753 556 for review.",
    "Confirm ABN 51 824 753 556 is still active before we onboard this vendor.",
    # Credit card
    "Draft a response to the customer complaint regarding account 4111 1111 1111 1111.",
    "Verify this reimbursement card number 4111 1111 1111 1111 for the expense claim.",
    "Send this customer's card number 4111 1111 1111 1111 to the vendor model for fraud scoring.",
    # Email
    "Draft an email to jane.smith@customerbank.com.au about their loan renewal.",
    "Follow up with mark.chen@enterprise.local regarding the overdue invoice.",
    # Phone
    "Call this customer back on 0412 345 678 to confirm their new address.",
    "Update the contact record — new mobile number is 0498 765 432.",
    # Person name
    "Summarize this customer call transcript involving Mr John Nguyen.",
    "Draft meeting notes referencing feedback from Dr Sarah Ahmed.",
    # Multi-PII combinations
    "Analyze the risk exposure for our SME lending portfolio, contact Ms Olivia Park on 0412 345 678.",
    "Audit this vendor engagement for ABN 51 824 753 556, contact Mr John Nguyen, for compliance review.",
    "Please analyze this customer record for TFN 123 456 782 and email jane.smith@customerbank.com.au",
]

_DEPARTMENTS = list(policy.DEPARTMENTS.keys())


def _pick_day_offset(max_days: int) -> int:
    # Skewed toward recent days (adoption ramp): most mass in the last
    # quarter, a long thin tail back to day `max_days`.
    return int(max_days * (1 - random.random() ** 0.6))


def seed_if_empty(target_count: int = 1800, span_days: int = 365) -> None:
    if database.count_logs() > 0:
        return

    now = datetime.utcnow()
    for _ in range(target_count):
        days_ago = _pick_day_offset(span_days)
        ts = now - timedelta(days=days_ago, hours=random.randint(0, 23), minutes=random.randint(0, 59))
        prompt = random.choice(_SAMPLE_PROMPTS)
        department = random.choice(_DEPARTMENTS)

        result = redaction_mod.redact(prompt)
        pii_types = [r.pii_type for r in result.redactions]

        decision = policy.check(department, pii_types)

        cache_hit = random.random() < 0.42
        tier = model_router.choose_tier(result.redacted_text)
        spec = model_router.MODEL_TIERS[tier]
        in_tok = model_router.estimate_input_tokens(result.redacted_text)
        out_tok = random.randint(120, 450)
        full_cost = round((in_tok / 1000) * spec["in_cost"] + (out_tok / 1000) * spec["out_cost"], 6)
        actual_cost = 0.0 if (cache_hit and decision.allowed) else full_cost

        database.insert_audit_log(
            ts=ts.isoformat(),
            department=department,
            department_label=policy.DEPARTMENTS[department]["label"],
            user_label=f"user{random.randint(100, 499)}@enterprise.local",
            prompt_redacted=result.redacted_text,
            response_redacted="[response withheld by policy]" if not decision.allowed else "Simulated historical response.",
            cache_hit=int(cache_hit and decision.allowed),
            model_used=spec["name"] if decision.allowed else None,
            model_label=spec["label"] if decision.allowed else None,
            tier=tier,
            input_tokens=in_tok,
            output_tokens=out_tok if decision.allowed else 0,
            cost_usd=actual_cost,
            cost_if_no_cache=full_cost if decision.allowed else 0,
            latency_ms=random.randint(180, 1600) if not (cache_hit and decision.allowed) else random.randint(20, 90),
            policy_allowed=int(decision.allowed),
            policy_reason=decision.reason,
            pii_types=pii_types,
            pii_count=len(pii_types),
        )
