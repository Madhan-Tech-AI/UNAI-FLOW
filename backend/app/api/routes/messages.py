from fastapi import APIRouter, Depends, Header
from typing import Optional
from app.api.dependencies import get_auth_context, AuthContext, require_scope
from app.schemas.message import (
    TextMessageRequest,
    ImageMessageRequest,
    VideoMessageRequest,
    AudioMessageRequest,
    PollMessageRequest,
    MessagePublishResponse
)
from app.services.publishing_service import publishing_service

router = APIRouter(prefix="/v1/messages", tags=["Messages & Publishing"])

@router.post("/text", response_model=MessagePublishResponse)
async def publish_text_message(
    req: TextMessageRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    ctx: AuthContext = Depends(require_scope("messages:send"))
):
    """Publish a text broadcast message to a WhatsApp Channel."""
    result = await publishing_service.enqueue_post(
        organization_id=ctx.organization_id,
        to=req.to,
        message_type="text",
        payload={"body": req.body},
        instance_id=req.instance_id,
        idempotency_key=idempotency_key
    )
    return MessagePublishResponse(
        success=True,
        job_id=result["job_id"],
        status=result["status"],
        idempotency_key=result.get("idempotency_key"),
        message="Text message queued and published to WhatsApp Channel"
    )

@router.post("/image", response_model=MessagePublishResponse)
async def publish_image_message(
    req: ImageMessageRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    ctx: AuthContext = Depends(require_scope("messages:send"))
):
    """Publish an image with optional caption to a WhatsApp Channel."""
    result = await publishing_service.enqueue_post(
        organization_id=ctx.organization_id,
        to=req.to,
        message_type="image",
        payload={"media_url": req.media_url, "caption": req.caption},
        instance_id=req.instance_id,
        idempotency_key=idempotency_key
    )
    return MessagePublishResponse(
        success=True,
        job_id=result["job_id"],
        status=result["status"],
        idempotency_key=result.get("idempotency_key"),
        message="Image message queued and published to WhatsApp Channel"
    )

@router.post("/video", response_model=MessagePublishResponse)
async def publish_video_message(
    req: VideoMessageRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    ctx: AuthContext = Depends(require_scope("messages:send"))
):
    """Publish a video broadcast with caption to a WhatsApp Channel."""
    result = await publishing_service.enqueue_post(
        organization_id=ctx.organization_id,
        to=req.to,
        message_type="video",
        payload={"media_url": req.media_url, "caption": req.caption},
        instance_id=req.instance_id,
        idempotency_key=idempotency_key
    )
    return MessagePublishResponse(
        success=True,
        job_id=result["job_id"],
        status=result["status"],
        idempotency_key=result.get("idempotency_key"),
        message="Video message queued and published to WhatsApp Channel"
    )

@router.post("/audio", response_model=MessagePublishResponse)
async def publish_audio_message(
    req: AudioMessageRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    ctx: AuthContext = Depends(require_scope("messages:send"))
):
    """Publish an audio clip / voice message to a WhatsApp Channel."""
    result = await publishing_service.enqueue_post(
        organization_id=ctx.organization_id,
        to=req.to,
        message_type="audio",
        payload={"media_url": req.media_url},
        instance_id=req.instance_id,
        idempotency_key=idempotency_key
    )
    return MessagePublishResponse(
        success=True,
        job_id=result["job_id"],
        status=result["status"],
        idempotency_key=result.get("idempotency_key"),
        message="Audio message queued and published to WhatsApp Channel"
    )

@router.post("/poll", response_model=MessagePublishResponse)
async def publish_poll_message(
    req: PollMessageRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    ctx: AuthContext = Depends(require_scope("messages:send"))
):
    """Publish an interactive poll to a WhatsApp Channel."""
    result = await publishing_service.enqueue_post(
        organization_id=ctx.organization_id,
        to=req.to,
        message_type="poll",
        payload={
            "question": req.question,
            "options": req.options,
            "selectable_count": req.selectable_count
        },
        instance_id=req.instance_id,
        idempotency_key=idempotency_key
    )
    return MessagePublishResponse(
        success=True,
        job_id=result["job_id"],
        status=result["status"],
        idempotency_key=result.get("idempotency_key"),
        message="Poll queued and published to WhatsApp Channel"
    )
