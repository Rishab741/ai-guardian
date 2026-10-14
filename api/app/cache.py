"""
Semantic cache that is safe across users.

A hit requires all of:
  * same partition: tenant + department + active policy version + tier, so a
    Finance answer never reaches Technology and a policy change starts fresh;
  * same token signature: the prompt contains the same set of ⟦TYPE_n⟧
    placeholders, so the cached (still-tokenized) answer can be re-hydrated
    with the *current* request's values;
  * cosine similarity ≥ threshold, and the entry hasn't expired.

Only redacted text is stored. Embeddings come from Gemini; if that call fails
the local hashed embedding is used and tagged separately, so the two vector
spaces are never compared with each other.
"""
import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from . import config, db, providers

log = logging.getLogger(__name__)


@dataclass
class CacheHit:
    id: int
    response_redacted: str
    model_used: str
    similarity: float


@dataclass
class Embedded:
    vector: list[float]
    model: str
    degraded: bool  # True when the local fallback was used


def partition_key(tenant_id: str, department: str, policy_version: int, tier: str) -> str:
    return hashlib.sha256(f"{tenant_id}|{department}|{policy_version}|{tier}".encode()).hexdigest()[:32]


async def embed(text: str) -> Embedded:
    if config.LLM_PROVIDER == "gemini":
        try:
            vec = (await providers.get("gemini").embed([text]))[0]
            return Embedded(vec, config.EMBED_MODEL, degraded=False)
        except providers.ProviderError as e:
            log.warning("embedding API unavailable (%s); using local embedding", e)
            return Embedded(providers.local_embedding(text), providers.LOCAL_EMBED_MODEL, degraded=True)
    return Embedded(providers.local_embedding(text), providers.LOCAL_EMBED_MODEL, degraded=False)


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


async def lookup(tenant_id: str, partition: str, signature: str, emb: Embedded) -> CacheHit | None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            select id, response_redacted, model_used, 1 - (embedding <=> $5::vector) as similarity
            from cache_entries
            where tenant_id = $1 and partition_key = $2 and token_signature = $3 and embed_model = $4
              and expires_at > now()
            order by embedding <=> $5::vector
            limit 1
            """,
            tenant_id,
            partition,
            signature,
            emb.model,
            _vec(emb.vector),
        )
        if row is None or row["similarity"] < config.CACHE_SIMILARITY_THRESHOLD:
            return None
        await conn.execute("update cache_entries set hits = hits + 1 where id = $1", row["id"])
    return CacheHit(row["id"], row["response_redacted"], row["model_used"], float(row["similarity"]))


async def store(
    tenant_id: str, partition: str, signature: str, emb: Embedded,
    prompt_redacted: str, response_redacted: str, model_used: str, tier: str,
) -> None:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            insert into cache_entries (tenant_id, partition_key, token_signature, embed_model, prompt_redacted,
                                       response_redacted, model_used, tier, embedding, expires_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
            """,
            tenant_id, partition, signature, emb.model, prompt_redacted, response_redacted, model_used, tier,
            _vec(emb.vector), datetime.now(timezone.utc) + timedelta(hours=config.CACHE_TTL_HOURS),
        )


async def size(tenant_id: str) -> int:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval("select count(*) from cache_entries where tenant_id = $1 and expires_at > now()", tenant_id)


async def clear(tenant_id: str) -> int:
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        status = await conn.execute("delete from cache_entries where tenant_id = $1", tenant_id)
    return int(status.split()[-1])
