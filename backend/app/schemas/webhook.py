from pydantic import BaseModel, HttpUrl, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

class WebhookCreate(BaseModel):
    url: str = Field(..., description="HTTPS endpoint to receive webhook payloads")
    events: List[str] = Field(
        default=["instance.authenticated", "channel.synced", "message.sent", "message.failed"],
        description="Subscribed event types"
    )

class WebhookResponse(BaseModel):
    id: str
    organization_id: str
    url: str
    events: List[str]
    enabled: bool
    created_at: Optional[datetime] = None

class WebhookEventPayload(BaseModel):
    id: str
    type: str
    created_at: datetime
    data: Dict[str, Any]
