from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, issues, mappings, projects, runs
from app.auth.session import get_redis
from app.config import settings
from app.db.session import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_redis()
    await init_db()
    yield


app = FastAPI(title="Delivery Manager", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(issues.router)
app.include_router(mappings.router)
app.include_router(runs.router)


def _health_payload() -> dict:
    return {
        "status": "ok",
        "api_version": 2,
        "features": {
            "estimation_workflow": True,
            "by_issue": True,
        },
    }


@app.get("/health")
async def health():
    return _health_payload()


@app.get("/api/health")
async def api_health():
    return _health_payload()
