from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

    model_haiku: str = Field(default="claude-haiku-4-5", alias="MODEL_HAIKU")
    model_sonnet: str = Field(default="claude-sonnet-4-6", alias="MODEL_SONNET")
    model_opus: str = Field(default="claude-opus-4-7", alias="MODEL_OPUS")

    database_url: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/bidintel",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    s3_bucket: str = Field(default="", alias="S3_BUCKET")

    demo_mode: bool = Field(default=True, alias="DEMO_MODE")
    demo_company_id: str = Field(
        default="00000000-0000-0000-0000-000000000001",
        alias="DEMO_COMPANY_ID",
    )

    log_level: str = Field(default="INFO", alias="LOG_LEVEL")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
