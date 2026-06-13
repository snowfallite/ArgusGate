from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    postgres_host: str = "postgres"
    postgres_port: int = 5432
    postgres_db: str = "argusgate"
    postgres_user: str = "argus"
    postgres_password: SecretStr = SecretStr("changeme_secure")

    @property
    def database_url(self) -> str:
        pw = self.postgres_password.get_secret_value()
        return (
            f"postgresql+asyncpg://{self.postgres_user}:{pw}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def database_url_sync(self) -> str:
        pw = self.postgres_password.get_secret_value()
        return (
            f"postgresql+psycopg2://{self.postgres_user}:{pw}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    redis_url: str = "redis://redis:6379/0"

    qdrant_host: str = "qdrant"
    qdrant_port: int = 6333
    qdrant_collection: str = "attack_signatures"
    qdrant_vector_dim: int = 384

    client_api_key: SecretStr = SecretStr("arg_live_changethis")
    admin_username: str = "admin"
    admin_password: SecretStr = SecretStr("changeme_secure")

    provider_base_url: str = "https://api.openai.com/v1"
    provider_api_key: SecretStr = SecretStr("")

    judge_provider: str = "openai"
    judge_model: str = "gpt-4o-mini"
    judge_api_key: SecretStr = SecretStr("")

    ml_threshold_pass: float = 0.4
    ml_threshold_block: float = 0.85
    vector_similarity_threshold: float = 0.92
    session_risk_threshold: float = 0.75
    session_ttl_seconds: int = 1800

    layer7_enabled: bool = True

    encryption_key: str = ""
    jwt_secret: str = "change-me-in-production-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    signatures_dir: str = "/app/signatures"
    models_dir: str = "/app/models"
    data_dir: str = "/app/data"


settings = Settings()
