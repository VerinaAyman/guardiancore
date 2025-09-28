from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "GuardianCore"
    APP_VERSION: str = "0.1.0"
    ENV: str = "dev"
    # DB
    POSTGRES_HOST: str = "db"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "guardiancore"
    POSTGRES_USER: str = "gc_user"
    POSTGRES_PASSWORD: str = "gc_pass"

    class Config:
        env_file = ".env"

settings = Settings()
