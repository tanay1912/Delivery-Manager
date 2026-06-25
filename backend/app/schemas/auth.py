from pydantic import BaseModel, EmailStr, Field


class ConnectRequest(BaseModel):
    site_url: str = Field(..., min_length=3, description="e.g. yoursite.atlassian.net")
    email: EmailStr
    api_token: str = Field(..., min_length=1)
