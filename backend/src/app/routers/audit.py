from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from ..db import async_session, audit_events
from sqlalchemy import insert, select
from ..config import settings
from datetime import datetime, timedelta
import json
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
    client: Optional[Dict[str, Any]] = None

def require_bearer(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    token = authorization.split(" ", 1)[1].strip()
    if token not in settings.gc_api_tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    return token

def _ensure_dict(obj) -> Dict[str, Any]:
    """asyncpg usually returns dict for JSON; if not, coerce safely."""
    if isinstance(obj, dict):
        return obj
    try:
        return json.loads(obj)
    except Exception:
        return {}

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
                policy_state=record.policy_state.model_dump(),
            )
            await session.execute(stmt)
            await session.commit()
        logger.info("audit submit ok for %s", record.origin_hash[:8])
        return {"ok": True, "message": "Audit record submitted successfully"}
    except Exception as e:
        logger.exception("Failed to submit audit record")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to submit audit record")

@router.get("/recent")
async def recent_audits(_=Depends(require_bearer), limit: int = 10):
    """Get recent audit records."""
    try:
        limit = max(1, min(int(limit), 100))
        async with async_session() as session:
            q = (
                select(
                    audit_events.c.id,
                    audit_events.c.origin_hash,
                    audit_events.c.ts,
                    audit_events.c.check_type,
                    audit_events.c.policy_state,
                )
                .order_by(audit_events.c.ts.desc())
                .limit(limit)
            )
            res = await session.execute(q)

            items = []
            for row in res:
                m = row._mapping
                ps = _ensure_dict(m["policy_state"])
                ts = m["ts"]
                items.append({
                    "id": m["id"],
                    "origin_hash": m["origin_hash"],
                    "ts": ts.isoformat() if hasattr(ts, "isoformat") else ts,
                    "check_type": m["check_type"],
                    "policy_state": ps,
                })
            return {"items": items}
    except Exception:
        logger.exception("Failed to get recent audits")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to get recent audits")

@router.get("/stats")
async def audit_stats(_=Depends(require_bearer), window_hours: Optional[int] = None):
    """Get audit statistics and trends."""
    try:
        async with async_session() as session:
            q = select(
                audit_events.c.origin_hash,
                audit_events.c.ts,
                audit_events.c.policy_state,
            )
            if window_hours is not None:
                hours = max(1, int(window_hours))
                since = datetime.utcnow() - timedelta(hours=hours)
                q = q.where(audit_events.c.ts >= since)

            q = q.order_by(audit_events.c.ts.desc()).limit(5000)
            res = await session.execute(q)
            rows = [r._mapping for r in res]

            total = len(rows)
            unique = len({r["origin_hash"] for r in rows})

            trackers_sum = 0
            csp_yes = 0
            cors_yes = 0
            for r in rows:
                ps = _ensure_dict(r["policy_state"])
                trackers_sum += int(ps.get("tracker_count", 0) or 0)
                csp_yes += 1 if bool(ps.get("csp_present")) else 0
                cors_yes += 1 if bool(ps.get("cors_signals")) else 0

            avg_trackers = (trackers_sum / total) if total else 0.0
            csp_coverage = (csp_yes / total) if total else 0.0
            cors_coverage = (cors_yes / total) if total else 0.0

            return {
                "total_audits": total,
                "unique_origins": unique,
                "avg_trackers": round(avg_trackers, 2),
                "csp_coverage": round(csp_coverage, 3),
                "cors_coverage": round(cors_coverage, 3),
                "recent_activity": total,
            }
    except Exception:
        logger.exception("Failed to get audit stats")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail="Failed to get audit stats")
