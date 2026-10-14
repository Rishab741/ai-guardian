"""
Assign a role and/or department to a user who has already signed up once at
/login (signup is what creates their profiles row via the auth trigger).
Avoids needing the Supabase SQL editor for routine access-management tasks.

Usage (from the api/ directory):
    venv\\Scripts\\python.exe scripts\\manage_user.py you@company.com --role admin
    venv\\Scripts\\python.exe scripts\\manage_user.py jane@company.com --department finance
    venv\\Scripts\\python.exe scripts\\manage_user.py jane@company.com --department finance --role member
"""
import argparse
import asyncio
import os
import sys

import asyncpg
from dotenv import load_dotenv

load_dotenv()

VALID_DEPARTMENTS = {"finance", "hr", "retail_banking", "legal_risk", "technology"}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("--role", choices=["member", "admin"])
    parser.add_argument("--department", choices=sorted(VALID_DEPARTMENTS))
    args = parser.parse_args()

    if not args.role and not args.department:
        parser.error("pass --role, --department, or both")

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url or database_url.startswith("sqlite"):
        print("DATABASE_URL in api/.env is not a Postgres connection string yet.")
        sys.exit(1)

    conn = await asyncpg.connect(database_url, statement_cache_size=0)
    try:
        user_id = await conn.fetchval("SELECT id FROM auth.users WHERE email = $1", args.email)
        if user_id is None:
            print(f"No auth account for {args.email} — they need to sign up at /login first.")
            sys.exit(1)

        profile = await conn.fetchrow("SELECT id FROM profiles WHERE id = $1", user_id)
        if profile is None:
            print(f"Auth account exists for {args.email} but no profile row yet — try signing in again to trigger it.")
            sys.exit(1)

        if args.role:
            await conn.execute("UPDATE profiles SET role = $2 WHERE id = $1", user_id, args.role)
        if args.department:
            await conn.execute("UPDATE profiles SET department = $2 WHERE id = $1", user_id, args.department)

        row = await conn.fetchrow("SELECT department, role FROM profiles WHERE id = $1", user_id)
        print(f"{args.email}: role={row['role']}, department={row['department']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
