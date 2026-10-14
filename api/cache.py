"""
Backend-agnostic semantic cache entry point — main.py imports this only.
Demo mode wraps the sync in-memory cache (semantic_cache.py) as async;
production mode is natively async (vector_cache_pg.py: pgvector + Gemini
embeddings). Same lookup()/store()/size()/clear() shape either way.
"""
import config

if config.DEMO_MODE:
    from semantic_cache import cache as _impl

    async def lookup(prompt_redacted: str):
        return _impl.lookup(prompt_redacted)

    async def store(prompt_redacted: str, response: str, model_used: str) -> None:
        _impl.store(prompt_redacted, response, model_used)

    async def size() -> int:
        return _impl.size()

    async def clear() -> None:
        _impl.clear()

else:
    import vector_cache_pg as _impl

    lookup = _impl.lookup
    store = _impl.store
    size = _impl.size
    clear = _impl.clear
