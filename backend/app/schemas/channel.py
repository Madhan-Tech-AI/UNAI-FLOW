from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime

class ChannelResponse(BaseModel):
    id: str
    instance_id: str
    newsletter_jid: str
    name: str
    description: Optional[str] = None
    invite_code: Optional[str] = None
    profile_picture: Optional[str] = None
    role: str = "admin"
    subscribers_count: int = 0
    verified: bool = False
    metadata: Optional[Dict[str, Any]] = None
    synced_at: Optional[datetime] = None

class ChannelListResponse(BaseModel):
    data: List[ChannelResponse]
    total: int
