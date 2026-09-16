from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class ApplicationCreate(BaseModel):
    name: str = Field(..., description="Descriptive label for this application/integration")
    description: Optional[str] = Field(None, description="Optional notes about this integration")
    environment: str = Field(
        default="live",
        description="API environment: 'live' for production or 'test' for sandbox"
    )
    scopes: List[str] = Field(
        default=[
            "instances:read",
            "channels:read",
            "messages:send",
            "campaigns:read",
            "campaigns:write",
            "usage:read",
        ],
        description="Permission scopes for the auto-generated API key"
    )
    default_instance_id: Optional[str] = Field(
        None,
        description="WhatsApp instance to use by default for this application's campaigns"
    )
    rate_limit_override: Optional[int] = Field(
        None,
        description="Custom rate limit in requests per minute for this application's API key"
    )


class ApplicationUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    default_instance_id: Optional[str] = None
    status: Optional[str] = None


class ApplicationResponse(BaseModel):
    id: str
    organization_id: str
    client_id: str
    name: str
    description: Optional[str] = None
    environment: str = "live"
    status: str = "active"
    default_instance_id: Optional[str] = None
    scopes: List[str] = []
    api_key_count: int = 0
    webhook_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ApplicationCreatedResponse(ApplicationResponse):
    raw_api_key: str = Field(..., description="Complete API key secret. Will NEVER be displayed again.")
    api_key_prefix: str = Field(..., description="API key prefix for display")
    webhook_secret: str = Field(..., description="Webhook signing secret for this application")


class ApplicationCredentials(BaseModel):
    client_id: str = Field(..., description="Non-secret application identifier")
    api_key_prefix: Optional[str] = Field(None, description="API key display prefix (e.g. wa_live_xxxx...)")
    webhook_secret: Optional[str] = Field(None, description="Webhook signing secret")
    environment: str = "live"
