from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional
from ..db import async_session, audit_events
from sqlalchemy import insert, select, func, desc
from ..config import settings
from datetime import datetime, timedelta
import logging

router = APIRouter(prefix="/audit", tags=["audit"])
logger = logging.getLogger(__name__)

class PolicyState(BaseModel):
    csp_present: bool
    cors_signals: bool
    tracker_count: int = Field(ge=0, le=10000)

class AuditRecord(BaseModel):
    origin_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    ts_iso: Optional[datetime] = None
    check_type: str = Field(max_length=64)
    policy_state: PolicyState
    client: Optional[dict] = None

class AuditStats(BaseModel):
    total_audits: int
    unique_origins: int
    avg_trackers: float
    csp_coverage: float
    cors_coverage: float
    recent_activity: int

def require_bearer(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    token = authorization.split(" ", 1)[1].strip()
    if token not in settings.gc_api_tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    return token

@router.post("/submit")
async def submit_audit(record: AuditRecord, _=Depends(require_bearer)):
    """Submit an audit record for processing and storage."""
    try:
        async with async_session() as session:
            stmt = insert(audit_events).values(
                user_id=None,
                origin_hash=record.origin_hash,
                ts=datetime.utcnow(),
                client_ts=record.ts_iso,
                check_type=record.check_type,
                policy_state=record.policy_state.model_dump()
            )
            await session.execute(stmt)
            await session.commit()
        
        logger.info(f"Audit record submitted for origin_hash: {record.origin_hash[:8]}...")
        return {"ok": True, "message": "Audit record submitted successfully"}
    except Exception as e:
        logger.error(f"Failed to submit audit record: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to submit audit record")

@router.get("/stats")
async def get_audit_stats(_=Depends(require_bearer)):
    """Get audit statistics and trends."""
    try:
        async with async_session() as session:
            # Total audits
            total_result = await session.execute(select(func.count(audit_events.c.id)))
            total_audits = total_result.scalar()
            
            # Unique origins
            unique_result = await session.execute(select(func.count(func.distinct(audit_events.c.origin_hash))))
            unique_origins = unique_result.scalar()
            
            # Average trackers
            avg_result = await session.execute(
                select(func.avg(audit_events.c.policy_state["tracker_count"].astext.cast(func.Integer())))
            )
            avg_trackers = float(avg_result.scalar() or 0)
            
            # CSP coverage
            csp_result = await session.execute(
                select(func.count(audit_events.c.id))
                .where(audit_events.c.policy_state["csp_present"].astext == "true")
            )
            csp_count = csp_result.scalar()
            csp_coverage = (csp_count / total_audits * 100) if total_audits > 0 else 0
            
            # CORS coverage
            cors_result = await session.execute(
                select(func.count(audit_events.c.id))
                .where(audit_events.c.policy_state["cors_signals"].astext == "true")
            )
            cors_count = cors_result.scalar()
            cors_coverage = (cors_count / total_audits * 100) if total_audits > 0 else 0
            
            # Recent activity (last 24 hours)
            recent_cutoff = datetime.utcnow() - timedelta(hours=24)
            recent_result = await session.execute(
                select(func.count(audit_events.c.id))
                .where(audit_events.c.ts >= recent_cutoff)
            )
            recent_activity = recent_result.scalar()
            
            stats = AuditStats(
                total_audits=total_audits,
                unique_origins=unique_origins,
                avg_trackers=round(avg_trackers, 2),
                csp_coverage=round(csp_coverage, 2),
                cors_coverage=round(cors_coverage, 2),
                recent_activity=recent_activity
            )
            
            return stats
    except Exception as e:
        logger.error(f"Failed to get audit stats: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get audit statistics")

@router.get("/recent")
async def get_recent_audits(limit: int = 10, _=Depends(require_bearer)):
    """Get recent audit records."""
    try:
        async with async_session() as session:
            stmt = (
                select(audit_events)
                .order_by(desc(audit_events.c.ts))
                .limit(limit)
            )
            result = await session.execute(stmt)
            records = result.scalars().all()
            
            return [
                {
                    "id": record.id,
                    "origin_hash": record.origin_hash,
                    "ts": record.ts.isoformat(),
                    "check_type": record.check_type,
                    "policy_state": record.policy_state
                }
                for record in records
            ]
    except Exception as e:
        logger.error(f"Failed to get recent audits: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to get recent audits")
