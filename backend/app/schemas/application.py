from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Literal
from datetime import datetime

SUPPORTED_SCOPES = [
    "messages:send",
    "campaigns:write",
    "campaigns:read",
    "instances:read",
    "channels:read",
    "usage:read",
    "webhooks:read",
    "webhooks:manage",
]


class ApplicationCreate(BaseModel):
    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Descriptive label for this application/integration"
    )
    description: Optional[str] = Field(
        None,
        max_length=500,
        description="Optional notes about this integration"
    )
    environment: Literal["live", "test"] = Field(
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
            "webhooks:read",
            "webhooks:manage",
        ],
        description="Permission scopes for the auto-generated API key"
    )
    default_instance_id: Optional[str] = Field(
        None,
        description="WhatsApp instance to use by default for this application's campaigns"
    )
    rate_limit_override: Optional[int] = Field(
        None,
        ge=1,
        le=10000,
        description="Custom rate limit in requests per minute for this application's API key"
    )
    idempotency_key: Optional[str] = Field(
        None,
        description="Client idempotency key to prevent duplicate creation"
    )

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        trimmed = v.strip()
        if not trimmed:
            raise ValueError("Application name cannot be blank or whitespace only.")
        return trimmed

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, v: List[str]) -> List[str]:
        if not v:
            raise ValueError("At least one permission scope must be selected.")
        invalid = [s for s in v if s not in SUPPORTED_SCOPES]
        if invalid:
            raise ValueError(
                f"Unsupported scope(s): {', '.join(invalid)}. Supported scopes: {', '.join(SUPPORTED_SCOPES)}"
            )
        return list(set(v))


class ApplicationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    default_instance_id: Optional[str] = None
    status: Optional[Literal["active", "suspended", "revoked"]] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            trimmed = v.strip()
            if not trimmed:
                raise ValueError("Application name cannot be blank.")
            return trimmed
        return v


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
