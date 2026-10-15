"""
Tests run against a real Postgres (the dev container's sovereignfabric_test
database) with the offline simulated provider, so they need no API key and
make no network calls. Override with TEST_DATABASE_URL.
"""
import os

os.environ["DATABASE_URL"] = os.getenv(
    "TEST_DATABASE_URL", "postgresql://sf:sf_dev_password@localhost:5433/sovereignfabric_test"
)
os.environ["LLM_PROVIDER"] = "simulated"
os.environ["DEMO_MODE"] = "true"  # personas; history seeding is skipped below
os.environ["DEMO_TOKEN_SECRET"] = "test-demo-secret-0123456789abcdef"
os.environ["DEMO_ACCESS_CODE"] = ""
os.environ["SF_DEMO_APP_KEY"] = "sf-live-test-advisor-key"
os.environ["MODEL_RPM"] = "1000"
os.environ["MODEL_RPD"] = "100000"

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402
from openai import AsyncOpenAI  # noqa: E402

from app import config, console_auth, db, seed  # noqa: E402
from app.main import app  # noqa: E402

ADVISOR_KEY = os.environ["SF_DEMO_APP_KEY"]


@pytest.fixture(scope="session", autouse=True)
async def database():
    conn = await asyncpg.connect(config.DATABASE_URL)
    await conn.execute("drop schema public cascade; create schema public;")
    await conn.close()
    await db.migrate()
    await seed.bootstrap()
    await console_auth.seed_personas()
    yield
    await db.close()


@pytest.fixture(scope="session")
async def http():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://gateway") as c:
        yield c


@pytest.fixture(scope="session")
async def client(http):
    return AsyncOpenAI(base_url="http://gateway/v1", api_key=ADVISOR_KEY, http_client=http, max_retries=0)


async def fetchrow(sql: str, *args):
    pool = await db.get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchrow(sql, *args)


_tokens: dict[str, str] = {}


async def token_for(http, role: str) -> str:
    """Bearer header value for the first demo persona with this role."""
    if role not in _tokens:
        personas = (await http.get("/api/auth/config")).json()["personas"]
        persona = next(p for p in personas if p["role"] == role)
        r = await http.post("/api/auth/demo-login", json={"persona_id": persona["id"]})
        _tokens[role] = r.json()["token"]
    return f"Bearer {_tokens[role]}"
