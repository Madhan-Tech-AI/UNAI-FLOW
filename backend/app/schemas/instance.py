from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime

class InstanceCreate(BaseModel):
    display_name: Optional[str] = Field(None, description="Friendly display name for the instance")
    webhook_url: Optional[str] = Field(None, description="Optional instance-level webhook URL")

class InstanceResponse(BaseModel):
    id: str
    organization_id: str
    instance_uuid: str
    display_name: Optional[str] = None
    phone_number: Optional[str] = None
    status: str
    connection_state: Optional[str] = None
    last_seen: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class InstanceQRResponse(BaseModel):
    instance_id: str
    status: str
    qr: Optional[str] = Field(None, description="Base64 or Data URL of the QR code")
    expires_at: Optional[datetime] = None

class InstanceHealthResponse(BaseModel):
    instance_id: str
    status: str
    connected: bool
    phone_number: Optional[str] = None
    last_heartbeat: Optional[datetime] = None
    channels_count: int = 0
