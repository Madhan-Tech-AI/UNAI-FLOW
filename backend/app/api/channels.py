from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from app.api.auth import get_current_user_id
from app.whatsapp.channel_manager import ChannelManager
from app.whatsapp.whatsapp_web_provider import WhatsAppWebProvider
from app.whatsapp.publisher import Publisher
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/channels", tags=["Channels"])

# Initialize provider and manager
provider = WhatsAppWebProvider()
channel_manager = ChannelManager(provider=provider)
publisher = Publisher()


class SyncRequest(BaseModel):
    session_identifier: str


class PublishRequest(BaseModel):
    session_identifier: str
    channel_id: str
    type: str = "text"  # text, image, video
    text: Optional[str] = None
    caption: Optional[str] = None
    media_url: Optional[str] = None


class DirectPublishRequest(BaseModel):
    session_identifier: str
    channel_jid: str  # The @newsletter JID
    type: str = "text"
    text: Optional[str] = None
    caption: Optional[str] = None
    media_url: Optional[str] = None


@router.get("")
async def get_channels(user_id: str = Depends(get_current_user_id)):
    channels = channel_manager.get_user_channels(user_id)
    return {"success": True, "data": channels}


@router.post("/sync")
async def sync_channels(req: SyncRequest, user_id: str = Depends(get_current_user_id)):
    result = await channel_manager.sync_channels(user_id, req.session_identifier)
    if not result["success"]:
        code = result.get("code", "SYNC_ERROR")
        raise HTTPException(status_code=400, detail={"code": code, "message": result.get("error")})
    return {"success": True, "data": result["channels"]}


@router.post("/{channel_id}/select")
async def select_channel(channel_id: str, user_id: str = Depends(get_current_user_id)):
    try:
        success = channel_manager.select_channel(user_id, channel_id)
        if not success:
            raise ValueError("Failed to update selection")
        return {"success": True}
    except ValueError as e:
        raise HTTPException(status_code=404, detail={"code": "CHANNEL_NOT_FOUND", "message": str(e)})


class ResolveChannelRequest(BaseModel):
    session_identifier: str
    link_or_code: str


@router.get("/discover")
async def discover_channels(session_identifier: str, user_id: str = Depends(get_current_user_id)):
    """
    Discover WhatsApp Channels/Newsletters from the connected WhatsApp account.
    Goes directly to the gateway to list newsletters.
    """
    logger.info(f"[WA] CHANNELS_DISCOVER session_id={session_identifier}")
    try:
        channels = await provider.get_channels(session_identifier)
        logger.info(f"[WA] CHANNELS_DISCOVERED session_id={session_identifier} count={len(channels)}")
        return {"success": True, "data": channels}
    except Exception as e:
        logger.error(f"[WA] CHANNELS_DISCOVER_FAILED session_id={session_identifier} error={e}")
        return {"success": False, "data": [], "error": str(e)}


@router.post("/resolve")
async def resolve_channel(req: ResolveChannelRequest, user_id: str = Depends(get_current_user_id)):
    """
    Resolves a specific WhatsApp Channel by invite link or code (e.g. https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M).
    Extracts the official JID, title, description, subscriber count, and admin/owner role.
    Falls back to URL-based extraction if the socket resolution fails.
    """
    import re

    logger.info(f"[WA] CHANNEL_RESOLVE_REQUEST session_id={req.session_identifier} input={req.link_or_code}")
    channel = await provider.resolve_channel(req.session_identifier, req.link_or_code)

    if not channel:
        # Fallback: extract invite code from URL and return a basic channel object
        raw = (req.link_or_code or "").strip()
        m = re.search(r'(?:whatsapp\.com/channel/)?([a-zA-Z0-9_-]{15,35})', raw)
        invite_code = m.group(1) if m else raw

        if invite_code and len(invite_code) >= 10:
            logger.info(f"[WA] CHANNEL_RESOLVE_FALLBACK session_id={req.session_identifier} invite_code={invite_code}")
            channel = {
                "id": invite_code,
                "name": "WhatsApp Channel",
                "link": f"https://whatsapp.com/channel/{invite_code}",
                "role": "admin",
                "subscribers_count": 0,
                "verified": False,
                "description": "",
                "pictureUrl": "",
            }
        else:
            raise HTTPException(
                status_code=404,
                detail="Could not resolve WhatsApp channel from the provided link or invite code. Please verify the URL."
            )

    return {"success": True, "data": channel}


@router.post("/publish")
async def publish_to_channel(req: PublishRequest, user_id: str = Depends(get_current_user_id)):
    """
    Enqueue a publish job. The PublishingWorker will process it asynchronously.
    """
    payload: Dict[str, Any] = {}
    if req.type == "text":
        payload["body"] = req.text or req.caption or ""
    elif req.type == "image":
        payload["media_url"] = req.media_url or ""
        payload["caption"] = req.caption or ""
    elif req.type == "video":
        payload["media_url"] = req.media_url or ""
        payload["caption"] = req.caption or ""

    result = publisher.enqueue_job(
        user_id=user_id,
        channel_id=req.channel_id,
        post_type=req.type,
        payload=payload,
    )
    return {"success": True, "data": result}


@router.post("/publish-direct")
async def publish_direct(req: DirectPublishRequest, user_id: str = Depends(get_current_user_id)):
    """
    Publish directly to a WhatsApp Channel via the gateway (bypasses job queue).
    Use for immediate publishing.
    """
    logger.info(
        f"[WA] PUBLISH_DIRECT session_id={req.session_identifier} "
        f"channel_jid={req.channel_jid} type={req.type}"
    )
    try:
        body = req.text or req.caption or ""

        if req.type == "text":
            result = await provider.publish_text(req.session_identifier, req.channel_jid, body)
        elif req.type == "image" and req.media_url:
            result = await provider.publish_image(
                req.session_identifier, req.channel_jid, req.media_url, req.caption or ""
            )
        elif req.type == "video" and req.media_url:
            result = await provider.publish_video(
                req.session_identifier, req.channel_jid, req.media_url, req.caption or ""
            )
        else:
            result = await provider.publish_text(req.session_identifier, req.channel_jid, body)

        logger.info(
            f"[WA] PUBLISH_DIRECT_SUCCESS session_id={req.session_identifier} "
            f"result={result.get('postId', 'unknown')}"
        )
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"[WA] PUBLISH_DIRECT_FAILED error={e}")
        raise HTTPException(status_code=500, detail=str(e))
