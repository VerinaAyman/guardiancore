"""Activity tracking router for GDPR-compliant parental dashboard."""

from fastapi import APIRouter, HTTPException, status, Depends,Query
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


# ========== MODELS ==========

class ActivityEventCreate(BaseModel):
    domain: str = Field(min_length=1, max_length=255)
    # Fixed: added "warning" and "visit" which dns_profile.py now logs
    event_type: str = Field(pattern=r"^(visit|time_spent|blocked|warning)$")
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
    warning_count: int      # NEW: separate from blocked
    blocked_category: Optional[str]  # NEW: surface the category to frontend
    has_csp: bool
    has_cors: bool
    time_spent_today: int
    rule_status: str


class DashboardResponse(BaseModel):
    child_id: int
    child_username: str
    tracking_enabled: bool
    summaries: List[DomainActivitySummary]
    date_range: str


class DashboardActionRequest(BaseModel):
    child_id: int
    domain: str
    action: str = Field(pattern=r"^(block|allow)$")
    target_type: str = Field(pattern=r"^(child|group)$", default="child")
    target_id: Optional[int] = None
    force: bool = False


class DashboardActionResponse(BaseModel):
    success: bool
    message: str
    rule_id: Optional[int] = None
    conflict: bool = False
    conflict_rule_type: Optional[str] = None
    duplicate: bool = False


# ========== HELPERS ==========

def hash_domain(domain: str) -> str:
    return hashlib.sha256(domain.encode("utf-8")).hexdigest()


def require_parent(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user["account_type"] != "parent":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only parent accounts can access this endpoint",
        )
    return current_user


async def verify_parent_owns_child(parent_id: int, child_id: int) -> bool:
    async with async_session() as session:
        result = await session.execute(
            select(users).where(
                users.c.id == child_id,
                users.c.parent_id == parent_id,
                users.c.account_type == "child",
            )
        )
        return result.fetchone() is not None


async def check_tracking_enabled(child_id: int) -> bool:
    async with async_session() as session:
        result = await session.execute(
            select(child_activity_settings).where(
                child_activity_settings.c.child_id == child_id,
                child_activity_settings.c.tracking_enabled == True,
            )
        )
        return result.fetchone() is not None


# ========== ENDPOINTS ==========

@router.post("/events", status_code=status.HTTP_201_CREATED)
async def capture_activity_event(
    event: ActivityEventCreate,
    current_user: dict = Depends(get_current_user),
):
    """Capture domain-level activity event (child accounts only)."""
    try:
        if current_user["account_type"] != "child":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only child accounts can submit activity events",
            )

        child_id = current_user["user_id"]
        tracking_enabled = await check_tracking_enabled(child_id)
        if not tracking_enabled:
            return {"message": "Tracking disabled for this child", "stored": False}

        async with async_session() as session:
            domain_hash = hash_domain(event.domain)
            expires_at  = datetime.utcnow() + timedelta(days=3)

            await session.execute(
                insert(activity_events).values(
                    child_id=child_id,
                    domain_hash=domain_hash,
                    domain=event.domain,
                    event_type=event.event_type,
                    duration_seconds=event.duration_seconds,
                    has_csp=event.has_csp,
                    has_cors=event.has_cors,
                    blocked_category=event.blocked_category,
                    event_date=datetime.utcnow(),
                    expires_at=expires_at,
                )
            )
            await session.commit()

            logger.info(f"[Activity] {event.event_type} for child {child_id}: {event.domain}")
            return {"message": "Activity event captured", "stored": True}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to capture activity event")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to capture activity event",
        )


@router.get("/settings/{child_id}", response_model=ActivitySettingsResponse)
async def get_activity_settings(
    child_id: int,
    current_user: dict = Depends(require_parent),
):
    try:
        parent_id = current_user["user_id"]
        if not await verify_parent_owns_child(parent_id, child_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        async with async_session() as session:
            child_result = await session.execute(select(users).where(users.c.id == child_id))
            child = child_result.fetchone()
            if not child:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child not found")

            settings_result = await session.execute(
                select(child_activity_settings).where(
                    child_activity_settings.c.child_id == child_id
                )
            )
            settings = settings_result.fetchone()

            return ActivitySettingsResponse(
                child_id=child_id,
                tracking_enabled=settings.tracking_enabled if settings else False,
                enabled_at=settings.enabled_at if settings else None,
                child_username=child.username,
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to get activity settings")
        raise HTTPException(status_code=500, detail="Failed to get activity settings")


@router.post("/settings", response_model=ActivitySettingsResponse)
async def update_activity_settings(
    settings: ActivitySettingsUpdate,
    current_user: dict = Depends(require_parent),
):
    try:
        parent_id = current_user["user_id"]
        if not await verify_parent_owns_child(parent_id, settings.child_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        async with async_session() as session:
            child_result = await session.execute(select(users).where(users.c.id == settings.child_id))
            child = child_result.fetchone()
            if not child:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child not found")

            existing_result = await session.execute(
                select(child_activity_settings).where(
                    child_activity_settings.c.child_id == settings.child_id
                )
            )
            existing = existing_result.fetchone()
            now = datetime.utcnow()

            if existing:
                await session.execute(
                    update(child_activity_settings)
                    .where(child_activity_settings.c.child_id == settings.child_id)
                    .values(
                        tracking_enabled=settings.tracking_enabled,
                        enabled_at=now if settings.tracking_enabled else existing.enabled_at,
                        disabled_at=None if settings.tracking_enabled else now,
                        updated_at=now,
                    )
                )
            else:
                await session.execute(
                    insert(child_activity_settings).values(
                        child_id=settings.child_id,
                        parent_id=parent_id,
                        tracking_enabled=settings.tracking_enabled,
                        enabled_at=now if settings.tracking_enabled else None,
                    )
                )
            await session.commit()

            return ActivitySettingsResponse(
                child_id=settings.child_id,
                tracking_enabled=settings.tracking_enabled,
                enabled_at=now if settings.tracking_enabled else None,
                child_username=child.username,
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to update activity settings")
        raise HTTPException(status_code=500, detail="Failed to update activity settings")


@router.get("/dashboard/{child_id}", response_model=DashboardResponse)
async def get_activity_dashboard(
    child_id: int,
    days: int = 7,
    current_user: dict = Depends(get_current_user),
):
    """
    Get activity dashboard for a child.
    Warnings and blocks are now counted and surfaced separately.
    """
    try:
        # Auth check
        if current_user["account_type"] == "parent":
            if not await verify_parent_owns_child(current_user["user_id"], child_id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        elif current_user["account_type"] == "child":
            if current_user["user_id"] != child_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        async with async_session() as session:
            child_result = await session.execute(select(users).where(users.c.id == child_id))
            child = child_result.fetchone()
            if not child:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child not found")

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
                    date_range=f"last {days} days",
                )

            cutoff_date = datetime.utcnow() - timedelta(days=days)
            today       = datetime.utcnow().date()

            # ── raw events (covers everything dns_profile.py logs) ──────────
            events_result = await session.execute(
                select(activity_events).where(
                    and_(
                        activity_events.c.child_id == child_id,
                        activity_events.c.event_date >= cutoff_date,
                    )
                )
            )
            event_rows = events_result.fetchall()
            logger.info(f"[Activity] {len(event_rows)} raw events for child {child_id}")

            # ── historical summaries ─────────────────────────────────────────
            summaries_result = await session.execute(
                select(activity_summaries).where(
                    and_(
                        activity_summaries.c.child_id == child_id,
                        activity_summaries.c.summary_date >= cutoff_date,
                    )
                )
            )
            summary_rows = summaries_result.fetchall()

            # ── aggregate by domain ──────────────────────────────────────────
            domain_data: dict[str, dict] = {}

            def _ensure(domain: str):
                if domain not in domain_data:
                    domain_data[domain] = {
                        "total_time_seconds": 0,
                        "visit_count":        0,
                        "blocked_count":      0,
                        "warning_count":      0,   # NEW
                        "blocked_category":   None,
                        "has_csp":            False,
                        "has_cors":           False,
                        "time_today":         0,
                    }

            # Historical summaries — these don't distinguish warn vs block
            # so we map them to blocked_count only (legacy data)
            for row in summary_rows:
                domain = row.domain
                _ensure(domain)
                domain_data[domain]["total_time_seconds"] += row.total_time_seconds or 0
                domain_data[domain]["visit_count"]        += row.visit_count or 0
                domain_data[domain]["blocked_count"]      += row.blocked_count or 0
                if row.has_csp is True:
                    domain_data[domain]["has_csp"] = True
                if row.has_cors is True:
                    domain_data[domain]["has_cors"] = True
                try:
                    sd = row.summary_date.date() if hasattr(row.summary_date, "date") else row.summary_date
                    if sd == today:
                        domain_data[domain]["time_today"] += row.total_time_seconds or 0
                except Exception:
                    pass

            # Raw events — full event_type granularity
            for event in event_rows:
                domain = event.domain
                _ensure(domain)

                et = event.event_type

                if et == "time_spent" and event.duration_seconds:
                    domain_data[domain]["total_time_seconds"] += event.duration_seconds
                    try:
                        ed = event.event_date.date() if hasattr(event.event_date, "date") else event.event_date
                        if ed == today:
                            domain_data[domain]["time_today"] += event.duration_seconds
                    except Exception:
                        pass

                elif et == "visit":
                    domain_data[domain]["visit_count"] += 1

                elif et == "blocked":
                    domain_data[domain]["blocked_count"] += 1
                    # Surface the most recent blocked_category for this domain
                    if event.blocked_category:
                        domain_data[domain]["blocked_category"] = event.blocked_category

                elif et == "warning":
                    # KEY FIX: warnings counted separately, not lumped into blocked_count
                    domain_data[domain]["warning_count"] += 1
                    domain_data[domain]["blocked_category"] = "warning"

                if event.has_csp is True:
                    domain_data[domain]["has_csp"] = True
                if event.has_cors is True:
                    domain_data[domain]["has_cors"] = True

            # ── rule status ─────────────────────────────────────────────────
            rules_result = await session.execute(
                select(child_rules).where(
                    and_(
                        child_rules.c.target_type == "child",
                        child_rules.c.target_id == child_id,
                        child_rules.c.enabled == True,
                        child_rules.c.rule_type.in_(["blocklist", "allowlist"]),
                    )
                )
            )
            domain_rule_status: dict[str, str] = {}
            for rule in rules_result.fetchall():
                pattern = rule.pattern.lower()
                # allowlist takes precedence
                if rule.rule_type == "allowlist":
                    domain_rule_status[pattern] = "allowed"
                elif pattern not in domain_rule_status:
                    domain_rule_status[pattern] = "blocked"

            # ── build response ───────────────────────────────────────────────
            summaries = []
            for domain, data in domain_data.items():
                summaries.append(
                    DomainActivitySummary(
                        domain=domain,
                        total_time_minutes=data["total_time_seconds"] // 60,
                        visit_count=data["visit_count"],
                        blocked_count=data["blocked_count"],
                        warning_count=data["warning_count"],
                        blocked_category=data["blocked_category"],
                        has_csp=data["has_csp"],
                        has_cors=data["has_cors"],
                        time_spent_today=data["time_today"] // 60,
                        rule_status=domain_rule_status.get(domain.lower(), "none"),
                    )
                )

            # Sort: warnings first, then blocked, then by visit count
            summaries.sort(
                key=lambda x: (-(x.warning_count > 0), -(x.blocked_count > 0), -x.visit_count)
            )

            return DashboardResponse(
                child_id=child_id,
                child_username=child.username,
                tracking_enabled=True,
                summaries=summaries,
                date_range=f"last {days} days",
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to get activity dashboard")
        raise HTTPException(status_code=500, detail="Failed to get activity dashboard")


@router.get("/summary")
async def get_activity_summary(
    token: str = Query(None),
    child_id: int = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """
    Convenience endpoint used by the mobile app (api.getActivity).
    Delegates to the dashboard endpoint logic and returns summaries
    in the shape the frontend already expects.
    """
    effective_child_id = child_id or current_user["user_id"]
    dashboard = await get_activity_dashboard(
        child_id=effective_child_id,
        days=7,
        current_user=current_user,
    )
    return {"summaries": [s.dict() for s in dashboard.summaries]}


@router.post("/actions", response_model=DashboardActionResponse)
async def dashboard_action(
    action: DashboardActionRequest,
    current_user: dict = Depends(require_parent),
):
    try:
        parent_id = current_user["user_id"]
        if not await verify_parent_owns_child(parent_id, action.child_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        target_id          = action.target_id if action.target_id else action.child_id
        rule_type          = "blocklist" if action.action == "block" else "allowlist"
        opposite_rule_type = "allowlist" if action.action == "block" else "blocklist"

        async with async_session() as session:
            # Duplicate check
            existing_result = await session.execute(
                select(child_rules).where(
                    and_(
                        child_rules.c.target_type == action.target_type,
                        child_rules.c.target_id == target_id,
                        child_rules.c.pattern == action.domain,
                        child_rules.c.rule_type == rule_type,
                    )
                )
            )
            existing = existing_result.fetchone()

            if existing:
                if existing.enabled:
                    return DashboardActionResponse(
                        success=False,
                        message=f"{action.domain} is already {rule_type.replace('list', 'ed')}",
                        rule_id=existing.id,
                        duplicate=True,
                    )
                # Re-enable disabled rule
                await session.execute(
                    update(child_rules)
                    .where(child_rules.c.id == existing.id)
                    .values(enabled=True, updated_at=datetime.utcnow())
                )
                await session.commit()
                return DashboardActionResponse(
                    success=True,
                    message=f"{action.domain} {'blocked' if action.action == 'block' else 'allowed'} (re-enabled)",
                    rule_id=existing.id,
                )

            # Conflict check
            conflict_result = await session.execute(
                select(child_rules).where(
                    and_(
                        child_rules.c.target_type == action.target_type,
                        child_rules.c.target_id == target_id,
                        child_rules.c.pattern == action.domain,
                        child_rules.c.rule_type == opposite_rule_type,
                        child_rules.c.enabled == True,
                    )
                )
            )
            conflict = conflict_result.fetchone()

            if conflict and not action.force:
                return DashboardActionResponse(
                    success=False,
                    message=f"{action.domain} is currently {opposite_rule_type.replace('list', 'ed')}. Use force=true to switch.",
                    rule_id=conflict.id,
                    conflict=True,
                    conflict_rule_type=opposite_rule_type,
                )

            if conflict and action.force:
                await session.execute(delete(child_rules).where(child_rules.c.id == conflict.id))

            stmt = (
                insert(child_rules)
                .values(
                    rule_type=rule_type,
                    pattern=action.domain,
                    category="dashboard_action",
                    explanation="Added from activity dashboard by parent",
                    enabled=True,
                    target_type=action.target_type,
                    target_id=target_id,
                    created_by=parent_id,
                )
                .returning(child_rules.c.id)
            )
            result = await session.execute(stmt)
            await session.commit()
            rule_id = result.fetchone()[0]

            return DashboardActionResponse(
                success=True,
                message=f"{action.domain} {'blocked' if action.action == 'block' else 'allowed'}",
                rule_id=rule_id,
            )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to perform dashboard action")
        raise HTTPException(status_code=500, detail="Failed to perform dashboard action")


@router.get("/status")
async def get_tracking_status(current_user: dict = Depends(get_current_user)):
    try:
        if current_user["account_type"] == "child":
            tracking_enabled = await check_tracking_enabled(current_user["user_id"])
            return {
                "account_type":    "child",
                "tracking_enabled": tracking_enabled,
                "notice": (
                    "Your parent can see which websites you visit and how long you spend on them. "
                    "No messages or page content are collected."
                ) if tracking_enabled else None,
            }
        else:
            async with async_session() as session:
                result = await session.execute(
                    select(
                        users.c.id,
                        users.c.username,
                        child_activity_settings.c.tracking_enabled,
                        child_activity_settings.c.enabled_at,
                    ).select_from(
                        users.outerjoin(
                            child_activity_settings,
                            users.c.id == child_activity_settings.c.child_id,
                        )
                    ).where(
                        and_(
                            users.c.parent_id == current_user["user_id"],
                            users.c.account_type == "child",
                        )
                    )
                )
                children = result.fetchall()
                return {
                    "account_type": "parent",
                    "children": [
                        {
                            "child_id":        c.id,
                            "child_username":  c.username,
                            "tracking_enabled": c.tracking_enabled or False,
                            "enabled_at":      c.enabled_at.isoformat() if c.enabled_at else None,
                        }
                        for c in children
                    ],
                }
    except Exception:
        logger.exception("Failed to get tracking status")
        raise HTTPException(status_code=500, detail="Failed to get tracking status")