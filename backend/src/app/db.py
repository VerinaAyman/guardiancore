from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import MetaData, Table, Column, BigInteger, Text, CHAR, JSON, TIMESTAMP, Index, text
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
