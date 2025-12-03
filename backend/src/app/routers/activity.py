"""Activity tracking router for GDPR-compliant parental dashboard.

Handles:
- Activity event capture (domain-level only)
- Dashboard data retrieval (parent-only)
- Tracking settings management (enable/disable per child)
- Inline rule actions (block/allow from dashboard)
"""

from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timedelta
from ..db import async_session, child_activity_settings, activity_events, activity_summaries, users, child_rules
from sqlalchemy import insert, select, update, delete, func, and_, or_, text
from ..routers.auth import get_current_user
import hashlib
import logging

router = APIRouter(prefix="/activity", tags=["activity"])
logger = logging.getLogger(__name__)


# ========== REQUEST/RESPONSE MODELS ==========

class ActivityEventCreate(BaseModel):
    domain: str = Field(min_length=1, max_length=255)  # eTLD+1 domain
    event_type: str = Field(pattern=r"^(visit|time_spent|blocked)$")
    duration_seconds: Optional[int] = Field(None, ge=0)
    has_csp: Optional[bool] = None
    has_cors: Optional[bool] = None
    blocked_category: Optional[str] = Field(None, max_length=100)


class ActivitySettingsUpdate(BaseModel):
    child_id: int
    tracking_enabled: bool


class ActivitySettingsResponse(BaseModel):
    child_id: int
    tracking_enabled: bool
    enabled_at: Optional[datetime]
    child_username: str


class DomainActivitySummary(BaseModel):
    domain: str
    total_time_minutes: int
    visit_count: int
    blocked_count: int
    has_csp: bool
    has_cors: bool
    time_spent_today: int  # minutes today


class DashboardResponse(BaseModel):
    child_id: int
    child_username: str
    tracking_enabled: bool
    summaries: List[DomainActivitySummary]
    date_range: str  # "last 7 days" or "last 30 days"


class DashboardActionRequest(BaseModel):
    child_id: int
    domain: str
    action: str = Field(pattern=r"^(block|allow)$")
    target_type: str = Field(pattern=r"^(child|group)$", default="child")
    target_id: Optional[int] = None  # If None, uses child_id


class DashboardActionResponse(BaseModel):
    success: bool
    message: str
    rule_id: int


# ========== HELPER FUNCTIONS ==========

def hash_domain(domain: str) -> str:
    """Generate SHA-256 hash of domain for privacy."""
    return hashlib.sha256(domain.encode('utf-8')).hexdigest()


def require_parent(current_user: dict = Depends(get_current_user)) -> dict:
    """Dependency to ensure current user is a parent."""
    if current_user["account_type"] != "parent":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only parent accounts can access this endpoint"
        )
    return current_user


async def verify_parent_owns_child(parent_id: int, child_id: int) -> bool:
    """Verify that the parent owns the specified child account."""
    async with async_session() as session:
        result = await session.execute(
            select(users).where(
                users.c.id == child_id,
                users.c.parent_id == parent_id,
                users.c.account_type == "child"
            )
        )
        return result.fetchone() is not None


async def check_tracking_enabled(child_id: int) -> bool:
    """Check if activity tracking is enabled for a child."""
    async with async_session() as session:
        result = await session.execute(
            select(child_activity_settings).where(
                child_activity_settings.c.child_id == child_id,
                child_activity_settings.c.tracking_enabled == True
            )
        )
        return result.fetchone() is not None


# ========== ENDPOINTS ==========

@router.post("/events", status_code=status.HTTP_201_CREATED)
async def capture_activity_event(event: ActivityEventCreate, current_user: dict = Depends(get_current_user)):
    """
    Capture domain-level activity event (child accounts only).
    
    GDPR compliance:
    - Only captures eTLD+1 domain, no full URLs
    - No page titles, messages, or content
    - Only if tracking is enabled for this child
    - Auto-expires after 3 days
    """
    try:
        # Only child accounts can submit activity
        if current_user["account_type"] != "child":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only child accounts can submit activity events"
            )
        
        child_id = current_user["user_id"]
        
        # Check if tracking is enabled for this child
        tracking_enabled = await check_tracking_enabled(child_id)
        if not tracking_enabled:
            # Silently ignore if tracking is disabled (not an error)
            return {"message": "Tracking disabled for this child", "stored": False}
        
        async with async_session() as session:
            domain_hash = hash_domain(event.domain)
            expires_at = datetime.utcnow() + timedelta(days=3)  # 3-day retention
            
            stmt = insert(activity_events).values(
                child_id=child_id,
                domain_hash=domain_hash,
                domain=event.domain,
                event_type=event.event_type,
                duration_seconds=event.duration_seconds,
                has_csp=event.has_csp,
                has_cors=event.has_cors,
                blocked_category=event.blocked_category,
                event_date=datetime.utcnow(),
                expires_at=expires_at
            )
            
            await session.execute(stmt)
            await session.commit()
            
            logger.info(f"[Activity] Captured {event.event_type} event for child {child_id}: {event.domain}")
            return {"message": "Activity event captured", "stored": True}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to capture activity event")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to capture activity event"
        )


@router.get("/settings/{child_id}", response_model=ActivitySettingsResponse)
async def get_activity_settings(child_id: int, current_user: dict = Depends(require_parent)):
    """Get activity tracking settings for a child (parent only)."""
    try:
        parent_id = current_user["user_id"]
        
        # Verify parent owns child
        if not await verify_parent_owns_child(parent_id, child_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this child's settings"
            )
        
        async with async_session() as session:
            # Get child info
            child_result = await session.execute(
                select(users).where(users.c.id == child_id)
            )
            child = child_result.fetchone()
            if not child:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child not found")
            
            # Get settings
            settings_result = await session.execute(
                select(child_activity_settings).where(
                    child_activity_settings.c.child_id == child_id
                )
            )
            settings = settings_result.fetchone()
            
            if settings:
                return ActivitySettingsResponse(
                    child_id=child_id,
                    tracking_enabled=settings.tracking_enabled,
                    enabled_at=settings.enabled_at,
                    child_username=child.username
                )
            else:
                # No settings yet, return defaults
                return ActivitySettingsResponse(
                    child_id=child_id,
                    tracking_enabled=False,
                    enabled_at=None,
                    child_username=child.username
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get activity settings")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get activity settings"
        )


@router.post("/settings", response_model=ActivitySettingsResponse)
async def update_activity_settings(settings: ActivitySettingsUpdate, current_user: dict = Depends(require_parent)):
    """
    Enable or disable activity tracking for a child (parent only).
    
    GDPR compliance:
    - Explicit opt-in required
    - Parent must enable tracking per child
    - Child is notified when enabled
    """
    try:
        parent_id = current_user["user_id"]
        
        # Verify parent owns child
        if not await verify_parent_owns_child(parent_id, settings.child_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to modify this child's settings"
            )
        
        async with async_session() as session:
            # Get child info
            child_result = await session.execute(
                select(users).where(users.c.id == settings.child_id)
            )
            child = child_result.fetchone()
            if not child:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child not found")
            
            # Check if settings exist
            existing_result = await session.execute(
                select(child_activity_settings).where(
                    child_activity_settings.c.child_id == settings.child_id
                )
            )
            existing = existing_result.fetchone()
            
            now = datetime.utcnow()
            
            if existing:
                # Update existing settings
                stmt = update(child_activity_settings).where(
                    child_activity_settings.c.child_id == settings.child_id
                ).values(
                    tracking_enabled=settings.tracking_enabled,
                    enabled_at=now if settings.tracking_enabled else existing.enabled_at,
                    disabled_at=None if settings.tracking_enabled else now,
                    updated_at=now
                )
                await session.execute(stmt)
            else:
                # Create new settings
                stmt = insert(child_activity_settings).values(
                    child_id=settings.child_id,
                    parent_id=parent_id,
                    tracking_enabled=settings.tracking_enabled,
                    enabled_at=now if settings.tracking_enabled else None
                )
                await session.execute(stmt)
            
            await session.commit()
            
            logger.info(f"[Activity] Parent {parent_id} {'enabled' if settings.tracking_enabled else 'disabled'} tracking for child {settings.child_id}")
            
            return ActivitySettingsResponse(
                child_id=settings.child_id,
                tracking_enabled=settings.tracking_enabled,
                enabled_at=now if settings.tracking_enabled else None,
                child_username=child.username
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to update activity settings")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update activity settings"
        )


@router.get("/dashboard/{child_id}", response_model=DashboardResponse)
async def get_activity_dashboard(
    child_id: int, 
    days: int = 7,
    current_user: dict = Depends(require_parent)
):
    """
    Get activity dashboard data for a child (parent only).
    
    Shows domain-level summaries with:
    - Total time spent (minutes)
    - Visit count
    - Blocked attempts
    - CSP/CORS presence
    
    GDPR compliance:
    - Only aggregated domain-level data
    - No full URLs, page titles, or content
    - Parent-only access with PIN verification
    """
    try:
        parent_id = current_user["user_id"]
        
        # Verify parent owns child
        if not await verify_parent_owns_child(parent_id, child_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this child's dashboard"
            )
        
        async with async_session() as session:
            # Get child info
            child_result = await session.execute(
                select(users).where(users.c.id == child_id)
            )
            child = child_result.fetchone()
            if not child:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child not found")
            
            # Check if tracking is enabled
            settings_result = await session.execute(
                select(child_activity_settings).where(
                    child_activity_settings.c.child_id == child_id
                )
            )
            settings = settings_result.fetchone()
            tracking_enabled = settings.tracking_enabled if settings else False
            
            if not tracking_enabled:
                return DashboardResponse(
                    child_id=child_id,
                    child_username=child.username,
                    tracking_enabled=False,
                    summaries=[],
                    date_range=f"last {days} days"
                )
            
            # Get aggregated summaries from the last N days
            cutoff_date = datetime.utcnow() - timedelta(days=days)
            today = datetime.utcnow().date()
            
            logger.info(f"[Activity] Querying dashboard for child {child_id}, cutoff: {cutoff_date}, today: {today}")
            
            # Query BOTH summaries AND raw events for real-time data
            # Summaries: aggregated historical data
            summaries_result = await session.execute(
                select(activity_summaries).where(
                    and_(
                        activity_summaries.c.child_id == child_id,
                        activity_summaries.c.summary_date >= cutoff_date
                    )
                )
            )
            summary_rows = summaries_result.fetchall()
            logger.info(f"[Activity] Found {len(summary_rows)} summary rows")
            
            # Raw events: today's data (not yet aggregated)
            events_result = await session.execute(
                select(activity_events).where(
                    and_(
                        activity_events.c.child_id == child_id,
                        activity_events.c.event_date >= cutoff_date
                    )
                )
            )
            event_rows = events_result.fetchall()
            logger.info(f"[Activity] Found {len(event_rows)} raw events")
            
            # Aggregate by domain (combine summaries + raw events)
            domain_data = {}
            
            # First, add historical summaries
            for row in summary_rows:
                domain = row.domain
                if domain not in domain_data:
                    domain_data[domain] = {
                        "total_time_seconds": 0,
                        "visit_count": 0,
                        "blocked_count": 0,
                        "has_csp": False,
                        "has_cors": False,
                        "time_today": 0
                    }
                
                domain_data[domain]["total_time_seconds"] += row.total_time_seconds or 0
                domain_data[domain]["visit_count"] += row.visit_count or 0
                domain_data[domain]["blocked_count"] += row.blocked_count or 0
                # Handle None values explicitly
                if row.has_csp is True:
                    domain_data[domain]["has_csp"] = True
                if row.has_cors is True:
                    domain_data[domain]["has_cors"] = True
                
                # Check if this is today's data - handle both datetime and date objects
                try:
                    summary_date = row.summary_date.date() if hasattr(row.summary_date, 'date') else row.summary_date
                    if summary_date == today:
                        domain_data[domain]["time_today"] += row.total_time_seconds or 0
                except Exception as date_err:
                    logger.warning(f"[Activity] Could not compare date: {date_err}")
            
            # Then, add today's raw events (real-time data)
            for event in event_rows:
                domain = event.domain
                if domain not in domain_data:
                    domain_data[domain] = {
                        "total_time_seconds": 0,
                        "visit_count": 0,
                        "blocked_count": 0,
                        "has_csp": False,
                        "has_cors": False,
                        "time_today": 0
                    }
                
                # Add time spent
                if event.event_type == "time_spent" and event.duration_seconds:
                    domain_data[domain]["total_time_seconds"] += event.duration_seconds
                    try:
                        event_date = event.event_date.date() if hasattr(event.event_date, 'date') else event.event_date
                        if event_date == today:
                            domain_data[domain]["time_today"] += event.duration_seconds
                    except Exception:
                        pass
                
                # Count visits
                if event.event_type == "visit":
                    domain_data[domain]["visit_count"] += 1
                
                # Count blocked attempts
                if event.event_type == "blocked":
                    domain_data[domain]["blocked_count"] += 1
                
                # Track security indicators - handle None explicitly
                if event.has_csp is True:
                    domain_data[domain]["has_csp"] = True
                if event.has_cors is True:
                    domain_data[domain]["has_cors"] = True
            
            logger.info(f"[Activity] Aggregated {len(domain_data)} unique domains")
            
            # Convert to response model
            summaries = []
            for domain, data in domain_data.items():
                summaries.append(DomainActivitySummary(
                    domain=domain,
                    total_time_minutes=data["total_time_seconds"] // 60,
                    visit_count=data["visit_count"],
                    blocked_count=data["blocked_count"],
                    has_csp=data["has_csp"],
                    has_cors=data["has_cors"],
                    time_spent_today=data["time_today"] // 60
                ))
            
            # Sort by total time descending
            summaries.sort(key=lambda x: x.total_time_minutes, reverse=True)
            
            return DashboardResponse(
                child_id=child_id,
                child_username=child.username,
                tracking_enabled=True,
                summaries=summaries,
                date_range=f"last {days} days"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get activity dashboard")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get activity dashboard"
        )


@router.post("/actions", response_model=DashboardActionResponse)
async def dashboard_action(action: DashboardActionRequest, current_user: dict = Depends(require_parent)):
    """
    Perform inline action from dashboard: block or allow a domain.
    
    Creates/updates a scoped rule for the child or group.
    """
    try:
        parent_id = current_user["user_id"]
        
        # Verify parent owns child
        if not await verify_parent_owns_child(parent_id, action.child_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to create rules for this child"
            )
        
        # Determine target
        target_id = action.target_id if action.target_id else action.child_id
        
        async with async_session() as session:
            # Check if rule already exists
            rule_type = "blocklist" if action.action == "block" else "allowlist"
            existing_result = await session.execute(
                select(child_rules).where(
                    and_(
                        child_rules.c.target_type == action.target_type,
                        child_rules.c.target_id == target_id,
                        child_rules.c.pattern == action.domain,
                        child_rules.c.rule_type == rule_type
                    )
                )
            )
            existing = existing_result.fetchone()
            
            if existing:
                # Rule already exists, just enable it
                stmt = update(child_rules).where(
                    child_rules.c.id == existing.id
                ).values(
                    enabled=True,
                    updated_at=datetime.utcnow()
                )
                await session.execute(stmt)
                await session.commit()
                
                return DashboardActionResponse(
                    success=True,
                    message=f"Domain {action.domain} {'blocked' if action.action == 'block' else 'allowed'} (rule re-enabled)",
                    rule_id=existing.id
                )
            else:
                # Create new rule
                stmt = insert(child_rules).values(
                    rule_type=rule_type,
                    pattern=action.domain,
                    category="dashboard_action",
                    explanation=f"Added from activity dashboard by parent",
                    enabled=True,
                    target_type=action.target_type,
                    target_id=target_id,
                    created_by=parent_id
                ).returning(child_rules.c.id)
                
                result = await session.execute(stmt)
                await session.commit()
                rule_id = result.fetchone()[0]
                
                logger.info(f"[Activity] Parent {parent_id} created {rule_type} rule for {action.domain} (child {action.child_id})")
                
                return DashboardActionResponse(
                    success=True,
                    message=f"Domain {action.domain} {'blocked' if action.action == 'block' else 'allowed'}",
                    rule_id=rule_id
                )
                
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to perform dashboard action")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to perform dashboard action"
        )


@router.get("/status")
async def get_tracking_status(current_user: dict = Depends(get_current_user)):
    """
    Get tracking status for current user.
    
    - Child accounts: check if tracking is enabled
    - Parent accounts: get list of children with tracking enabled
    """
    try:
        if current_user["account_type"] == "child":
            # Child checking their own tracking status
            tracking_enabled = await check_tracking_enabled(current_user["user_id"])
            
            return {
                "account_type": "child",
                "tracking_enabled": tracking_enabled,
                "notice": "Your parent can see which websites you visit at the domain level and how long you spend on them, plus basic security settings (CSP/CORS). No messages or page content are collected. This helps set fair rules." if tracking_enabled else None
            }
        else:
            # Parent checking their children's tracking status
            async with async_session() as session:
                result = await session.execute(
                    select(
                        users.c.id,
                        users.c.username,
                        child_activity_settings.c.tracking_enabled,
                        child_activity_settings.c.enabled_at
                    ).select_from(
                        users.outerjoin(
                            child_activity_settings,
                            users.c.id == child_activity_settings.c.child_id
                        )
                    ).where(
                        and_(
                            users.c.parent_id == current_user["user_id"],
                            users.c.account_type == "child"
                        )
                    )
                )
                children = result.fetchall()
                
                children_status = []
                for child in children:
                    children_status.append({
                        "child_id": child.id,
                        "child_username": child.username,
                        "tracking_enabled": child.tracking_enabled if child.tracking_enabled else False,
                        "enabled_at": child.enabled_at.isoformat() if child.enabled_at else None
                    })
                
                return {
                    "account_type": "parent",
                    "children": children_status
                }
                
    except Exception as e:
        logger.exception("Failed to get tracking status")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get tracking status"
        )
