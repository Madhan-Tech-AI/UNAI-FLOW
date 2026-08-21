import os
from fastapi import APIRouter, Depends, HTTPException, Response, Request, UploadFile, File
from typing import Dict, Any, Optional, List
from middleware.auth import verify_jwt
from services.whatsapp_manager import WhatsAppManager
from services.session_manager import SessionManager
from services.publish_queue import PublishQueue
from services.media_manager import MediaManager

router = APIRouter(prefix="/v1/whatsapp", tags=["WhatsApp Gateway"])

# ── 1. Connect Session ──
@router.post("/connect")
async def connect_whatsapp(user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    result = await WhatsAppManager.connect_session(user_id)
    return result

# ── 2. Connection Status ──
@router.get("/status")
@router.get("/{connection_id}/status")
async def get_whatsapp_status(connection_id: Optional[str] = None, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    target_conn_id = connection_id or SessionManager.get_or_create_connection_id(user_id)
    return await WhatsAppManager.get_session_status(target_conn_id)

# ── 3. QR Code Streaming ──
@router.get("/qr")
@router.get("/{connection_id}/qr")
async def get_whatsapp_qr(connection_id: Optional[str] = None, user: Optional[Dict[str, Any]] = None):
    # If connection_id provided, fetch directly, else default
    target_conn_id = connection_id or "default_primary_session"
    qr_bytes = await WhatsAppManager.get_qr_raw(target_conn_id)
    if qr_bytes:
        return Response(
            content=qr_bytes,
            media_type="image/png",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )
    return Response(status_code=204, headers={"Cache-Control": "no-cache, no-store"})

# ── 4. Request Phone OTP Pairing ──
@router.post("/pair")
@router.post("/{connection_id}/pair")
async def pair_whatsapp_phone(body: dict, connection_id: Optional[str] = None, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    phone = body.get("phone", "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number is required")

    target_conn_id = connection_id or SessionManager.get_or_create_connection_id(user_id)
    result = await WhatsAppManager.request_phone_pairing(target_conn_id, phone)
    return result

# ── 5. Discover Channels ──
@router.get("/channels")
@router.get("/{connection_id}/channels")
async def discover_channels(connection_id: Optional[str] = None, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    target_conn_id = connection_id or SessionManager.get_or_create_connection_id(user_id)
    channels = await WhatsAppManager.discover_channels(target_conn_id)
    return {"success": True, "connection_id": target_conn_id, "channels": channels}

# ── 6. Select Channel ──
@router.post("/{connection_id}/select-channel")
@router.post("/select-channel")
async def select_channel(body: dict, connection_id: Optional[str] = None, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    target_conn_id = connection_id or SessionManager.get_or_create_connection_id(user_id)
    channel_id = body.get("channel_id")
    channel_name = body.get("channel_name")
    channel_link = body.get("channel_link", "")
    role = body.get("role", "admin")

    if not channel_id or not channel_name:
        raise HTTPException(status_code=400, detail="channel_id and channel_name are required")

    SessionManager.save_selected_channel(target_conn_id, channel_id, channel_name, channel_link, role)
    return {
        "success": True,
        "connection_id": target_conn_id,
        "selected_channel": {
            "channel_id": channel_id,
            "channel_name": channel_name,
            "channel_link": channel_link,
            "role": role
        }
    }

# ── 7. Direct Publish Endpoint ──
@router.post("/connections/{connection_id}/channels/{channel_id}/publish")
async def publish_message(connection_id: str, channel_id: str, body: dict, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    content = body.get("text") or body.get("caption") or ""
    media_url = body.get("mediaUrl") or body.get("media_url")
    automation_id = body.get("automation_id")
    content_type = body.get("type", "text")

    try:
        result = await PublishQueue.enqueue_and_publish(
            user_id=user_id,
            connection_id=connection_id,
            channel_id=channel_id,
            content=content,
            media_url=media_url,
            automation_id=automation_id,
            content_type=content_type
        )
        return result
    except ValueError as val_err:
        raise HTTPException(status_code=409, detail=str(val_err))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── 8. Media Upload ──
@router.post("/media/upload")
async def upload_media(file: UploadFile = File(...), user: Dict[str, Any] = Depends(verify_jwt)):
    try:
        content = await file.read()
        import base64
        b64_str = f"data:{file.content_type};base64,{base64.b64encode(content).decode()}"
        public_url = MediaManager.upload_base64(b64_str)
        return {"success": True, "media_url": public_url, "mime_type": file.content_type}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# ── 9. Disconnect ──
@router.post("/{connection_id}/disconnect")
@router.post("/disconnect")
async def disconnect_whatsapp(connection_id: Optional[str] = None, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    target_conn_id = connection_id or SessionManager.get_or_create_connection_id(user_id)
    SessionManager.disconnect(target_conn_id)
    return {"success": True, "message": "WhatsApp session disconnected"}
