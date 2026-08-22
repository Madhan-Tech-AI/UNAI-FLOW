from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

class ProviderQR(BaseModel):
    qr_data: str  # Base64 string or data:image/png;base64,...
    expires_at: Optional[datetime] = None

class ProviderStatus(BaseModel):
    status: str  # INITIALIZING, WAITING_FOR_QR, CONNECTING, AUTHENTICATED, DISCONNECTED, ERROR
    is_ready: bool
    phone_number: Optional[str] = None
    display_name: Optional[str] = None
    error: Optional[str] = None

class ProviderChannel(BaseModel):
    newsletter_jid: str
    name: str
    description: Optional[str] = None
    invite_code: Optional[str] = None
    profile_picture: Optional[str] = None
    role: str = "admin"
    subscribers_count: int = 0
    verified: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ProviderMessageResult(BaseModel):
    success: bool
    message_id: str
    timestamp: Optional[datetime] = None
    provider_raw: Optional[Dict[str, Any]] = None
