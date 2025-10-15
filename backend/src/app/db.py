from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import MetaData, Table, Column, BigInteger, Text, CHAR, JSON, TIMESTAMP, Index, text, Boolean, Integer
from .config import settings
import logging

logger = logging.getLogger(__name__)

# Create async engine and session
engine = create_async_engine(settings.database_url, echo=False, future=True, pool_pre_ping=True)
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

async def cleanup_old_audits(days: int = 30):
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
