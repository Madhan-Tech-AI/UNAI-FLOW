from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ApiKeyCreate(BaseModel):
    name: str = Field(..., description="Descriptive label for this API key")
    scopes: List[str] = Field(
        default=["instances:read", "channels:read", "messages:send", "campaigns:read", "campaigns:write", "usage:read"],
        description="Assigned permission scopes"
    )
    environment: str = Field(
        default="live",
        description="API environment: 'live' for production or 'test' for sandbox"
    )
    rate_limit_override: Optional[int] = Field(
        default=None,
        description="Custom rate limit in requests per minute (null for default)"
    )
    description: Optional[str] = Field(
        default=None,
        description="Optional notes or description"
    )
    expires_in_days: Optional[int] = Field(None, description="Optional lifetime in days")


class ApiKeyRotateRequest(BaseModel):
    expires_in_days: Optional[int] = Field(None, description="Optional new lifetime in days")


class ApiKeyResponse(BaseModel):
    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    prefix: str
    scopes: List[str]
    environment: str = "live"
    rate_limit_override: Optional[int] = None
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class ApiKeyCreatedResponse(ApiKeyResponse):
    raw_key: str = Field(..., description="Complete API key secret. Will NEVER be displayed again.")
