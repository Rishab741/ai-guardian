"""
PII/PHI redaction engine for the AI Control Gateway.

Detects Australian-specific sensitive identifiers (TFN, Medicare, ABN) plus
general PII (email, phone, credit card, person names) and reversibly
tokenizes them before a prompt is allowed to leave the gateway. The mapping
from token -> original value is returned to the caller for this request only
and is never persisted — the audit trail stores only the redacted text.

Detection here is regex + checksum based rather than a full NER model
(spaCy/presidio) to keep the gateway dependency-free and fast for the demo.
The token scheme and pipeline position are identical to what a
presidio-backed implementation would slot into for production.
"""
import re
import secrets
from dataclasses import dataclass, field


@dataclass
class Redaction:
    pii_type: str
    original: str
    token: str
    start: int
    end: int


@dataclass
class RedactionResult:
    redacted_text: str
    redactions: list[Redaction] = field(default_factory=list)
    token_map: dict[str, str] = field(default_factory=dict)

    @property
    def counts_by_type(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for r in self.redactions:
            counts[r.pii_type] = counts.get(r.pii_type, 0) + 1
        return counts


def _valid_tfn(digits: str) -> bool:
    if len(digits) != 9:
        return False
    weights = [1, 4, 3, 7, 5, 8, 6, 9, 10]
    total = sum(int(d) * w for d, w in zip(digits, weights))
    return total % 11 == 0


def _valid_medicare(digits: str) -> bool:
    if len(digits) not in (10, 11):
        return False
    core = digits[:9]
    weights = [1, 3, 7, 9, 1, 3, 7, 9]
    total = sum(int(d) * w for d, w in zip(core[:8], weights))
    return total % 10 == int(core[8])


def _valid_abn(digits: str) -> bool:
    if len(digits) != 11:
        return False
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    adjusted = [int(digits[0]) - 1] + [int(d) for d in digits[1:]]
    total = sum(v * w for v, w in zip(adjusted, weights))
    return total % 89 == 0


def _luhn(digits: str) -> bool:
    total = 0
    for i, d in enumerate(reversed(digits)):
        n = int(d)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


# Order matters: more specific / higher-risk patterns first so a TFN isn't
# swallowed by the generic phone-number pattern, etc.
_PATTERNS = [
    ("AU_TFN", re.compile(r"\b(\d{3}[\s-]?\d{3}[\s-]?\d{3})\b")),
    ("AU_MEDICARE", re.compile(r"\b(\d{4}[\s-]?\d{5}[\s-]?\d{1,2})\b")),
    ("AU_ABN", re.compile(r"\b(\d{2}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3})\b")),
    ("CREDIT_CARD", re.compile(r"\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b")),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
    ("AU_PHONE", re.compile(r"\b(?:\+?61|0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\b\(?0[2-8]\)?[\s-]?\d{4}[\s-]?\d{4}\b")),
    # Simple title-cased "Firstname Lastname" heuristic, standing in for NER.
    ("PERSON_NAME", re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Miss)\.?\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b")),
]

_VALIDATORS = {
    "AU_TFN": _valid_tfn,
    "AU_MEDICARE": _valid_medicare,
    "AU_ABN": _valid_abn,
    "CREDIT_CARD": _luhn,
}


def _classify(pii_type: str, raw_match: str) -> str | None:
    digits = re.sub(r"[\s-]", "", raw_match)
    validator = _VALIDATORS.get(pii_type)
    if validator is None:
        return pii_type
    return pii_type if validator(digits) else None


def redact(text: str) -> RedactionResult:
    """Scan `text`, replace every sensitive span with a reversible token."""
    spans: list[tuple[int, int, str, str]] = []  # start, end, type, original
    claimed: list[tuple[int, int]] = []

    for pii_type, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            group_start, group_end = (m.start(1), m.end(1)) if m.groups() else (m.start(), m.end())
            if any(not (group_end <= cs or group_start >= ce) for cs, ce in claimed):
                continue  # overlaps a higher-priority match already claimed
            raw = text[group_start:group_end]
            resolved_type = _classify(pii_type, raw) if pii_type in _VALIDATORS else pii_type
            if resolved_type is None:
                continue
            spans.append((group_start, group_end, resolved_type, raw))
            claimed.append((group_start, group_end))

    spans.sort(key=lambda s: s[0])

    redactions: list[Redaction] = []
    token_map: dict[str, str] = {}
    out = []
    cursor = 0
    for start, end, pii_type, raw in spans:
        token = f"[{pii_type}_{secrets.token_hex(2).upper()}]"
        out.append(text[cursor:start])
        out.append(token)
        redactions.append(Redaction(pii_type=pii_type, original=raw, token=token, start=start, end=end))
        token_map[token] = raw
        cursor = end
    out.append(text[cursor:])

    return RedactionResult(redacted_text="".join(out), redactions=redactions, token_map=token_map)
