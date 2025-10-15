from fastapi import FastAPI
from .routers import health
from .routers.audit import router as audit_router
from .routers.rules import router as rules_router
from .routers.risk import router as risk_router
from .routers.webauthn import router as webauthn_router
from .routers.auth import router as auth_router
from .routers.accounts import router as accounts_router
from .db import init_db
from .config import settings
from fastapi.middleware.cors import CORSMiddleware
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME, 
    version=settings.APP_VERSION,
    description="GuardianCore Backend API - Phase 5: Account System with Parent-Child Management"
)

# Allow extension to call localhost API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "chrome-extension://*","http://127.0.0.1:8000","http://localhost:3000","*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(health.router)
app.include_router(audit_router)
app.include_router(rules_router)
app.include_router(risk_router)
app.include_router(webauthn_router)
app.include_router(auth_router)
app.include_router(accounts_router)

@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    try:
        await init_db()
        logger.info("GuardianCore backend started successfully")
    except Exception as e:
        logger.error(f"Failed to start GuardianCore backend: {e}")
        raise

@app.get("/")
async def root():
    return {
        "message": "GuardianCore backend alive",
        "version": settings.APP_VERSION,
        "environment": settings.ENV
    }
