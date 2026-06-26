from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    session_secret: str = "change-me"
    redis_url: str = "redis://localhost:6379/0"
    database_url: str = "postgresql+asyncpg://deliverymanager:deliverymanager@localhost:5432/deliverymanager"
    frontend_url: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000"

    jira_writeback_enabled: bool = True
    jira_impact_analysis_field: str = ""
    jira_unit_testing_field: str = ""
    jira_admin_database_field: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
