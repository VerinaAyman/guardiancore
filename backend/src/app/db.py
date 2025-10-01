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
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()"),
    Column("updated_at", TIMESTAMP(timezone=True), nullable=False, server_default="now()")
)

Index("idx_rules_type", rules.c.rule_type)
Index("idx_rules_enabled", rules.c.enabled)

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
