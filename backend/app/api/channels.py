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


class AuthorizeAccountRequest(BaseModel):
    session_identifier: str
    channel_link_or_code: Optional[str] = None


@router.post("/authorize")
async def authorize_account(req: AuthorizeAccountRequest, user_id: str = Depends(get_current_user_id)):
    """
    Authorize connected WhatsApp account, configure permissions, and fetch channels.
    If an optional channel link or invite code is provided, resolves and verifies ownership.
    """
    logger.info(f"[WA] ACCOUNT_AUTHORIZE_REQUEST session_id={req.session_identifier} link={req.channel_link_or_code}")

    resolved_channel = None
    if req.channel_link_or_code and req.channel_link_or_code.strip():
        try:
            resolved = await provider.resolve_channel(req.session_identifier, req.channel_link_or_code.strip())
            if resolved:
                channel_manager.save_resolved_channel(user_id, req.session_identifier, resolved)
                resolved_channel = resolved
        except Exception as res_err:
            logger.warning(f"[WA] RESOLVE_ON_AUTHORIZE_WARNING error={res_err}")

    # Discover all channels accessible to this socket
    try:
        channels = await provider.get_channels(req.session_identifier)
        if channels:
            await channel_manager.sync_channels(user_id, req.session_identifier)
    except Exception as disc_err:
        logger.warning(f"[WA] DISCOVER_ON_AUTHORIZE_WARNING error={disc_err}")

    db_channels = channel_manager.get_user_channels(user_id)
    return {
        "success": True,
        "authorized": True,
        "resolved_channel": resolved_channel,
        "data": db_channels,
    }


@router.get("/discover")
async def discover_channels(session_identifier: str, user_id: str = Depends(get_current_user_id)):
    """
    Discover WhatsApp Channels/Newsletters from the connected WhatsApp account.
    Returns diagnostics alongside channels for debugging.
    """
    logger.info(f"[WA] CHANNELS_DISCOVER session_id={session_identifier}")
    try:
        channels = await provider.get_channels(session_identifier)
        logger.info(f"[WA] CHANNELS_DISCOVERED session_id={session_identifier} count={len(channels)}")

        # Persist authorized channels to DB
        if channels:
            try:
                await channel_manager.sync_channels(user_id, session_identifier)
            except Exception as sync_err:
                logger.warning(f"[WA] CHANNELS_PERSIST_FAILED error={sync_err}")

        db_channels = channel_manager.get_user_channels(user_id)
        return {
            "success": True,
            "data": db_channels or channels,
            "count": len(db_channels or channels),
            "discovery_status": "completed",
        }
    except Exception as e:
        logger.error(f"[WA] CHANNELS_DISCOVER_FAILED session_id={session_identifier} error={e}")
        # Fallback: return persisted channels from DB
        try:
            db_channels = channel_manager.get_user_channels(user_id)
            if db_channels:
                return {
                    "success": True,
                    "data": db_channels,
                    "count": len(db_channels),
                    "source": "cache",
                    "discovery_status": "cached_fallback",
                }
        except Exception:
            pass
        return {
            "success": False,
            "data": [],
            "count": 0,
            "error": str(e),
            "discovery_status": "failed",
        }


class ResolveChannelRequest(BaseModel):
    session_identifier: str
    channel_link: str


@router.post("/resolve")
async def resolve_channel(req: ResolveChannelRequest, user_id: str = Depends(get_current_user_id)):
    """
    Resolve a WhatsApp Channel by its invite link or code.
    Returns channel metadata + verification_required flag.
    """
    logger.info(f"[WA] RESOLVE_CHANNEL session_id={req.session_identifier} link={req.channel_link}")

    link = req.channel_link.strip()
    if not link:
        raise HTTPException(status_code=400, detail="Channel link is required")

    # Validate URL format
    invite_match = re.search(r'(?:whatsapp\.com/channel/)?([a-zA-Z0-9_-]{10,50})', link)
    if not invite_match:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_CHANNEL_LINK",
            "message": "Please provide a valid WhatsApp Channel link (e.g., https://whatsapp.com/channel/...)"
        })

    invite_code = invite_match.group(1)

    try:
        # Try resolving via the WCA gateway
        resolved = await provider.resolve_channel(req.session_identifier, link)

        if resolved:
            # Check if this channel is already in the user's discovered channels
            user_channels = channel_manager.get_user_channels(user_id)
            already_discovered = any(
                c.get("id") == invite_code or
                c.get("channel_id") == invite_code or
                invite_code in (c.get("link") or "") or
                (resolved.get("id") and c.get("id") == resolved.get("id"))
                for c in user_channels
            )

            # If already discovered with admin/owner role, auto-verify
            auto_verified = False
            if already_discovered:
                matching = [c for c in user_channels if
                            c.get("id") == invite_code or
                            c.get("channel_id") == invite_code or
                            invite_code in (c.get("link") or "")]
                if matching and matching[0].get("can_publish"):
                    auto_verified = True

            return {
                "success": True,
                "channel": resolved,
                "already_discovered": already_discovered,
                "auto_verified": auto_verified,
                "verification_required": not auto_verified,
                "verification_method": "session_admin_access" if auto_verified else "admin_panel_check",
            }
        else:
            return {
                "success": False,
                "error": "Could not resolve channel. Ensure the link is correct and the channel is public.",
                "channel": None,
            }
    except Exception as e:
        logger.error(f"[WA] RESOLVE_CHANNEL_FAILED error={e}")
        raise HTTPException(status_code=500, detail={
            "code": "RESOLVE_FAILED",
            "message": str(e)
        })


class VerifyStartRequest(BaseModel):
    session_identifier: str
    channel_id: str
    channel_link: Optional[str] = None


@router.post("/verify/start")
async def verify_channel_ownership(req: VerifyStartRequest, user_id: str = Depends(get_current_user_id)):
    """
    Verify ownership of a WhatsApp Channel.
    Uses the strongest available verification: checks if the authenticated
    WhatsApp session can access the channel's admin/management controls.
    """
    logger.info(f"[WA] VERIFY_START session_id={req.session_identifier} channel_id={req.channel_id}")

    # Step 1: Check if channel is in user's discovered admin channels
    user_channels = channel_manager.get_user_channels(user_id)
    matching = [c for c in user_channels if
                c.get("id") == req.channel_id or
                c.get("channel_id") == req.channel_id]

    if matching:
        ch = matching[0]
        if ch.get("can_publish") or ch.get("is_admin") or ch.get("is_owned"):
            # Auto-verified: the authenticated session already proved ownership
            logger.info(f"[WA] VERIFY_AUTO_PASS channel_id={req.channel_id} method=session_discovery")
            return {
                "success": True,
                "verified": True,
                "verification_method": "session_admin_access",
                "message": "Channel ownership verified via your authenticated WhatsApp session.",
                "channel_id": req.channel_id,
            }

    # Step 2: Try to verify by navigating to the channel and checking for admin controls
    try:
        channels = await provider.get_channels(req.session_identifier)
        for ch in channels:
            ch_id = ch.get("id") or ch.get("channel_id", "")
            if ch_id == req.channel_id or req.channel_id in (ch.get("link") or ""):
                if ch.get("can_publish") or ch.get("is_admin") or ch.get("is_owned"):
                    # Save the verified channel
                    channel_manager.save_resolved_channel(user_id, req.session_identifier, ch)
                    return {
                        "success": True,
                        "verified": True,
                        "verification_method": "rediscovery_admin_check",
                        "message": "Channel ownership confirmed through admin access detection.",
                        "channel_id": req.channel_id,
                    }
    except Exception as disc_err:
        logger.warning(f"[WA] VERIFY_REDISCOVERY_FAILED error={disc_err}")

    # Step 3: Cannot verify — the session does not have admin access
    return {
        "success": True,
        "verified": False,
        "verification_method": "none",
        "message": (
            "Unable to verify ownership. Your authenticated WhatsApp account does not appear "
            "to have admin or owner access to this channel. Only channels where you are an "
            "admin or owner can be linked for publishing."
        ),
        "channel_id": req.channel_id,
    }


class VerifyConfirmRequest(BaseModel):
    session_identifier: str
    channel_id: str


@router.post("/verify/confirm")
async def confirm_channel_link(req: VerifyConfirmRequest, user_id: str = Depends(get_current_user_id)):
    """
    Confirm and finalize linking a verified channel to the user's account.
    """
    logger.info(f"[WA] VERIFY_CONFIRM session_id={req.session_identifier} channel_id={req.channel_id}")

    # Ensure channel is verified (exists in user's publishable channels)
    user_channels = channel_manager.get_user_channels(user_id)
    matching = [c for c in user_channels if
                c.get("id") == req.channel_id or
                c.get("channel_id") == req.channel_id]

    if not matching:
        raise HTTPException(status_code=404, detail={
            "code": "CHANNEL_NOT_FOUND",
            "message": "Channel not found in your account. Please discover or resolve it first."
        })

    ch = matching[0]
    if not (ch.get("can_publish") or ch.get("is_admin") or ch.get("is_owned")):
        raise HTTPException(status_code=403, detail={
            "code": "OWNERSHIP_NOT_VERIFIED",
            "message": "Channel ownership has not been verified. Only admin/owner channels can be linked."
        })

    # Mark as selected
    try:
        channel_manager.select_channel(user_id, req.channel_id)
    except Exception:
        pass

    return {
        "success": True,
        "linked": True,
        "channel_id": req.channel_id,
        "channel_name": ch.get("name", "WhatsApp Channel"),
        "message": "Channel successfully linked to your UNAI Flow account.",
    }


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
