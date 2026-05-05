from fastapi import FastAPI
from .routers import health
from .routers.audit import router as audit_router
from .routers.rules import router as rules_router
from .routers.risk import router as risk_router
from .routers.webauthn import router as webauthn_router
from .routers.auth import router as auth_router
from .routers.accounts import router as accounts_router
from .routers.activity import router as activity_router
from .routers.analysis import router as analysis_router
from .db import init_db, cleanup_old_activity_events, cleanup_old_activity_summaries, aggregate_activity_summaries
from .config import settings
from fastapi.middleware.cors import CORSMiddleware
import logging
from .routers import notify

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME, 
    version=settings.APP_VERSION,
    description="GuardianCore Backend API - Phase 7: Intelligent Content Classification"
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
app.include_router(activity_router)
app.include_router(analysis_router)
app.include_router(notify.router)
@app.on_event("startup")
async def startup_event():
    """Initialize database on startup."""
    try:
        await init_db()
        logger.info("GuardianCore backend started successfully")
        
        # Schedule retention jobs (run in background)
        import asyncio
        asyncio.create_task(run_retention_jobs())
        
            # Load ML models in background so first request is fast
        import threading
        from .services.pipeline import load_models
        thread = threading.Thread(target=load_models, daemon=True)
        thread.start()
    except Exception as e:
        logger.error(f"Failed to start GuardianCore backend: {e}")
        raise


async def run_retention_jobs():
    """Run periodic retention and aggregation jobs (GDPR compliance)."""
    import asyncio
    
    logger.info("[Retention] Starting periodic retention jobs")
    
    while True:
        try:
            # Run daily at midnight (or every hour in dev)
            await asyncio.sleep(3600)  # 1 hour
            
            logger.info("[Retention] Running scheduled jobs...")
            
            # Aggregate yesterday's events into summaries
            aggregated = await aggregate_activity_summaries()
            logger.info(f"[Retention] Aggregated {aggregated} summary rows")
            
            # Cleanup expired raw events (3 days)
            events_deleted = await cleanup_old_activity_events()
            logger.info(f"[Retention] Deleted {events_deleted} expired events")
            
            # Cleanup expired summaries (3 days)
            summaries_deleted = await cleanup_old_activity_summaries()
            logger.info(f"[Retention] Deleted {summaries_deleted} expired summaries")
            
        except Exception as e:
            logger.error(f"[Retention] Job failed: {e}")
            await asyncio.sleep(60)  # Wait a bit before retrying

@app.get("/")
async def root():
    return {
        "message": "GuardianCore backend alive",
        "version": settings.APP_VERSION,
        "environment": settings.ENV
    }

