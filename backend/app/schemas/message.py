from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class TextMessageRequest(BaseModel):
    connection_id: Optional[str] = Field(None, description="Optional connection ID or instance ID")
    instance_id: Optional[str] = None
    to: str = Field(..., description="Recipient newsletter JID, e.g. 120363171744447809@newsletter")
    body: str = Field(..., description="Text message content to publish")

class ImageMessageRequest(BaseModel):
    connection_id: Optional[str] = None
    instance_id: Optional[str] = None
    to: str = Field(..., description="Recipient newsletter JID")
    media_url: Optional[str] = Field(None, description="Publicly accessible image URL")
    media_id: Optional[str] = Field(None, description="Supabase storage media UUID")
    caption: Optional[str] = Field(None, description="Image caption")

class VideoMessageRequest(BaseModel):
    connection_id: Optional[str] = None
    instance_id: Optional[str] = None
    to: str = Field(..., description="Recipient newsletter JID")
    media_url: Optional[str] = None
    media_id: Optional[str] = None
    caption: Optional[str] = None

class AudioMessageRequest(BaseModel):
    connection_id: Optional[str] = None
    instance_id: Optional[str] = None
    to: str = Field(..., description="Recipient newsletter JID")
    media_url: Optional[str] = None
    media_id: Optional[str] = None

class PollMessageRequest(BaseModel):
    connection_id: Optional[str] = None
    instance_id: Optional[str] = None
    to: str = Field(..., description="Recipient newsletter JID")
    question: str = Field(..., description="Poll question text")
    options: List[str] = Field(..., min_length=2, max_length=12, description="Poll selectable options")
    selectable_count: int = Field(1, description="Number of allowed selections (default 1)")

class MessagePublishResponse(BaseModel):
    success: bool = True
    job_id: str
    status: str = "queued"
    idempotency_key: Optional[str] = None
    message: str = "Message successfully queued for publishing"
