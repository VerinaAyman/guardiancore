from typing import Set
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")
    
    # App settings
    APP_NAME: str = Field(default="GuardianCore", env="APP_NAME")
    APP_VERSION: str = Field(default="0.5.0", env="APP_VERSION")
    ENV: str = Field(default="dev", env="ENV")

    # JWT Secret Key
    SECRET_KEY: str = Field(..., env="SECRET_KEY")

    # Database settings
    POSTGRES_HOST: str = Field(default="db", env="POSTGRES_HOST")
    POSTGRES_PORT: int = Field(default=5432, env="POSTGRES_PORT")
    POSTGRES_DB: str = Field(default="guardiancore", env="POSTGRES_DB")
    POSTGRES_USER: str = Field(default="gc_user", env="POSTGRES_USER")
    POSTGRES_PASSWORD: str = Field(..., env="POSTGRES_PASSWORD")

    # API tokens (comma-separated)
    GC_API_TOKENS_RAW: str = Field(default="", env="GC_API_TOKENS_RAW")

    # Hugging Face API key for content classification
    HUGGINGFACE_API_KEY: str = Field(default="", env="HUGGINGFACE_API_KEY")

    # Risk scoring weights (Week 4)
    RISK_WEIGHT_BLOCKED_SITE: int = Field(default=12, env="RISK_WEIGHT_BLOCKED_SITE")
    RISK_WEIGHT_TIME_VIOLATION: int = Field(default=10, env="RISK_WEIGHT_TIME_VIOLATION")
    RISK_WEIGHT_HIGH_RISK_TRACKER: int = Field(default=6, env="RISK_WEIGHT_HIGH_RISK_TRACKER")
    RISK_WEIGHT_LONG_GAMING_SESSION: int = Field(default=8, env="RISK_WEIGHT_LONG_GAMING_SESSION")
    RISK_WEIGHT_COMPLIANT_HOUR: int = Field(default=-1, env="RISK_WEIGHT_COMPLIANT_HOUR")  # Negative = reduces risk
    RISK_MAX_COMPLIANT_HOURS: int = Field(default=24, env="RISK_MAX_COMPLIANT_HOURS")  # Cap for compliant hours bonus
    RISK_SCORE_FLOOR: int = Field(default=0, env="RISK_SCORE_FLOOR")
    RISK_SCORE_CAP: int = Field(default=100, env="RISK_SCORE_CAP")
    RISK_WINDOW_HOURS: int = Field(default=24, env="RISK_WINDOW_HOURS")  # Rolling window for risk calculation

    @property
    def database_url(self) -> str:
        """Construct database URL from components."""
        user = quote_plus(self.POSTGRES_USER)
        password = quote_plus(self.POSTGRES_PASSWORD)
        base = (
            f"postgresql+asyncpg://{user}:{password}@{self.POSTGRES_HOST}:"
            f"{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

        if self.POSTGRES_HOST.lower() not in {"db", "localhost", "127.0.0.1"}:
            return f"{base}?ssl=require"

        return base
    
    @property
    def gc_api_tokens(self) -> Set[str]:
        """Parse API tokens from comma-separated string."""
        return {t.strip() for t in self.GC_API_TOKENS_RAW.split(",") if t.strip()}

settings = Settings()
