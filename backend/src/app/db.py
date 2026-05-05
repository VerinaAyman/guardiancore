from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import MetaData, Table, Column, BigInteger, Text, CHAR, JSON, TIMESTAMP, Index, text, Boolean, Integer
from .config import settings
import logging

logger = logging.getLogger(__name__)

# Create async engine and session
engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=0,
) 
async_session = async_sessionmaker(engine, expire_on_commit=False)

# Define metadata and tables
metadata = MetaData()

audit_events = Table(
    "audit_events", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("user_id", Text, nullable=True),
    Column("origin_hash", CHAR(64), nullable=False),   # SHA-256 hex
    Column("ts", TIMESTAMP(timezone=True), nullable=False),
    Column("client_ts", TIMESTAMP(timezone=True), nullable=True),
    Column("check_type", Text, nullable=False),
    Column("policy_state", JSON, nullable=False),
    Column("inserted_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

# Create indexes for better query performance
Index("idx_audit_origin_ts", audit_events.c.origin_hash, audit_events.c.ts)
Index("idx_audit_check_type", audit_events.c.check_type)
Index("idx_audit_ts", audit_events.c.ts)

# Parental control rules table
rules = Table(
    "rules", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("rule_type", Text, nullable=False),  # 'allowlist', 'blocklist', 'time_window'
    Column("pattern", Text, nullable=False),  # domain pattern or time rule
    Column("category", Text, nullable=True),  # e.g., 'social_media', 'advertising'
    Column("explanation", Text, nullable=True),  # Human-readable explanation
    Column("enabled", Boolean, nullable=False, server_default="true"),
    Column("bundle_id", Text, nullable=True),  # UUID for rule bundles
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_rules_type", rules.c.rule_type)
Index("idx_rules_enabled", rules.c.enabled)
Index("idx_rules_bundle", rules.c.bundle_id)

# Rule schedules table (multiple intervals per rule)
rules_schedules = Table(
    "rules_schedules", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("rule_id", BigInteger, nullable=False),
    Column("weekday", Integer, nullable=False),  # 0=Sunday, 6=Saturday
    Column("start_time", Text, nullable=False),  # HH:MM format
    Column("end_time", Text, nullable=False),  # HH:MM format
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_schedules_rule", rules_schedules.c.rule_id)

# Rule bundles table (for grouping rules)
rule_bundles = Table(
    "rule_bundles", metadata,
    Column("id", Text, primary_key=True),  # UUID
    Column("name", Text, nullable=False),
    Column("description", Text, nullable=True),
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

# Users table (parent and child accounts)
users = Table(
    "users", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("email", Text, nullable=True, unique=True),  # Only for parent accounts
    Column("password_hash", Text, nullable=True),  # Only for parent accounts
    Column("account_type", Text, nullable=False),  # 'parent' or 'child'
    Column("username", Text, nullable=False),  # Display name
    Column("access_code", Text, nullable=True),  # 6-digit code for child login
    Column("parent_id", BigInteger, nullable=True),  # Foreign key to parent user
    Column("profile_data", JSON, nullable=True),  # Additional profile info
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_users_email", users.c.email)
Index("idx_users_parent", users.c.parent_id)
Index("idx_users_code", users.c.access_code)

# Groups table (parent can group children)
groups = Table(
    "groups", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("parent_id", BigInteger, nullable=False),  # Owner of the group
    Column("name", Text, nullable=False),
    Column("description", Text, nullable=True),
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_groups_parent", groups.c.parent_id)

# Group members table (many-to-many: children to groups)
group_members = Table(
    "group_members", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("group_id", BigInteger, nullable=False),
    Column("child_id", BigInteger, nullable=False),
    Column("added_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_group_members_group", group_members.c.group_id)
Index("idx_group_members_child", group_members.c.child_id)

# Child rules table (rules specific to a child or group)
child_rules = Table(
    "child_rules", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("rule_type", Text, nullable=False),  # 'allowlist', 'blocklist', 'time_window'
    Column("pattern", Text, nullable=False),
    Column("category", Text, nullable=True),
    Column("explanation", Text, nullable=True),
    Column("enabled", Boolean, nullable=False, server_default="true"),
    Column("target_type", Text, nullable=False),  # 'child' or 'group'
    Column("target_id", BigInteger, nullable=False),  # child_id or group_id
    Column("created_by", BigInteger, nullable=False),  # parent_id
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_child_rules_target", child_rules.c.target_type, child_rules.c.target_id)
Index("idx_child_rules_creator", child_rules.c.created_by)

# Per-user gamification state
user_gamification = Table(
    "user_gamification", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("user_id", BigInteger, nullable=False, unique=True),
    Column("day_key", Text, nullable=False),  # 'YYYY-MM-DD'
    Column("xp", Integer, nullable=False, server_default="0"),
    Column("level", Integer, nullable=False, server_default="1"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_gamification_user", user_gamification.c.user_id)

# Per-user audit stats
user_stats = Table(
    "user_stats", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("user_id", BigInteger, nullable=False),
    Column("stat_date", TIMESTAMP(timezone=True), nullable=False),
    Column("total_audits", Integer, nullable=False, server_default="0"),
    Column("unique_origins", Integer, nullable=False, server_default="0"),
    Column("avg_trackers", Integer, nullable=False, server_default="0"),
    Column("csp_coverage", Integer, nullable=False, server_default="0"),
    Column("cors_coverage", Integer, nullable=False, server_default="0"),
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_user_stats_user", user_stats.c.user_id)
Index("idx_user_stats_date", user_stats.c.stat_date)

# Throttling table to prevent duplicate submissions
submit_throttle = Table(
    "submit_throttle", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("origin_hash", CHAR(64), nullable=False),
    Column("tab_id", Integer, nullable=False),
    Column("last_submit", TIMESTAMP(timezone=True), nullable=False),
)

# Create unique index for throttling
from sqlalchemy import UniqueConstraint
Index("idx_throttle_lookup", submit_throttle.c.origin_hash, submit_throttle.c.tab_id, unique=True)
Index("idx_throttle_cleanup", submit_throttle.c.last_submit)

# ========== ACTIVITY TRACKING TABLES (GDPR-Compliant) ==========

# Child activity tracking settings (opt-in per child)
child_activity_settings = Table(
    "child_activity_settings", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("child_id", BigInteger, nullable=False, unique=True),  # child user ID
    Column("parent_id", BigInteger, nullable=False),  # parent who enabled tracking
    Column("tracking_enabled", Boolean, nullable=False, server_default="false"),
    Column("enabled_at", TIMESTAMP(timezone=True), nullable=True),
    Column("disabled_at", TIMESTAMP(timezone=True), nullable=True),
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_activity_settings_child", child_activity_settings.c.child_id)
Index("idx_activity_settings_parent", child_activity_settings.c.parent_id)

# Raw activity events (retained ≤3 days)
activity_events = Table(
    "activity_events", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("child_id", BigInteger, nullable=False),
    Column("domain_hash", CHAR(64), nullable=False),  # SHA-256 of eTLD+1 domain
    Column("domain", Text, nullable=False),  # eTLD+1 domain (e.g., "youtube.com")
    Column("event_type", Text, nullable=False),  # 'visit', 'time_spent', 'blocked'
    Column("duration_seconds", Integer, nullable=True),  # time spent on domain
    Column("has_csp", Boolean, nullable=True),  # CSP header present
    Column("has_cors", Boolean, nullable=True),  # CORS headers present
    Column("blocked_category", Text, nullable=True),  # category if blocked
    Column("event_date", TIMESTAMP(timezone=True), nullable=False),  # event date (day-level)
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("expires_at", TIMESTAMP(timezone=True), nullable=False)  # auto-delete after 3 days
)

Index("idx_activity_events_child", activity_events.c.child_id)
Index("idx_activity_events_domain", activity_events.c.domain_hash)
Index("idx_activity_events_date", activity_events.c.event_date)
Index("idx_activity_events_expires", activity_events.c.expires_at)

# Daily activity summaries (retained ≤3 days, aggregated from events)
activity_summaries = Table(
    "activity_summaries", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=True),
    Column("child_id", BigInteger, nullable=False),
    Column("domain_hash", CHAR(64), nullable=False),
    Column("domain", Text, nullable=False),
    Column("summary_date", TIMESTAMP(timezone=True), nullable=False),  # YYYY-MM-DD
    Column("total_time_seconds", Integer, nullable=False, server_default="0"),
    Column("visit_count", Integer, nullable=False, server_default="0"),
    Column("blocked_count", Integer, nullable=False, server_default="0"),
    Column("has_csp", Boolean, nullable=True),  # aggregated: true if any visit had CSP
    Column("has_cors", Boolean, nullable=True),  # aggregated: true if any visit had CORS
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("expires_at", TIMESTAMP(timezone=True), nullable=False)  # auto-delete after 3 days
)

Index("idx_activity_summaries_child", activity_summaries.c.child_id)
Index("idx_activity_summaries_date", activity_summaries.c.summary_date)
Index("idx_activity_summaries_expires", activity_summaries.c.expires_at)
UniqueConstraint(activity_summaries.c.child_id, activity_summaries.c.domain_hash, activity_summaries.c.summary_date, name='uq_summary_child_domain_date')

async def db_healthcheck():
    """Check database connectivity."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))

async def init_db():
    """Initialize database tables."""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(metadata.create_all)
        logger.info("Database tables initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise

async def cleanup_old_audits(days: int = 3):
    """Delete audit records older than specified days (retention job)."""
    try:
        async with async_session() as session:
            cutoff = text(f"now() - interval '{days} days'")
            stmt = text(f"DELETE FROM audit_events WHERE ts < now() - interval '{days} days'")
            result = await session.execute(stmt)
            await session.commit()
            deleted_count = result.rowcount
            logger.info(f"Retention job: deleted {deleted_count} audit records older than {days} days")
            return deleted_count
    except Exception as e:
        logger.error(f"Failed to cleanup old audits: {e}")
        raise

async def cleanup_old_throttle(minutes: int = 60):
    """Delete throttle records older than specified minutes."""
    try:
        async with async_session() as session:
            stmt = text(f"DELETE FROM submit_throttle WHERE last_submit < now() - interval '{minutes} minutes'")
            result = await session.execute(stmt)
            await session.commit()
            deleted_count = result.rowcount
            logger.info(f"Throttle cleanup: deleted {deleted_count} records older than {minutes} minutes")
            return deleted_count
    except Exception as e:
        logger.error(f"Failed to cleanup old throttle: {e}")
        raise

async def cleanup_old_activity_events(days: int = 3):
    """Delete activity events older than specified days (retention)."""
    try:
        async with async_session() as session:
            # Delete expired events OR events older than days limit
            stmt = text(f"DELETE FROM activity_events WHERE expires_at < now() OR event_date < now() - interval '{days} days'")
            result = await session.execute(stmt)
            await session.commit()
            deleted_count = result.rowcount
            logger.info(f"Activity retention: deleted {deleted_count} raw events (older than {days} days)")
            return deleted_count
    except Exception as e:
        logger.error(f"Failed to cleanup old activity events: {e}")
        raise

async def cleanup_old_activity_summaries(days: int = 3):
    """Delete activity summaries older than specified days (retention)."""
    try:
        async with async_session() as session:
            # Delete expired summaries OR summaries older than days limit
            stmt = text(f"DELETE FROM activity_summaries WHERE expires_at < now() OR summary_date < now() - interval '{days} days'")
            result = await session.execute(stmt)
            await session.commit()
            deleted_count = result.rowcount
            logger.info(f"Activity retention: deleted {deleted_count} summaries (older than {days} days)")
            return deleted_count
    except Exception as e:
        logger.error(f"Failed to cleanup old activity summaries: {e}")
        raise

async def aggregate_activity_summaries():
    """Aggregate daily activity events into summaries (runs daily)."""
    try:
        async with async_session() as session:
            # Aggregate events from yesterday into summaries
            stmt = text("""
                INSERT INTO activity_summaries (
                    child_id, domain_hash, domain, summary_date,
                    total_time_seconds, visit_count, blocked_count,
                    has_csp, has_cors, expires_at
                )
                SELECT 
                    child_id,
                    domain_hash,
                    domain,
                    DATE(event_date) as summary_date,
                    COALESCE(SUM(duration_seconds), 0) as total_time_seconds,
                    COUNT(CASE WHEN event_type = 'visit' THEN 1 END) as visit_count,
                    COUNT(CASE WHEN event_type = 'blocked' THEN 1 END) as blocked_count,
                    BOOL_OR(has_csp) as has_csp,
                    BOOL_OR(has_cors) as has_cors,
                    (DATE(event_date) + INTERVAL '3 days')::timestamp as expires_at
                FROM activity_events
                WHERE DATE(event_date) = CURRENT_DATE - INTERVAL '1 day'
                GROUP BY child_id, domain_hash, domain, DATE(event_date)
                ON CONFLICT (child_id, domain_hash, summary_date) 
                DO UPDATE SET
                    total_time_seconds = activity_summaries.total_time_seconds + EXCLUDED.total_time_seconds,
                    visit_count = activity_summaries.visit_count + EXCLUDED.visit_count,
                    blocked_count = activity_summaries.blocked_count + EXCLUDED.blocked_count,
                    has_csp = activity_summaries.has_csp OR EXCLUDED.has_csp,
                    has_cors = activity_summaries.has_cors OR EXCLUDED.has_cors,
                    updated_at = now()
            """)
            result = await session.execute(stmt)
            await session.commit()
            logger.info(f"Activity aggregation: processed {result.rowcount} summary rows")
            return result.rowcount
    except Exception as e:
        logger.error(f"Failed to aggregate activity summaries: {e}")
        raise

