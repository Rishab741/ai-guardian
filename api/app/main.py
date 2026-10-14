import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config, console_api, db, openai_api, seed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.validate()
    await db.migrate()
    await seed.bootstrap()
    if config.DEMO_MODE:
        await seed.seed_demo()
    yield
    await db.close()


app = FastAPI(title="SovereignFabric AI Control Gateway", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-SF-Request-Id", "X-SF-Audit-Id", "X-SF-Cache", "X-SF-Redactions", "X-SF-Tier"],
)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > config.MAX_BODY_BYTES:
        return JSONResponse({"error": {"message": "Request body too large.", "type": "invalid_request_error",
                                       "code": "body_too_large"}}, status_code=413)
    return await call_next(request)


@app.get("/healthz")
async def healthz():
    return {"ok": True}


openai_api.install_error_handlers(app)
app.include_router(openai_api.router)
app.include_router(console_api.router)
