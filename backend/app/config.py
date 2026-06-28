from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str | None = None
    database_ca_cert: str | None = None
    database_ssl_no_verify: bool = False
    backend_port: int = 8080
    ml_service_url: str | None = None
    rl_service_url: str | None = None
    anthropic_api_key: str | None = None


settings = Settings()
