from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Set
import os

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)
    
    # App settings
    APP_NAME: str = "GuardianCore"
    APP_VERSION: str = "0.4.0"
    ENV: str = "dev"
    
    # Database settings
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "guardiancore"
    POSTGRES_USER: str = "gc_user"
    POSTGRES_PASSWORD: str = "gc_pass"
    
    # API tokens (comma-separated)
    GC_API_TOKENS_RAW: str = "dev-token-123,staging-token-456"
    
    # Risk scoring weights (Week 4)
    RISK_WEIGHT_BLOCKED_SITE: int = 12
    RISK_WEIGHT_TIME_VIOLATION: int = 10
    RISK_WEIGHT_HIGH_RISK_TRACKER: int = 6
    RISK_WEIGHT_LONG_GAMING_SESSION: int = 8
    RISK_WEIGHT_COMPLIANT_HOUR: int = -1  # Negative = reduces risk
    RISK_MAX_COMPLIANT_HOURS: int = 24  # Cap for compliant hours bonus
    RISK_SCORE_FLOOR: int = 0
    RISK_SCORE_CAP: int = 100
    RISK_WINDOW_HOURS: int = 24  # Rolling window for risk calculation
    
    @property
    def database_url(self) -> str:
        """Construct database URL from components."""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:"
            f"{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:"
            f"{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )
    
    @property
    def gc_api_tokens(self) -> Set[str]:
        """Parse API tokens from comma-separated string."""
        return {t.strip() for t in self.GC_API_TOKENS_RAW.split(",") if t.strip()}

settings = Settings()
