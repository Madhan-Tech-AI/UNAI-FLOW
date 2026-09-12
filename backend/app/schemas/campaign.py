from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


# ── Campaign Request/Response Models ──────────────────────────────────────────

class CampaignRecipient(BaseModel):
    """Single recipient in a campaign creation request."""
    recipient_jid: str = Field(..., description="WhatsApp newsletter JID, e.g. 120363171744447809@newsletter")
    recipient_name: Optional[str] = Field(None, description="Optional display name")
    variables: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Template variables for this recipient")


class CampaignCreate(BaseModel):
    """Request body for creating a new bulk messaging campaign."""
    name: str = Field(..., min_length=1, max_length=200, description="Campaign name")
    description: Optional[str] = Field(None, max_length=500, description="Optional campaign description")
    instance_id: Optional[str] = Field(None, description="WhatsApp instance to use (auto-resolved if omitted)")
    message_type: str = Field(
        default="text",
        description="Message type: text, image, video, audio, poll"
    )
    message_payload: Dict[str, Any] = Field(
        ...,
        description="Message content. For text: {body: '...'}. For image: {media_url: '...', caption: '...'}."
    )
    recipients: List[CampaignRecipient] = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="List of recipient JIDs to send to"
    )
    messages_per_second: Optional[float] = Field(
        default=1.0,
        ge=0.1,
        le=10.0,
        description="Delivery rate (messages/second). Max 10."
    )


class CampaignRecipientResponse(BaseModel):
    """Response model for a single campaign recipient."""
    id: str
    recipient_jid: str
    recipient_name: Optional[str] = None
    status: str = "pending"
    provider_message_id: Optional[str] = None
    error_message: Optional[str] = None
    retry_count: int = 0
    sent_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class CampaignResponse(BaseModel):
    """Response model for a campaign with aggregate statistics."""
    id: str
    organization_id: str
    name: str
    description: Optional[str] = None
    instance_id: Optional[str] = None
    message_type: str = "text"
    message_payload: Dict[str, Any] = {}
    status: str = "draft"
    total_recipients: int = 0
    queued_count: int = 0
    sent_count: int = 0
    delivered_count: int = 0
    failed_count: int = 0
    messages_per_second: Optional[float] = 1.0
    idempotency_key: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    launched_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class CampaignLaunchResponse(BaseModel):
    """Response after launching a campaign."""
    id: str
    status: str
    total_recipients: int
    queued_count: int
    message: str = "Campaign launched successfully"


class CampaignListResponse(BaseModel):
    """Paginated list of campaigns."""
    campaigns: List[CampaignResponse]
    total: int
    page: int
    page_size: int


class CampaignRecipientsListResponse(BaseModel):
    """Paginated list of campaign recipients."""
    recipients: List[CampaignRecipientResponse]
    total: int
    page: int
    page_size: int
