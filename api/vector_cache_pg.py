"""
Production semantic cache: pgvector cosine similarity over real Gemini
embeddings, replacing the in-memory hashed-bag-of-words cache used in demo
mode (semantic_cache.py). Same lookup()/store()/size()/clear() shape as that
module so main.py's chat pipeline doesn't need to branch on which is active
(main.py picks the module itself based on config.DEMO_MODE).
"""
from dataclasses import dataclass

import db_postgres
import gemini_client
import config

SIMILARITY_THRESHOLD = 0.86  # cosine similarity, same threshold as demo mode


@dataclass
class CacheEntry:
    prompt_redacted: str
    response: str
    model_used: str


async def _embed(text: str) -> list[float]:
    client = gemini_client.get_client()
    result = await client.aio.models.embed_content(model=config.GEMINI_EMBED_MODEL, contents=text)
    return result.embeddings[0].values


def _vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(str(v) for v in embedding) + "]"


async def lookup(prompt_redacted: str) -> tuple[CacheEntry, float] | None:
    embedding = await _embed(prompt_redacted)
    vec = _vector_literal(embedding)
    pool = await db_postgres.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT prompt_redacted, response, model_used,
                   1 - (embedding <=> $1::vector) AS similarity
            FROM cache_entries
            ORDER BY embedding <=> $1::vector
            LIMIT 1
            """,
            vec,
        )
    if row is None or row["similarity"] < SIMILARITY_THRESHOLD:
        return None
    entry = CacheEntry(prompt_redacted=row["prompt_redacted"], response=row["response"], model_used=row["model_used"])
    return entry, float(row["similarity"])


async def store(prompt_redacted: str, response: str, model_used: str) -> None:
    embedding = await _embed(prompt_redacted)
    vec = _vector_literal(embedding)
    pool = await db_postgres.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO cache_entries (prompt_redacted, response, model_used, embedding) VALUES ($1, $2, $3, $4::vector)",
            prompt_redacted,
            response,
            model_used,
            vec,
        )


async def size() -> int:
    pool = await db_postgres.get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval("SELECT COUNT(*) FROM cache_entries")


async def clear() -> None:
    pool = await db_postgres.get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM cache_entries")
