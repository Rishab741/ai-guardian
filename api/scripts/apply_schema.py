"""
One-time setup: applies supabase_schema.sql to the Postgres database at
DATABASE_URL, so you don't need to open the Supabase SQL editor by hand.
Safe to re-run — every statement in the schema uses `if not exists` /
`create or replace` / `drop ... if exists` guards.

Usage (from the api/ directory):
    venv\\Scripts\\python.exe scripts\\apply_schema.py
"""
import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "supabase_schema.sql"


async def main() -> None:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url or database_url.startswith("sqlite"):
        print("DATABASE_URL in api/.env is not a Postgres connection string yet.")
        print("Get it from Supabase: Settings -> Database -> Connection string -> Connection pooling.")
        sys.exit(1)

    schema_sql = SCHEMA_PATH.read_text()
    host = database_url.split("@")[-1].split("/")[0]  # never print the password

    print(f"Connecting to {host} ...")
    conn = await asyncpg.connect(database_url, statement_cache_size=0)
    try:
        print("Applying supabase_schema.sql ...")
        await conn.execute(schema_sql)
        print("Done. Created/verified: pgvector extension, profiles, audit_logs, cache_entries, RLS policies, signup trigger.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
