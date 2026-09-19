"""
UNAI FLOW — Integration API Router

Provides endpoints for external CRM/SaaS platforms to discover
capabilities, connected WhatsApp numbers, and integration metadata.
These endpoints complement the existing campaign and message APIs
to give external platforms everything they need to replicate the
UNAI FLOW BulkMessaging UI experience.
"""

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from app.api.dependencies import get_auth_context, AuthContext, require_scope
from app.database.supabase import get_supabase_client
from app.core.logging import logger

router = APIRouter(prefix="/v1/integration", tags=["Integration & Platform API"])


# ─────────────────────────────────────────────────────────────────────────────
# Response Models
# ─────────────────────────────────────────────────────────────────────────────

class MessageTypeCapability(BaseModel):
    type: str = Field(..., description="Message type identifier")
    label: str = Field(..., description="Human-readable label")
    description: str = Field(..., description="Description of the message type")
    required_fields: List[str] = Field(..., description="Required fields in message_payload")
    optional_fields: List[str] = Field(default=[], description="Optional fields in message_payload")
    example_payload: Dict[str, Any] = Field(..., description="Example message_payload for this type")


class RateLimits(BaseModel):
    min_messages_per_second: float = 0.1
    max_messages_per_second: float = 10.0
    default_messages_per_second: float = 1.0
    max_recipients_per_campaign: int = 10000
    max_retries_per_recipient: int = 3


class AuthMethod(BaseModel):
    method: str
    description: str
    headers: Dict[str, str]
    example: str


class CapabilitiesResponse(BaseModel):
    service: str = "UNAI FLOW WhatsApp Bulk Messaging"
    version: str = "1.0.0"
    message_types: List[MessageTypeCapability]
    rate_limits: RateLimits
    auth_methods: List[AuthMethod]
    available_scopes: List[str]
    endpoints: Dict[str, str]
    campaign_statuses: List[str]
    recipient_statuses: List[str]
    webhook_events: List[str]
    variable_interpolation: Dict[str, Any]


class WhatsAppNumberInfo(BaseModel):
    phone_number: Optional[str] = None
    session_id: Optional[str] = None
    session_status: str = "UNKNOWN"
    is_connected: bool = False
    last_heartbeat: Optional[str] = None
    profile_picture_url: Optional[str] = None


class WhatsAppNumbersResponse(BaseModel):
    application_id: Optional[str] = None
    application_name: Optional[str] = None
    configured_number: Optional[str] = None
    available_sessions: List[WhatsAppNumberInfo]
    has_active_session: bool = False


class IntegrationHealthResponse(BaseModel):
    status: str = Field(..., description="Overall health: 'healthy', 'degraded', or 'unhealthy'")
    auth: Dict[str, Any]
    whatsapp: Dict[str, Any]
    campaigns: Dict[str, Any]
    timestamp: str


# ─────────────────────────────────────────────────────────────────────────────
# 1. Integration Capabilities — Discovery endpoint
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/capabilities", response_model=CapabilitiesResponse)
async def get_integration_capabilities(
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Returns the full set of capabilities available to integrating platforms.
    
    External CRMs should call this on first setup to discover:
    - Supported message types and their payload schemas
    - Rate limits and recipient caps
    - Available API endpoints
    - Campaign lifecycle statuses
    - Webhook event types for real-time delivery tracking
    - Variable interpolation syntax for personalized messages
    
    This endpoint is the starting point for any CRM integration.
    """
    return CapabilitiesResponse(
        message_types=[
            MessageTypeCapability(
                type="text",
                label="Text Message",
                description="Plain text WhatsApp message with optional {{variable}} interpolation",
                required_fields=["body"],
                optional_fields=[],
                example_payload={"body": "Hello {{name}}, your order {{order_id}} is confirmed!"}
            ),
            MessageTypeCapability(
                type="image",
                label="Image Message",
                description="Image with optional caption. Requires a publicly accessible image URL.",
                required_fields=["media_url"],
                optional_fields=["caption"],
                example_payload={
                    "media_url": "https://example.com/promo-banner.jpg",
                    "caption": "Check out our latest offer, {{name}}!"
                }
            ),
            MessageTypeCapability(
                type="video",
                label="Video Message",
                description="Video with optional caption. Requires a publicly accessible video URL.",
                required_fields=["media_url"],
                optional_fields=["caption"],
                example_payload={
                    "media_url": "https://example.com/demo-video.mp4",
                    "caption": "Watch our product demo"
                }
            ),
            MessageTypeCapability(
                type="audio",
                label="Audio Message",
                description="Audio message. Requires a publicly accessible audio URL.",
                required_fields=["media_url"],
                optional_fields=[],
                example_payload={
                    "media_url": "https://example.com/voicenote.ogg"
                }
            ),
            MessageTypeCapability(
                type="poll",
                label="Poll Message",
                description="Interactive poll with question and multiple choice options.",
                required_fields=["question", "options"],
                optional_fields=["selectable_count"],
                example_payload={
                    "question": "What time works best for your demo?",
                    "options": ["10:00 AM", "2:00 PM", "4:00 PM"],
                    "selectable_count": 1
                }
            ),
        ],
        rate_limits=RateLimits(),
        auth_methods=[
            AuthMethod(
                method="API Key Header",
                description="Pass your API key via the X-API-Key header. Simplest method.",
                headers={"X-API-Key": "wa_live_your_key_here"},
                example='curl -H "X-API-Key: wa_live_xxx" https://api.unaiflow.com/v1/...'
            ),
            AuthMethod(
                method="Bearer Token",
                description="Pass your API key as a Bearer token in the Authorization header.",
                headers={"Authorization": "Bearer wa_live_your_key_here"},
                example='curl -H "Authorization: Bearer wa_live_xxx" https://api.unaiflow.com/v1/...'
            ),
            AuthMethod(
                method="Client Credentials",
                description="Pass Client ID and Client Secret via separate headers. Best for server-to-server.",
                headers={
                    "X-Client-ID": "unai_client_xxxxxxxx",
                    "X-Client-Secret": "unai_sec_xxxxxxxx"
                },
                example='curl -H "X-Client-ID: unai_client_xxx" -H "X-Client-Secret: unai_sec_xxx" https://api.unaiflow.com/v1/...'
            ),
            AuthMethod(
                method="HTTP Basic Auth",
                description="Base64 encode client_id:client_secret and pass in Authorization header.",
                headers={"Authorization": "Basic base64(client_id:client_secret)"},
                example='curl -H "Authorization: Basic $(echo -n client_id:secret | base64)" https://api.unaiflow.com/v1/...'
            ),
        ],
        available_scopes=[
            "messages:send",
            "campaigns:write",
            "campaigns:read",
            "instances:read",
            "channels:read",
            "usage:read",
            "webhooks:read",
            "webhooks:manage",
            "integration:read",
        ],
        endpoints={
            "send_message": "POST /v1/messages/send",
            "verify_auth": "GET /v1/auth/verify",
            "whatsapp_status": "GET /v1/whatsapp/status",
            "integration_capabilities": "GET /v1/integration/capabilities",
            "integration_whatsapp_numbers": "GET /v1/integration/whatsapp-numbers",
            "integration_health": "GET /v1/integration/health",
            "create_campaign": "POST /v1/campaigns",
            "launch_campaign": "POST /v1/campaigns/{id}/launch",
            "get_campaign": "GET /v1/campaigns/{id}",
            "list_campaigns": "GET /v1/campaigns",
            "get_campaign_recipients": "GET /v1/campaigns/{id}/recipients",
            "cancel_campaign": "POST /v1/campaigns/{id}/cancel",
        },
        campaign_statuses=[
            "draft",
            "queued",
            "sending",
            "completed",
            "partial_failure",
            "failed",
            "cancelled",
        ],
        recipient_statuses=[
            "pending",
            "queued",
            "sending",
            "sent",
            "delivered",
            "failed",
            "cancelled",
        ],
        webhook_events=[
            "message.sent",
            "message.delivered",
            "message.failed",
            "campaign.started",
            "campaign.completed",
            "campaign.failed",
        ],
        variable_interpolation={
            "syntax": "{{variable_name}}",
            "description": "Use double curly braces in message body/caption to insert per-recipient variables. The 'name' variable is auto-populated from recipient_name if provided.",
            "example": {
                "message_payload": {"body": "Hello {{name}}, your appointment is on {{date}} at {{time}}."},
                "recipient": {
                    "recipient_jid": "+919876543210",
                    "recipient_name": "Madhan",
                    "variables": {"date": "Sep 20", "time": "3:00 PM"}
                },
                "result": "Hello Madhan, your appointment is on Sep 20 at 3:00 PM."
            }
        }
    )


# ─────────────────────────────────────────────────────────────────────────────
# 2. WhatsApp Numbers — List connected numbers for this application
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/whatsapp-numbers", response_model=WhatsAppNumbersResponse)
async def get_whatsapp_numbers(
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Returns the WhatsApp mobile numbers and session statuses available
    for this integration/application.
    
    External CRMs use this to:
    - Show the connected WhatsApp number in their settings UI
    - Verify the WhatsApp device is online before sending
    - Display session health indicators
    """
    sb = get_supabase_client()

    # Resolve application info if authenticated via API key
    app_name = None
    configured_number = ctx.whatsapp_number

    if ctx.application_id:
        try:
            app_res = (
                sb.table("applications")
                .select("name, whatsapp_number, whatsapp_session_id")
                .eq("id", ctx.application_id)
                .execute()
            )
            if app_res.data:
                app_name = app_res.data[0].get("name")
                configured_number = app_res.data[0].get("whatsapp_number") or configured_number
        except Exception as e:
            logger.warning(f"[INTEGRATION] Failed to resolve application info: {e}")

    # Fetch all WhatsApp sessions for this organization
    sessions: List[WhatsAppNumberInfo] = []
    has_active = False

    try:
        s_res = (
            sb.table("whatsapp_sessions")
            .select("id, phone_number, status, last_heartbeat, last_connected_at, profile_picture_url")
            .eq("user_id", ctx.organization_id)
            .execute()
        )
        for s in (s_res.data or []):
            is_connected = s.get("status") in ["CONNECTED", "READY", "AUTHENTICATED"]
            if is_connected:
                has_active = True
            sessions.append(WhatsAppNumberInfo(
                phone_number=s.get("phone_number"),
                session_id=s.get("id"),
                session_status=s.get("status", "UNKNOWN"),
                is_connected=is_connected,
                last_heartbeat=s.get("last_heartbeat") or s.get("last_connected_at"),
                profile_picture_url=s.get("profile_picture_url"),
            ))
    except Exception as e:
        logger.warning(f"[INTEGRATION] Failed to query WhatsApp sessions: {e}")

    return WhatsAppNumbersResponse(
        application_id=ctx.application_id,
        application_name=app_name,
        configured_number=configured_number,
        available_sessions=sessions,
        has_active_session=has_active,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. Integration Health — Comprehensive health check for CRM setup wizards
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/health", response_model=IntegrationHealthResponse)
async def get_integration_health(
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Comprehensive health check for external CRM setup wizards.
    
    Returns the health status of:
    - Authentication (credentials valid, application active)
    - WhatsApp connectivity (session status, phone number)
    - Campaign system (recent campaign stats)
    
    CRMs should call this during their setup wizard's "Test Connection" step
    and optionally on a periodic health check schedule.
    """
    from datetime import datetime, timezone

    sb = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()

    # Auth check
    auth_info = {
        "valid": True,
        "auth_type": ctx.auth_type,
        "organization_id": ctx.organization_id,
        "application_id": ctx.application_id,
        "scopes": ctx.scopes,
        "environment": ctx.environment,
    }

    # WhatsApp check
    wa_info = {
        "status": "NOT_CONFIGURED",
        "phone_number": ctx.whatsapp_number,
        "is_connected": False,
    }
    try:
        s_res = (
            sb.table("whatsapp_sessions")
            .select("phone_number, status, last_heartbeat")
            .eq("user_id", ctx.organization_id)
            .execute()
        )
        if s_res.data:
            # Find best session
            active = next(
                (s for s in s_res.data if s.get("status") in ["CONNECTED", "READY", "AUTHENTICATED"]),
                s_res.data[0]
            )
            wa_info["status"] = active.get("status", "DISCONNECTED")
            wa_info["phone_number"] = active.get("phone_number") or ctx.whatsapp_number
            wa_info["is_connected"] = active.get("status") in ["CONNECTED", "READY", "AUTHENTICATED"]
            wa_info["last_heartbeat"] = active.get("last_heartbeat")
    except Exception as e:
        wa_info["error"] = str(e)

    # Campaign stats
    campaign_info = {
        "total_campaigns": 0,
        "active_campaigns": 0,
        "total_messages_sent": 0,
    }
    try:
        camp_res = (
            sb.table("api_campaigns")
            .select("id, status, sent_count, delivered_count")
            .eq("organization_id", ctx.organization_id)
            .execute()
        )
        if camp_res.data:
            campaign_info["total_campaigns"] = len(camp_res.data)
            campaign_info["active_campaigns"] = sum(
                1 for c in camp_res.data if c.get("status") in ["queued", "sending"]
            )
            campaign_info["total_messages_sent"] = sum(
                (c.get("sent_count") or 0) + (c.get("delivered_count") or 0)
                for c in camp_res.data
            )
    except Exception as e:
        campaign_info["error"] = str(e)

    # Determine overall health
    overall = "healthy"
    if not wa_info.get("is_connected"):
        overall = "degraded"
    if not auth_info.get("valid"):
        overall = "unhealthy"

    return IntegrationHealthResponse(
        status=overall,
        auth=auth_info,
        whatsapp=wa_info,
        campaigns=campaign_info,
        timestamp=now_iso,
    )
