from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class ApiKeyCreate(BaseModel):
    name: str = Field(..., description="Descriptive label for this API key")
    scopes: List[str] = Field(
        default=["instances:read", "channels:read", "messages:send"],
        description="Assigned permission scopes"
    )
    expires_in_days: Optional[int] = Field(None, description="Optional lifetime in days")

class ApiKeyResponse(BaseModel):
    id: str
    organization_id: str
    name: str
    prefix: str
    scopes: List[str]
    last_used_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

class ApiKeyCreatedResponse(ApiKeyResponse):
    raw_key: str = Field(..., description="Complete API key secret. Will NEVER be displayed again.")
