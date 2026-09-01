import hashlib
import time
import asyncio
import httpx
from typing import Optional, Dict, Any
from fastapi import FastAPI, Header, HTTPException, Response, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from config import config
from services.session_manager import session_manager

app = FastAPI(title="UNAI Flow — WhatsApp Channel API (Python)")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory duplicate post cache: hash -> timestamp
recent_post_hashes: Dict[str, float] = {}

def check_api_key(x_api_key: Optional[str] = Header(None)):
    if not x_api_key or x_api_key != config.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
    return x_api_key

def check_duplicate(content: str, media_url: Optional[str] = None):
    fingerprint = f"{config.CHANNEL_ID}|{content}|{media_url or ''}"
    content_hash = hashlib.sha256(fingerprint.encode()).hexdigest()
    now = time.time()
    expired = [h for h, ts in recent_post_hashes.items() if now - ts > config.DUPLICATE_WINDOW_SEC]
    for h in expired:
        del recent_post_hashes[h]
    if content_hash in recent_post_hashes:
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate post: Identical content was published within the last {config.DUPLICATE_WINDOW_SEC} seconds."
        )
    recent_post_hashes[content_hash] = now

# ── Pydantic Request Models ──

class PublishRequest(BaseModel):
    text: Optional[str] = None
    caption: Optional[str] = None
    mediaUrl: Optional[str] = None
    channelId: Optional[str] = None
    channelLink: Optional[str] = None
    channelName: Optional[str] = None

class ResolveChannelRequest(BaseModel):
    link: Optional[str] = None
    code: Optional[str] = None
    channelId: Optional[str] = None
    channel_link: Optional[str] = None

class ConnectRequest(BaseModel):
    connection_id: Optional[str] = None
    connectionId: Optional[str] = None
    session_identifier: Optional[str] = None

# ── Root & Health Endpoints ──

@app.get("/")
async def root_status():
    return {
        "ok": True,
        "service": "whatsapp-channel-api",
        "status": "healthy",
        "version": "2.0.0",
        "endpoints": {
            "health": "/health",
            "connect": "POST /v1/whatsapp/connect",
            "status": "GET /v1/whatsapp/{connectionId}/status",
            "qr": "GET /v1/whatsapp/{connectionId}/qr",
            "channels": "GET /v1/whatsapp/{connectionId}/channels",
            "resolve": "POST /v1/whatsapp/{connectionId}/channels/resolve",
            "publish": "POST /v1/whatsapp/connections/{connectionId}/channels/{channelId}/publish",
        },
    }

@app.get("/health")
async def health_check():
    return {
        "ok": True,
        "status": "ok",
        "service": "whatsapp-channel-api",
        "version": "2.0.0",
        "active_sessions": len(session_manager.sessions),
    }

# ── Lifecycle Events ──

@app.on_event("shutdown")
async def on_shutdown():
    await session_manager.close_all()

# ── V1 REST API Endpoints ──

@app.post("/v1/whatsapp/connect")
async def v1_connect(req: ConnectRequest):
    cid = req.connection_id or req.connectionId or req.session_identifier or f"sess_{int(time.time())}"
    # Start engine in background so we don't block
    asyncio.create_task(session_manager.start_engine(cid))
    return {
        "success": True,
        "status": "INITIALIZING",
        "connectionId": cid,
        "isReady": False
    }

@app.get("/v1/whatsapp/{connection_id}/status")
async def v1_get_status(connection_id: str):
    engine = session_manager.get(connection_id)
    if not engine:
        return JSONResponse(
            status_code=200,
            content={
                "success": False,
                "connectionId": connection_id,
                "status": "DISCONNECTED",
                "isReady": False,
                "hasQR": False,
                "service": "whatsapp-channel-api-python",
            }
        )
    status = await engine.get_status()
    is_ready = status.get("isReady", False)
    state_str = "CONNECTED" if is_ready else ("QR_READY" if status.get("hasQR") else ("AUTHENTICATING" if status.get("state") == "authenticating" else "INITIALIZING"))
    
    if status.get("state") == "error":
        state_str = "ERROR"

    return JSONResponse(
        status_code=200,
        content={
            "success": is_ready,
            "connectionId": connection_id,
            "status": state_str,
            "isReady": is_ready,
            "hasQR": status.get("hasQR", False),
            "pairingCode": status.get("pairingCode"),
            "userInfo": status.get("userInfo"),
            "whatsapp": status,
            "service": "whatsapp-channel-api-python",
        }
    )

@app.get("/v1/whatsapp/{connection_id}/qr")
async def v1_get_qr(connection_id: str, format: Optional[str] = None):
    engine = session_manager.get(connection_id)
    if not engine:
        return Response(status_code=204)
        
    status = await engine.get_status()
    if status.get("isReady"):
        return {"success": True, "message": "Already connected! No QR code needed.", "state": "connected"}

    if format == "json":
        if not status.get("hasQR"):
            return JSONResponse(
                status_code=200,
                content={"success": False, "state": status.get("state"), "message": "QR generating. Refresh in 2 seconds."}
            )
        return {
            "success": True,
            "qr": engine.current_qr,
            "state": status.get("state"),
        }

    qr_bytes = await engine.get_qr_image()
    if not qr_bytes:
        return Response(status_code=204, headers={"Cache-Control": "no-cache, no-store"})

    return Response(
        content=qr_bytes,
        media_type="image/png",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

@app.get("/v1/whatsapp/{connection_id}/channels")
async def v1_get_channels(connection_id: str):
    engine = session_manager.get(connection_id)
    if not engine:
        # Try to re-create and initialize from persisted session data
        try:
            engine = await session_manager.get_or_create(connection_id)
            if not engine.is_ready:
                await engine.initialize()
                import asyncio
                await asyncio.sleep(3)
        except Exception:
            raise HTTPException(status_code=404, detail="Session not found")
    result = await engine.get_user_channels()
    # Pass through diagnostics from the engine
    return {
        "success": result.get("success", False),
        "connection_id": connection_id,
        "channels": result.get("channels", []),
        "count": len(result.get("channels", [])),
        "source": "whatsapp_web",
        "discovery_status": "completed" if result.get("success") else "failed",
        "diagnostics": result.get("diagnostics", {}),
        "error": result.get("error"),
    }

@app.post("/v1/whatsapp/connections/{connection_id}/channels/{channel_id}/publish")
async def v1_publish(connection_id: str, channel_id: str, req: PublishRequest, _auth: str = Depends(check_api_key)):
    engine = session_manager.get(connection_id)
    if not engine:
        try:
            engine = await session_manager.get_or_create(connection_id)
            # Initialize the engine — this reconnects from persisted session data
            if not engine.is_ready:
                await engine.initialize()
                # Wait briefly for WhatsApp Web to load the existing session
                import asyncio
                await asyncio.sleep(3)
        except Exception as e:
            raise HTTPException(
                status_code=404,
                detail=f"Session not found. Could not reconnect: {str(e)}. Please reconnect your WhatsApp account."
            )
    
    if not engine.is_ready:
        raise HTTPException(
            status_code=400,
            detail="WhatsApp session is not connected. Please scan the QR code to link your WhatsApp account first."
        )

    req.channelId = channel_id
    content = req.caption or req.text or ""
    if not content and not req.mediaUrl:
        raise HTTPException(status_code=400, detail="Provide at least 'text', 'caption', or 'mediaUrl'")

    check_duplicate(content, req.mediaUrl)

    try:
        result = await engine.publish_to_channel(
            text=req.text,
            media_url=req.mediaUrl,
            caption=req.caption,
            channel_id=req.channelId,
            channel_link=req.channelLink,
            channel_name=req.channelName,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/whatsapp/{connection_id}/channels/resolve")
async def v1_resolve_channel(connection_id: str, req: ResolveChannelRequest):
    input_str = req.link or req.code or req.channelId or req.channel_link or ""
    if not input_str:
        raise HTTPException(status_code=400, detail="Provide a channel link or invite code")

    import re
    m = re.search(r'(?:whatsapp\.com/channel/)?([a-zA-Z0-9_-]{15,35})', input_str)
    invite_code = m.group(1) if m else input_str

    engine = session_manager.get(connection_id)

    # Strategy 1: If engine is connected, resolve via Playwright (real metadata)
    if engine and engine.is_ready:
        # First try matching from discovered channels
        channels_res = await engine.get_user_channels()
        channels = channels_res.get("channels", [])
        for ch in channels:
            if ch.get("id") == input_str or ch.get("link") == input_str or invite_code in (ch.get("link") or "") or invite_code in (ch.get("id") or ""):
                return {"success": True, "channel": ch}

        # Try resolving via navigating to the channel in WhatsApp Web
        resolved = await engine.resolve_channel_metadata(input_str)
        if resolved and resolved.get("name") and resolved["name"] != "WhatsApp Channel":
            return {"success": True, "channel": resolved}

    # Strategy 2: Scrape public WhatsApp channel preview page for metadata
    try:
        preview_url = f"https://www.whatsapp.com/channel/{invite_code}"
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(preview_url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            })
            if resp.status_code == 200:
                html = resp.text
                # Extract channel name from og:title or page title
                name_match = re.search(r'<meta\s+property="og:title"\s+content="([^"]+)"', html)
                name = name_match.group(1).strip() if name_match else ""

                # Extract picture from og:image
                pic_match = re.search(r'<meta\s+property="og:image"\s+content="([^"]+)"', html)
                picture_url = pic_match.group(1).strip() if pic_match else ""

                # Extract description from og:description
                desc_match = re.search(r'<meta\s+property="og:description"\s+content="([^"]+)"', html)
                description = desc_match.group(1).strip() if desc_match else ""

                if name and name.lower() not in ("whatsapp", "whatsapp channel"):
                    return {
                        "success": True,
                        "channel": {
                            "id": invite_code,
                            "name": name,
                            "link": f"https://whatsapp.com/channel/{invite_code}",
                            "role": "admin",
                            "subscribers_count": 0,
                            "verified": False,
                            "description": description,
                            "pictureUrl": picture_url,
                        }
                    }
    except Exception:
        pass  # Fall through to basic fallback

    # Strategy 3: Minimal fallback
    return {
        "success": True,
        "channel": {
            "id": invite_code,
            "name": "WhatsApp Channel",
            "link": f"https://whatsapp.com/channel/{invite_code}",
            "role": "admin",
            "subscribers_count": 0,
            "verified": False,
            "description": "",
            "pictureUrl": "",
        }
    }

@app.post("/v1/whatsapp/{connection_id}/disconnect")
@app.delete("/v1/whatsapp/{connection_id}")
async def v1_disconnect(connection_id: str):
    engine = session_manager.get(connection_id)
    if engine:
        await engine.logout_session()
        await session_manager.close(connection_id)
    return {"success": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=False)
