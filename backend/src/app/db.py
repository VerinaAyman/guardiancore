from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy import text
from .config import settings

DATABASE_URL = (
    f"postgresql+asyncpg://{settings.POSTGRES_USER}:"
    f"{settings.POSTGRES_PASSWORD}@{settings.POSTGRES_HOST}:"
    f"{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
)

engine: AsyncEngine = create_async_engine(DATABASE_URL, future=True, pool_pre_ping=True)

async def db_healthcheck():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
