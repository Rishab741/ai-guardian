"""
PII detection, reversible tokenization and re-hydration.

Detection runs locally (regex + checksum validators) and never calls an LLM:
sending text to a model to find PII would leak the PII it is looking for.

Tokens are deterministic ordinals per request, e.g. ⟦AU_TFN_1⟧, ⟦EMAIL_2⟧.
The same value maps to the same token within a request. Because ordinals do
not depend on the value, a cached response written for one request can be
re-hydrated with a later request's values (see cache.py), and user A's
values can never surface for user B.

The Vault holding token -> value lives only in memory for one request. It is
never persisted or logged.
"""
import re
from dataclasses import dataclass, field

PII_LABELS = {
    "AU_TFN": "Tax File Number",
    "AU_MEDICARE": "Medicare number",
    "AU_ABN": "ABN",
    "CREDIT_CARD": "Card number",
    "EMAIL": "Email address",
    "AU_PHONE": "Phone number",
    "PERSON_NAME": "Person name",
}


def _valid_tfn(digits: str) -> bool:
    if len(digits) != 9:
        return False
    weights = [1, 4, 3, 7, 5, 8, 6, 9, 10]
    return sum(int(d) * w for d, w in zip(digits, weights)) % 11 == 0


def _valid_medicare(digits: str) -> bool:
    if len(digits) not in (10, 11):
        return False
    weights = [1, 3, 7, 9, 1, 3, 7, 9]
    return sum(int(d) * w for d, w in zip(digits[:8], weights)) % 10 == int(digits[8])


def _valid_abn(digits: str) -> bool:
    if len(digits) != 11:
        return False
    weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    adjusted = [int(digits[0]) - 1] + [int(d) for d in digits[1:]]
    return sum(v * w for v, w in zip(adjusted, weights)) % 89 == 0


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


# Order matters: more specific / higher-risk patterns claim their spans
# first, so a TFN isn't swallowed by the generic phone pattern.
_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("AU_TFN", re.compile(r"\b(\d{3}[\s-]?\d{3}[\s-]?\d{3})\b")),
    ("AU_MEDICARE", re.compile(r"\b(\d{4}[\s-]?\d{5}[\s-]?\d{1,2})\b")),
    ("AU_ABN", re.compile(r"\b(\d{2}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3})\b")),
    ("CREDIT_CARD", re.compile(r"\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b")),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]*\w\b")),
    ("AU_PHONE", re.compile(r"(?:\+?61[\s-]?|\b0)4\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\(?\b0[2-8]\)?[\s-]?\d{4}[\s-]?\d{4}\b")),
    # Honorific + capitalised name. A stand-in until NER (Presidio) lands in
    # Phase 6; it is precise but misses names without a title.
    ("PERSON_NAME", re.compile(r"\b(?:Mr|Mrs|Ms|Dr|Miss)\.?\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\b")),
]

_VALIDATORS = {
    "AU_TFN": _valid_tfn,
    "AU_MEDICARE": _valid_medicare,
    "AU_ABN": _valid_abn,
    "CREDIT_CARD": _luhn,
}

# Canonical form plus tolerant variants models occasionally produce.
TOKEN_RE = re.compile(r"(?:⟦|\[\[)\s*([A-Z][A-Z_]*_\d+)\s*(?:⟧|\]\])")


@dataclass
class Detection:
    pii_type: str
    start: int
    end: int
    value: str


def detect(text: str) -> list[Detection]:
    """Non-overlapping detections, ordered by position."""
    found: list[Detection] = []
    claimed: list[tuple[int, int]] = []
    for pii_type, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            start, end = (m.start(1), m.end(1)) if m.groups() else (m.start(), m.end())
            if any(start < ce and end > cs for cs, ce in claimed):
                continue
            raw = text[start:end]
            validator = _VALIDATORS.get(pii_type)
            if validator and not validator(re.sub(r"[\s-]", "", raw)):
                continue
            found.append(Detection(pii_type, start, end, raw))
            claimed.append((start, end))
    found.sort(key=lambda d: d.start)
    return found


def _normalise(pii_type: str, value: str) -> str:
    if pii_type == "EMAIL":
        return value.lower()
    if pii_type == "PERSON_NAME":
        return " ".join(value.split())
    return re.sub(r"[^\d]", "", value)


@dataclass
class Vault:
    """Per-request token <-> value map. Memory only."""

    _by_key: dict[tuple[str, str], str] = field(default_factory=dict)
    _by_token: dict[str, tuple[str, str]] = field(default_factory=dict)  # token -> (type, original)
    _counts: dict[str, int] = field(default_factory=dict)

    def token_for(self, pii_type: str, value: str) -> str:
        key = (pii_type, _normalise(pii_type, value))
        token = self._by_key.get(key)
        if token is None:
            n = self._counts.get(pii_type, 0) + 1
            self._counts[pii_type] = n
            token = f"⟦{pii_type}_{n}⟧"
            self._by_key[key] = token
            self._by_token[_token_id(token)] = (pii_type, value)
        return token

    def lookup(self, token_id: str) -> tuple[str, str] | None:
        """(pii_type, original) for a bare token id like 'AU_TFN_1'."""
        return self._by_token.get(token_id)

    @property
    def pii_types(self) -> list[str]:
        return [t for t, _ in self._by_token.values()]

    @property
    def signature(self) -> str:
        """Order-independent fingerprint of which tokens a prompt contains."""
        return ",".join(sorted(self._by_token))

    def __len__(self) -> int:
        return len(self._by_token)


def _token_id(token: str) -> str:
    return token.strip("⟦⟧")


def redact(text: str, vault: Vault, skip_types: frozenset[str] = frozenset()) -> tuple[str, list[Detection]]:
    """Tokenize every detection except data classes policy allows through raw."""
    detections = detect(text)
    out: list[str] = []
    cursor = 0
    for d in detections:
        if d.pii_type in skip_types:
            continue
        out.append(text[cursor:d.start])
        out.append(vault.token_for(d.pii_type, d.value))
        cursor = d.end
    out.append(text[cursor:])
    return "".join(out), detections


def mask_value(pii_type: str, original: str) -> str:
    """Display form for a data class the policy says must not be shown again."""
    if pii_type == "CREDIT_CARD":
        digits = re.sub(r"\D", "", original)
        return f"[card •••• {digits[-4:]}]"
    return f"[{PII_LABELS.get(pii_type, pii_type)} withheld]"


@dataclass
class RehydrationStats:
    rehydrated: int = 0
    masked: int = 0
    misses: int = 0  # token-shaped strings the vault doesn't know


def rehydrate(text: str, vault: Vault, allow: dict[str, bool], stats: RehydrationStats) -> str:
    """Swap tokens back to real values where policy allows; mask otherwise."""

    def sub(m: re.Match) -> str:
        hit = vault.lookup(m.group(1))
        if hit is None:
            stats.misses += 1
            return m.group(0)
        pii_type, original = hit
        if allow.get(pii_type, True):
            stats.rehydrated += 1
            return original
        stats.masked += 1
        return mask_value(pii_type, original)

    return TOKEN_RE.sub(sub, text)


class StreamRehydrator:
    """Re-hydrates a streamed response whose tokens may be split across
    chunks. Text after a possible token opener is held back until the token
    closes or grows too long to be one."""

    _MAX_TOKEN_LEN = 48

    def __init__(self, vault: Vault, allow: dict[str, bool]):
        self.vault = vault
        self.allow = allow
        self.stats = RehydrationStats()
        self._buf = ""

    def feed(self, chunk: str) -> str:
        self._buf += chunk
        hold_from = self._hold_index()
        ready, self._buf = self._buf[:hold_from], self._buf[hold_from:]
        return rehydrate(ready, self.vault, self.allow, self.stats)

    def flush(self) -> str:
        ready, self._buf = self._buf, ""
        return rehydrate(ready, self.vault, self.allow, self.stats)

    def _hold_index(self) -> int:
        """Index where a possibly incomplete token starts, or len(buf)."""
        buf = self._buf
        candidates = [len(buf)]
        for opener, closer in (("⟦", "⟧"), ("[[", "]]")):
            i = buf.rfind(opener)
            if i != -1 and closer not in buf[i:] and len(buf) - i <= self._MAX_TOKEN_LEN:
                candidates.append(i)
        if buf.endswith("["):  # could be the first half of "[["
            candidates.append(len(buf) - 1)
        return min(candidates)
