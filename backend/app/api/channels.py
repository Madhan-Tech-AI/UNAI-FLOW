from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from app.api.auth import get_current_user_id
from app.whatsapp.channel_manager import ChannelManager
from app.whatsapp.whatsapp_web_provider import WhatsAppWebProvider
from app.whatsapp.publisher import Publisher
from app.core.config import settings
import logging
import httpx
import re

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
    channel_jid: str  # The @newsletter JID or invite code
    type: str = "text"
    text: Optional[str] = None
    caption: Optional[str] = None
    media_url: Optional[str] = None
    channel_name: Optional[str] = None
    channel_link: Optional[str] = None


@router.get("")
async def get_channels(user_id: str = Depends(get_current_user_id)):
    channels = channel_manager.get_user_channels(user_id)
    return {"success": True, "data": channels}


@router.get("/user-channels")
async def get_user_connected_channels(user_id: str = Depends(get_current_user_id)):
    """
    Get all channels from the user's CONNECTED WhatsApp sessions.
    Used by the New Automation page for channel selection.
    """
    channels = channel_manager.get_connected_channels(user_id)
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
    Goes to the gateway to list newsletters, then persists them to DB.
    """
    logger.info(f"[WA] CHANNELS_DISCOVER session_id={session_identifier}")
    try:
        channels = await provider.get_channels(session_identifier)
        logger.info(f"[WA] CHANNELS_DISCOVERED session_id={session_identifier} count={len(channels)}")

        # Also persist to DB for subsequent loads
        if channels:
            try:
                await channel_manager.sync_channels(user_id, session_identifier)
            except Exception as sync_err:
                logger.warning(f"[WA] CHANNELS_PERSIST_FAILED error={sync_err}")

        return {"success": True, "data": channels}
    except Exception as e:
        logger.error(f"[WA] CHANNELS_DISCOVER_FAILED session_id={session_identifier} error={e}")
        # Fallback: return persisted channels from DB
        try:
            db_channels = channel_manager.get_user_channels(user_id)
            if db_channels:
                logger.info(f"[WA] CHANNELS_FALLBACK_DB count={len(db_channels)}")
                return {"success": True, "data": db_channels, "source": "cache"}
        except Exception:
            pass
        return {"success": False, "data": [], "error": str(e)}


@router.post("/resolve")
async def resolve_channel(req: ResolveChannelRequest, user_id: str = Depends(get_current_user_id)):
    """
    Resolves a specific WhatsApp Channel by invite link or code (e.g. https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M).
    Extracts the official JID, title, description, subscriber count, and admin/owner role.
    Falls back to URL-based extraction if the socket resolution fails.
    """

    logger.info(f"[WA] CHANNEL_RESOLVE_REQUEST session_id={req.session_identifier} input={req.link_or_code}")
    channel = await provider.resolve_channel(req.session_identifier, req.link_or_code)

    if not channel:
        # Fallback: extract invite code from URL and try scraping public preview
        raw = (req.link_or_code or "").strip()
        m = re.search(r'(?:whatsapp\.com/channel/)?([a-zA-Z0-9_-]{15,35})', raw)
        invite_code = m.group(1) if m else raw

        if not invite_code or len(invite_code) < 10:
            raise HTTPException(
                status_code=404,
                detail="Could not resolve WhatsApp channel from the provided link or invite code. Please verify the URL."
            )

        # Try scraping public WhatsApp channel preview page for real metadata
        try:
            preview_url = f"https://www.whatsapp.com/channel/{invite_code}"
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                resp = await client.get(preview_url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                })
                if resp.status_code == 200:
                    html = resp.text
                    name_match = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html)
                    name = name_match.group(1).strip() if name_match else ""

                    pic_match = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', html)
                    picture_url = pic_match.group(1).strip() if pic_match else ""

                    desc_match = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', html)
                    description = desc_match.group(1).strip() if desc_match else ""

                    if name and name.lower() not in ("whatsapp", "whatsapp channel"):
                        logger.info(f"[WA] CHANNEL_RESOLVE_PUBLIC_PREVIEW invite_code={invite_code} name={name}")
                        channel = {
                            "id": invite_code,
                            "name": name,
                            "link": f"https://whatsapp.com/channel/{invite_code}",
                            "role": "admin",
                            "subscribers_count": 0,
                            "verified": False,
                            "description": description,
                            "pictureUrl": picture_url,
                        }
        except Exception as e:
            logger.warning(f"[WA] CHANNEL_RESOLVE_PUBLIC_PREVIEW_FAILED invite_code={invite_code} error={e}")

        if not channel:
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

    # Persist the resolved channel to database (whatsapp_channels & channels tables)
    if channel:
        try:
            channel_manager.save_resolved_channel(user_id, req.session_identifier, channel)
        except Exception as save_err:
            logger.warning(f"[WA] CHANNEL_PERSIST_ON_RESOLVE_FAILED error={save_err}")

    # Sanitize picture URL — WhatsApp CDN URLs (mmg.whatsapp.net) return 403 in browsers
    if channel and channel.get("pictureUrl"):
        pic_url = channel["pictureUrl"]
        if "mmg.whatsapp.net" in pic_url or "pps.whatsapp.net" in pic_url:
            # Route through our proxy endpoint
            import urllib.parse
            channel["pictureUrl"] = f"/api/channels/picture-proxy?url={urllib.parse.quote(pic_url, safe='')}"

    return {"success": True, "data": channel}


@router.get("/picture-proxy")
async def picture_proxy(url: str):
    """
    Proxy for WhatsApp CDN profile pictures that return 403 when loaded directly in browsers.
    Fetches the image server-side and returns it.
    """
    if not url:
        raise HTTPException(status_code=400, detail="Missing url parameter")

    # Only allow proxying WhatsApp CDN URLs for security
    allowed_domains = ["mmg.whatsapp.net", "pps.whatsapp.net", "web.whatsapp.com"]
    from urllib.parse import urlparse
    parsed = urlparse(url)
    if not any(domain in (parsed.hostname or "") for domain in allowed_domains):
        raise HTTPException(status_code=403, detail="Only WhatsApp CDN URLs can be proxied")

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to fetch image")

            from fastapi.responses import Response
            content_type = resp.headers.get("content-type", "image/jpeg")
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={"Cache-Control": "public, max-age=86400"}
            )
    except httpx.HTTPError as e:
        logger.warning(f"[WA] PICTURE_PROXY_FAILED url={url[:50]} error={e}")
        raise HTTPException(status_code=502, detail="Failed to fetch image from WhatsApp CDN")


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
        ch_name = req.channel_name or ""
        ch_link = req.channel_link or ""

        if req.type == "text":
            result = await provider.publish_text(
                req.session_identifier, req.channel_jid, body,
                channel_name=ch_name, channel_link=ch_link
            )
        elif req.type == "image" and req.media_url:
            result = await provider.publish_image(
                req.session_identifier, req.channel_jid, req.media_url, req.caption or "",
                channel_name=ch_name, channel_link=ch_link
            )
        elif req.type == "video" and req.media_url:
            result = await provider.publish_video(
                req.session_identifier, req.channel_jid, req.media_url, req.caption or "",
                channel_name=ch_name, channel_link=ch_link
            )
        else:
            result = await provider.publish_text(
                req.session_identifier, req.channel_jid, body,
                channel_name=ch_name, channel_link=ch_link
            )

        logger.info(
            f"[WA] PUBLISH_DIRECT_SUCCESS session_id={req.session_identifier} "
            f"result={result.get('postId', 'unknown')}"
        )
        return {"success": True, "data": result}
    except Exception as e:
        logger.error(f"[WA] PUBLISH_DIRECT_FAILED error={e}")
        raise HTTPException(status_code=500, detail=str(e))
