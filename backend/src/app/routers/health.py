from fastapi import APIRouter
from ..config import settings
from ..db import db_healthcheck

router = APIRouter(prefix="/health", tags=["health"])

@router.get("")
async def health_root():
    return {"status": "ok", "name": settings.APP_NAME, "env": settings.ENV}

@router.get("/db")
async def health_db():
    await db_healthcheck()
    return {"db": "ok"}

@router.get("/version")
async def version():
    return {"version": settings.APP_VERSION}
