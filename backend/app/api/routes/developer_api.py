import re
from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from app.api.dependencies import get_auth_context, AuthContext, require_scope
from app.services.application_service import application_service
from app.services.publishing_service import publishing_service
from app.services.instance_service import instance_service

from app.schemas.application import ApplicationTestConnectionResponse
from app.database.supabase import get_supabase_client
from app.core.logging import logger

router = APIRouter(prefix="/v1", tags=["Developer & CRM API"])


# ─────────────────────────────────────────────────────────────────────────────
# Request & Response Schemas
# ─────────────────────────────────────────────────────────────────────────────
class SendMessageRequest(BaseModel):
    to: Union[str, List[str]] = Field(
        ...,
        description="Recipient mobile phone number (e.g. '+919876543210')"
    )
    message: Optional[str] = Field(None, description="Message text content")
    body: Optional[str] = Field(None, description="Alias for message")
    text: Optional[str] = Field(None, description="Alias for message")
    media_url: Optional[str] = Field(None, description="Public media URL for image, video, audio, or document")
    caption: Optional[str] = Field(None, description="Caption for media messages")
    message_type: Optional[str] = Field("text", description="Message type: 'text', 'image', 'video', 'audio', 'poll'")
    idempotency_key: Optional[str] = Field(None, description="Idempotency key to avoid duplicate messages")


class MessageSendResponse(BaseModel):
    success: bool
    mode: str = Field("single", description="'single'")
    status: str
    message: str
    job_id: Optional[str] = None
    recipient: Optional[str] = None
    total_recipients: Optional[int] = 1
    idempotency_key: Optional[str] = None


class AuthVerifyResponse(BaseModel):
    valid: bool = True
    auth_type: str
    organization_id: str
    application_id: Optional[str] = None
    application: Optional[Dict[str, Any]] = None
    whatsapp: Optional[Dict[str, Any]] = None


class WhatsAppConnectionStatusResponse(BaseModel):
    status: str = Field(..., description="'CONNECTED', 'READY', 'DISCONNECTED', or 'INITIALIZING'")
    whatsapp_number: Optional[str] = None
    phone_number: Optional[str] = None
    is_ready: bool
    last_heartbeat: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# 1. Authentication & Credential Verification
# ─────────────────────────────────────────────────────────────────────────────
@router.api_route("/auth/verify", methods=["GET", "POST"], response_model=AuthVerifyResponse)
async def verify_authentication(
    ctx: AuthContext = Depends(get_auth_context)
):
    """
    Verifies that client credentials (API Key or Client ID + Secret) are valid,
    checks the associated application status, and inspects WhatsApp connectivity.
    Ideal for external CRM setup validation (e.g. 'Test Connection' in CRM settings).
    """
    app_data = None
    wa_data = None

    if ctx.application_id:
        try:
            raw_app = application_service.get_application(ctx.organization_id, ctx.application_id)
            app_data = {
                "id": raw_app["id"],
                "client_id": raw_app["client_id"],
                "name": raw_app["name"],
                "environment": raw_app["environment"],
                "status": raw_app["status"],
                "whatsapp_number": raw_app.get("whatsapp_number"),
                "scopes": raw_app.get("scopes", []),
                "api_key_count": raw_app.get("api_key_count", 1),
                "created_at": str(raw_app.get("created_at")),
            }
        except Exception as e:
            logger.warning(f"Could not load application in verify: {e}")

    # Inspect WhatsApp session status
    sb = get_supabase_client()
    wa_status = "NOT_CONFIGURED"
    wa_number = ctx.whatsapp_number
    last_hb = None

    try:
        s_res = sb.table("whatsapp_sessions").select("*").eq("user_id", ctx.organization_id).execute()
        if s_res.data:
            # Find matching session by phone if set, or any connected session
            active_s = None
            if wa_number:
                active_s = next((s for s in s_res.data if s.get("phone_number") == wa_number), None)
            if not active_s:
                active_s = next((s for s in s_res.data if s.get("status") in ["CONNECTED", "READY", "AUTHENTICATED"]), None)
            if not active_s and s_res.data:
                active_s = s_res.data[0]

            if active_s:
                wa_status = active_s.get("status", "DISCONNECTED")
                wa_number = active_s.get("phone_number") or wa_number
                last_hb = active_s.get("last_heartbeat") or active_s.get("last_connected_at")
    except Exception as e:
        logger.warning(f"Error querying session for auth verify: {e}")

    wa_data = {
        "status": wa_status,
        "whatsapp_number": wa_number,
        "is_connected": wa_status in ["CONNECTED", "READY", "AUTHENTICATED"],
        "last_heartbeat": last_hb,
    }

    return AuthVerifyResponse(
        valid=True,
        auth_type=ctx.auth_type,
        organization_id=ctx.organization_id,
        application_id=ctx.application_id,
        application=app_data,
        whatsapp=wa_data,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 2. WhatsApp Connection Status (Safe for external CRMs — no QR/secrets)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/whatsapp/status", response_model=WhatsAppConnectionStatusResponse)
async def get_whatsapp_status(
    ctx: AuthContext = Depends(get_auth_context)
):
    """
    Returns the real-time WhatsApp connection status for the authenticated application.
    External CRMs can call this to verify that the mobile number is active before sending.
    Security guarantee: NEVER exposes internal Baileys credentials, QR codes, or session tokens.
    """
    sb = get_supabase_client()
    wa_status = "NOT_CONFIGURED"
    wa_number = ctx.whatsapp_number
    last_hb = None

    try:
        s_res = sb.table("whatsapp_sessions").select("phone_number, status, last_heartbeat, last_connected_at").eq("user_id", ctx.organization_id).execute()
        if s_res.data:
            match = None
            if wa_number:
                match = next((s for s in s_res.data if s.get("phone_number") == wa_number), None)
            if not match:
                match = next((s for s in s_res.data if s.get("status") in ["CONNECTED", "READY", "AUTHENTICATED"]), None)
            if not match and s_res.data:
                match = s_res.data[0]

            if match:
                wa_status = match.get("status", "DISCONNECTED")
                wa_number = match.get("phone_number") or wa_number
                last_hb = match.get("last_heartbeat") or match.get("last_connected_at")
    except Exception as e:
        logger.warning(f"Error checking whatsapp status: {e}")

    return WhatsAppConnectionStatusResponse(
        status=wa_status,
        whatsapp_number=wa_number,
        phone_number=wa_number,
        is_ready=wa_status in ["CONNECTED", "READY", "AUTHENTICATED"],
        last_heartbeat=last_hb,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. Developer Direct Message Dispatch
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/messages/send")
async def get_messages_send_info():
    """
    Informational endpoint returned when visiting /v1/messages/send in a browser via GET.
    Provides clear instructions on how external integrations dispatch direct messages using POST.
    """
    return {
        "status": "online",
        "endpoint": "POST https://unai-flow-backend-w4al.onrender.com/v1/messages/send",
        "service": "UNAI FLOW WhatsApp Direct Message Dispatcher",
        "method_required": "POST",
        "note": "Web browsers perform GET requests by default when visiting a URL in the address bar. To dispatch direct messages from your platform, use HTTP POST with your X-API-Key and JSON body. Bulk messaging is managed exclusively within the UNAI FLOW Web Dashboard.",
        "required_headers": {
            "Content-Type": "application/json",
            "X-API-Key": "wa_live_your_key_here"
        },
        "sample_payload": {
            "to": "+1234567890",
            "message": "Hello from external platform!",
            "message_type": "text"
        },
        "interactive_console": "https://unai-flow-rc39.vercel.app/developer-console"
    }


@router.post("/messages/send", response_model=MessageSendResponse)
async def send_message_unified(
    req: SendMessageRequest,
    ctx: AuthContext = Depends(require_scope("messages:send")),
    header_idempotency: Optional[str] = Header(None, alias="Idempotency-Key")
):
    """
    Direct WhatsApp message dispatcher for external integrations.
    Supports single recipient direct messaging (text, image, video, audio).
    Bulk messaging campaigns via Developer API are disabled (manage campaigns directly in UNAI FLOW Web Dashboard).
    """
    effective_idempotency = header_idempotency or req.idempotency_key
    text_content = (req.message or req.body or req.text or "").strip()

    # 1. Parse and sanitize recipients
    raw_recipients = req.to if isinstance(req.to, list) else [req.to]
    clean_recipients: List[str] = []

    for r in raw_recipients:
        if not r:
            continue
        parts = re.split(r"[\r\n,;]+", str(r).strip())
        for p in parts:
            trimmed = p.strip()
            if not trimmed:
                continue
            if "@" not in trimmed:
                digits = re.sub(r"\D", "", trimmed)
                if digits:
                    clean_recipients.append(digits)
            else:
                clean_recipients.append(trimmed)

    if not clean_recipients:
        raise HTTPException(status_code=422, detail="A valid recipient phone number is required in 'to'.")

    # Guard: Reject bulk messaging requests via Developer API
    if len(clean_recipients) > 1:
        raise HTTPException(
            status_code=403,
            detail="Bulk messaging campaigns via Developer API are disabled. Bulk messaging campaigns can only be created and launched directly from the UNAI FLOW Web Dashboard (/bulk-messaging)."
        )

    # 2. Check message content
    m_type = req.message_type or "text"
    if m_type == "text" and not text_content:
        raise HTTPException(status_code=422, detail="Message text content cannot be blank.")
    if m_type in ["image", "video", "audio"] and not req.media_url:
        raise HTTPException(status_code=422, detail=f"A public 'media_url' is required for {m_type} messages.")

    # Build payload
    payload: Dict[str, Any] = {}
    if m_type == "text":
        payload["body"] = text_content
    else:
        payload["media_url"] = req.media_url
        if req.caption or text_content:
            payload["caption"] = req.caption or text_content

    # Deliver via single publish queue
    target_to = clean_recipients[0]
    try:
        result = await publishing_service.enqueue_post(
            organization_id=ctx.organization_id,
            to=target_to,
            message_type=m_type,
            payload=payload,
            idempotency_key=effective_idempotency
        )
        return MessageSendResponse(
            success=True,
            mode="single",
            status=result.get("status", "queued"),
            message="Direct message queued for delivery to WhatsApp recipient",
            job_id=result.get("job_id"),
            recipient=target_to,
            total_recipients=1,
            idempotency_key=effective_idempotency
        )
    except Exception as err:
        logger.error(f"Failed to enqueue direct message: {err}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(err))


# ─────────────────────────────────────────────────────────────────────────────
# 4. Developer Console Diagnostics & Connection Test
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/applications/{app_id}/test-connection", response_model=ApplicationTestConnectionResponse)
async def test_application_connection(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context)
):
    """
    Executes live diagnostics on an application for the Developer Console UI.
    Verifies application status, API credentials, and WhatsApp mobile connection.
    """
    return application_service.test_application_connection(ctx.organization_id, app_id)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Client Secret Rotation
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/applications/{app_id}/regenerate-secret")
async def regenerate_client_secret(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context)
):
    """
    Rotates the Client Secret for an application.
    Returns the new raw Client Secret once. All previous secrets become invalid.
    """
    raw_secret = application_service.regenerate_client_secret(ctx.organization_id, app_id)
    return {
        "success": True,
        "client_secret": raw_secret,
        "preview": f"unai_sec_••••••••••••{raw_secret[-4:]}",
        "message": "Client Secret rotated successfully. Copy this secret now — it will NEVER be displayed again."
    }
