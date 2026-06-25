from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    session_secret: str = "change-me"
    redis_url: str = "redis://localhost:6379/0"
    database_url: str = "postgresql+asyncpg://deliverymanager:deliverymanager@localhost:5432/deliverymanager"
    frontend_url: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000"

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    cursor_api_key: str = ""
    cursor_model: str = "composer-2.5"
    bitbucket_username: str = ""
    bitbucket_app_password: str = ""
    jira_writeback_enabled: bool = True
    jira_impact_analysis_field: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def bitbucket_configured(self) -> bool:
        return bool(self.bitbucket_username and self.bitbucket_app_password)

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def cursor_configured(self) -> bool:
        return bool(self.cursor_api_key)


settings = Settings()
