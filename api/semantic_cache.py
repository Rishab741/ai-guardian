"""
Semantic cache for the AI Control Gateway.

Production (DEMO_MODE=false) target: embed each prompt with an OpenAI/Cohere
embedding model and store/query vectors in Pinecone.

Demo mode implementation: a dependency-free hashed bag-of-words vector +
cosine similarity, held in process memory. It is deliberately the same
*shape* as the Pinecone path (embed -> upsert -> query by similarity
threshold) so swapping the backend later is a drop-in change, not a rewrite.
"""
import math
import re
from dataclasses import dataclass, field

_VOCAB_DIM = 512
_TOKEN_RE = re.compile(r"[a-z0-9]+")
SIMILARITY_THRESHOLD = 0.86


def _embed(text: str) -> list[float]:
    vec = [0.0] * _VOCAB_DIM
    tokens = _TOKEN_RE.findall(text.lower())
    if not tokens:
        return vec
    for tok in tokens:
        idx = hash(tok) % _VOCAB_DIM
        vec[idx] += 1.0
    norm = math.sqrt(sum(v * v for v in vec))
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def _cosine(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


@dataclass
class CacheEntry:
    prompt_redacted: str
    response: str
    model_used: str
    vector: list[float] = field(repr=False, default_factory=list)


class SemanticCache:
    def __init__(self, threshold: float = SIMILARITY_THRESHOLD):
        self.threshold = threshold
        self._entries: list[CacheEntry] = []

    def lookup(self, prompt_redacted: str) -> tuple[CacheEntry, float] | None:
        if not self._entries:
            return None
        query_vec = _embed(prompt_redacted)
        best: tuple[CacheEntry, float] | None = None
        for entry in self._entries:
            score = _cosine(query_vec, entry.vector)
            if best is None or score > best[1]:
                best = (entry, score)
        if best and best[1] >= self.threshold:
            return best
        return None

    def store(self, prompt_redacted: str, response: str, model_used: str) -> None:
        self._entries.append(
            CacheEntry(
                prompt_redacted=prompt_redacted,
                response=response,
                model_used=model_used,
                vector=_embed(prompt_redacted),
            )
        )

    def size(self) -> int:
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()


cache = SemanticCache()
