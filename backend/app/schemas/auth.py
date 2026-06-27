from pydantic import BaseModel, EmailStr, Field


class ConnectRequest(BaseModel):
    site_url: str = Field(..., min_length=3, description="e.g. yoursite.atlassian.net")
    email: EmailStr
    api_token: str = Field(..., min_length=1)


class BitbucketConnectRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=128)
    app_password: str = Field(default="", max_length=512)


class OpenAIConnectRequest(BaseModel):
    api_key: str = Field(default="", max_length=512)
    model: str = Field(default="gpt-4o-mini", min_length=1, max_length=128)


class CursorConnectRequest(BaseModel):
    api_key: str = Field(default="", max_length=512)
    model: str = Field(default="composer-2.5", min_length=1, max_length=128)


class ModelOption(BaseModel):
    id: str
    label: str


class ModelsListResponse(BaseModel):
    models: list[ModelOption]
    source: str
