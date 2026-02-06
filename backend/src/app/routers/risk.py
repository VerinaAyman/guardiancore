from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from typing import Dict, Any, Optional
from ..db import async_session, audit_events
from sqlalchemy import select, func
from ..config import settings
from datetime import datetime, timedelta
import json
import logging

router = APIRouter(prefix="/risk", tags=["risk"])
logger = logging.getLogger(__name__)

class RiskScoreResponse(BaseModel):
    score: int
    updated_at: str
    inputs_breakdown: Dict[str, Any]

def require_bearer(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    token = authorization.split(" ", 1)[1].strip()
    if token not in settings.gc_api_tokens:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
    return token

def _ensure_dict(obj) -> Dict[str, Any]:
    """Ensure policy_state is a dict."""
    if isinstance(obj, dict):
        return obj
    try:
        return json.loads(obj)
    except Exception:
        return {}

async def calculate_risk_score() -> Dict[str, Any]:
    """
    Calculate risk score based on recent audit data (last 24h rolling window).
    
    Weights (configurable in settings):
    - Blocked site attempts: +12 per event
    - Time window violations: +10 per event
    - High-risk tracker category (per unique origin/day): +6
    - Long gaming session (>30 min): +8
    - Compliant hours: -1 per hour (cap at 24)
    
    Score range: [0, 100]
    """
    try:
        async with async_session() as session:
            # Get audit records from last 24 hours
            since = datetime.utcnow() - timedelta(hours=settings.RISK_WINDOW_HOURS)
            q = select(
                audit_events.c.origin_hash,
                audit_events.c.ts,
                audit_events.c.policy_state,
                audit_events.c.check_type
            ).where(audit_events.c.ts >= since).order_by(audit_events.c.ts.desc())
            
            result = await session.execute(q)
            rows = [r._mapping for r in result]
            
            # Initialize counters
            blocked_count = 0
            time_violations = 0
            high_risk_trackers = set()  # unique origins with high-risk trackers
            long_sessions = 0
            compliant_hours = 0
            
            # Track per-origin session times for gaming detection
            origin_sessions = {}  # origin_hash -> list of timestamps
            
            for row in rows:
                ps = _ensure_dict(row["policy_state"])
                origin = row["origin_hash"]
                
                # Count blocked attempts
                if ps.get("blocked"):
                    blocked_count += 1
                    # Check if it's a time window violation
                    # (heuristic: if blocked and check_type indicates time-based)
                    if "time" in str(ps.get("block_reason", "")).lower():
                        time_violations += 1
                
                # Count high-risk trackers (advertising, social_media categories)
                trackers_by_cat = ps.get("trackers_by_category", {})
                if trackers_by_cat.get("advertising", 0) > 3 or trackers_by_cat.get("social_media", 0) > 2:
                    high_risk_trackers.add(origin)
                
                # Track session times for gaming detection
                # (Simplified: we don't have session duration in current schema,
                # so we'll count frequent visits to same origin within window)
                if origin not in origin_sessions:
                    origin_sessions[origin] = []
                origin_sessions[origin].append(row["ts"])
            
            # Detect long gaming sessions (heuristic: >10 visits to same origin in window)
            for origin, timestamps in origin_sessions.items():
                if len(timestamps) > 10:  # Proxy for >30 min session
                    long_sessions += 1
            
            # Calculate compliant hours (hours without violations)
            # Simplified: hours in window minus hours with blocked events
            total_hours = settings.RISK_WINDOW_HOURS
            violation_hours = len(set(row["ts"].hour for row in rows if _ensure_dict(row["policy_state"]).get("blocked")))
            compliant_hours = min(total_hours - violation_hours, settings.RISK_MAX_COMPLIANT_HOURS)
            
            # Calculate weighted score
            score = 0
            score += blocked_count * settings.RISK_WEIGHT_BLOCKED_SITE
            score += time_violations * settings.RISK_WEIGHT_TIME_VIOLATION
            score += len(high_risk_trackers) * settings.RISK_WEIGHT_HIGH_RISK_TRACKER
            score += long_sessions * settings.RISK_WEIGHT_LONG_GAMING_SESSION
            score += compliant_hours * settings.RISK_WEIGHT_COMPLIANT_HOUR  # Negative weight
            
            # Apply floor and cap
            score = max(settings.RISK_SCORE_FLOOR, min(score, settings.RISK_SCORE_CAP))
            
            breakdown = {
                "blocked_site_attempts": blocked_count,
                "time_window_violations": time_violations,
                "high_risk_tracker_origins": len(high_risk_trackers),
                "long_gaming_sessions": long_sessions,
                "compliant_hours": compliant_hours,
                "total_audits_analyzed": len(rows),
                "window_hours": settings.RISK_WINDOW_HOURS
            }
            
            return {
                "score": score,
                "updated_at": datetime.utcnow().isoformat(),
                "inputs_breakdown": breakdown
            }
    except Exception as e:
        logger.exception("Failed to calculate risk score")
        raise

@router.get("/score", response_model=RiskScoreResponse)
async def get_risk_score(_=Depends(require_bearer)):
    """
    Get current risk score based on recent audit activity.
    
    Returns:
    - score: Integer from 0-100
    - updated_at: ISO timestamp of calculation
    - inputs_breakdown: Details of contributing factors
    """
    try:
        result = await calculate_risk_score()
        return RiskScoreResponse(**result)
    except Exception as e:
        logger.exception("Failed to get risk score")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to calculate risk score"
        )
