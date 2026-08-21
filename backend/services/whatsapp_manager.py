import os
import httpx
from typing import Dict, Any, Optional, List
from lib.supabase_client import supabase
from services.session_manager import SessionManager
from services.media_manager import MediaManager

class WhatsAppManager:
    """
    UNAI WhatsApp Gateway Client.
    Manages API-driven communication between UNAI Flow Backend and the UNAI WhatsApp Gateway microservice.
    """

    @staticmethod
    def get_gateway_urls() -> List[str]:
        """Returns candidate gateway URLs (local first, then deployed cloud)."""
        urls = ["http://127.0.0.1:3001"]
        cloud_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
        if cloud_url and cloud_url not in urls:
            urls.append(cloud_url)
        return urls

    @staticmethod
    def get_api_key() -> str:
        return os.getenv("WCA_API_KEY", "105eadef-beae-4e08-bcc0-85a06ff80727")

    @staticmethod
    async def connect_session(user_id: str) -> Dict[str, Any]:
        """Initializes a multi-tenant session on the gateway."""
        connection_id = SessionManager.get_or_create_connection_id(user_id)
        api_key = WhatsAppManager.get_api_key()

        for base_url in WhatsAppManager.get_gateway_urls():
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(
                        f"{base_url}/v1/whatsapp/connect",
                        headers={"X-API-Key": api_key},
                        json={"connectionId": connection_id, "user_id": user_id}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        SessionManager.update_connection_status(connection_id, data.get("status", "INITIALIZING"))
                        return {"success": True, "connection_id": connection_id, "status": data.get("status")}
            except Exception:
                continue

        # If gateway is offline, create in DB
        SessionManager.update_connection_status(connection_id, "INITIALIZING")
        return {"success": True, "connection_id": connection_id, "status": "INITIALIZING"}

    @staticmethod
    async def get_session_status(connection_id: str) -> Dict[str, Any]:
        """Queries gateway for live session state and updates DB."""
        api_key = WhatsAppManager.get_api_key()

        for base_url in WhatsAppManager.get_gateway_urls():
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    # 1. Try v1 route
                    resp = await client.get(
                        f"{base_url}/v1/whatsapp/{connection_id}/status",
                        headers={"X-API-Key": api_key}
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        status = data.get("status", "DISCONNECTED")
                        user_info = data.get("userInfo", {})
                        SessionManager.update_connection_status(
                            connection_id=connection_id,
                            status=status,
                            phone_number=user_info.get("phone"),
                            account_name=user_info.get("name")
                        )
                        return data
                    elif resp.status_code == 404:
                        # 2. Fallback to /api/status
                        legacy_resp = await client.get(f"{base_url}/api/status")
                        if legacy_resp.status_code == 200:
                            data = legacy_resp.json()
                            wa = data.get("whatsapp", {})
                            is_ready = wa.get("isReady", False)
                            state_str = "CONNECTED" if is_ready else ("QR_READY" if wa.get("hasQR") else "INITIALIZING")
                            SessionManager.update_connection_status(connection_id=connection_id, status=state_str)
                            return {
                                "success": is_ready,
                                "connectionId": connection_id,
                                "status": state_str,
                                "isReady": is_ready,
                                "hasQR": wa.get("hasQR", False),
                                "pairingCode": wa.get("pairingCode"),
                                "whatsapp": wa
                            }
            except Exception:
                continue

        # Fallback to DB
        conn = supabase.table("whatsapp_connections").select("*").eq("connection_id", connection_id).execute()
        current_status = conn.data[0]["status"] if conn.data else "DISCONNECTED"
        return {
            "success": current_status == "CONNECTED",
            "connectionId": connection_id,
            "status": current_status,
            "isReady": current_status == "CONNECTED",
            "whatsapp": {"state": current_status.lower(), "isReady": current_status == "CONNECTED"}
        }

    @staticmethod
    async def get_qr_raw(connection_id: str) -> Optional[bytes]:
        """Streams QR Code PNG bytes from Gateway."""
        api_key = WhatsAppManager.get_api_key()

        for base_url in WhatsAppManager.get_gateway_urls():
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    resp = await client.get(
                        f"{base_url}/v1/whatsapp/{connection_id}/qr",
                        headers={"X-API-Key": api_key}
                    )
                    if resp.status_code == 200 and len(resp.content) > 50:
                        return resp.content
                    elif resp.status_code == 404:
                        # Fallback to /api/qr
                        resp_legacy = await client.get(f"{base_url}/api/qr")
                        if resp_legacy.status_code == 200 and len(resp_legacy.content) > 50:
                            return resp_legacy.content
            except Exception:
                continue
        return None

    @staticmethod
    async def request_phone_pairing(connection_id: str, phone: str) -> Dict[str, Any]:
        """Triggers 8-digit OTP pairing on Gateway."""
        api_key = WhatsAppManager.get_api_key()

        for base_url in WhatsAppManager.get_gateway_urls():
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.post(
                        f"{base_url}/v1/whatsapp/{connection_id}/pair",
                        headers={"X-API-Key": api_key},
                        json={"phone": phone}
                    )
                    if resp.status_code == 200:
                        return resp.json()
            except Exception:
                continue
        raise Exception("WhatsApp Gateway offline or timed out")

    @staticmethod
    async def discover_channels(connection_id: str) -> List[Dict[str, Any]]:
        """Queries gateway for @newsletter channels and persists to Supabase."""
        api_key = WhatsAppManager.get_api_key()
        discovered: List[Dict[str, Any]] = []

        for base_url in WhatsAppManager.get_gateway_urls():
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.get(
                        f"{base_url}/v1/whatsapp/{connection_id}/channels",
                        headers={"X-API-Key": api_key}
                    )
                    if resp.status_code == 200:
                        channels = resp.json().get("channels", [])
                        for ch in channels:
                            ch_id = ch.get("id")
                            if ch_id:
                                discovered.append({
                                    "id": ch_id,
                                    "name": ch.get("name") or "WhatsApp Channel",
                                    "link": ch.get("link", f"https://whatsapp.com/channel/{ch_id.split('@')[0]}"),
                                    "role": ch.get("role", "admin"),
                                    "subscribers_count": ch.get("subscribers_count", 0),
                                    "verified": ch.get("verified", False)
                                })
                        break
            except Exception:
                continue

        # If gateway discovered channels, cache in Supabase
        if discovered:
            for ch in discovered:
                try:
                    supabase.table("whatsapp_channels").upsert({
                        "connection_id": connection_id,
                        "channel_id": ch["id"],
                        "channel_name": ch["name"],
                        "channel_link": ch["link"],
                        "role": ch["role"],
                        "subscribers_count": ch["subscribers_count"],
                        "verified": ch["verified"]
                    }, on_conflict="connection_id,channel_id").execute()
                except Exception:
                    pass

        # Also merge with already saved channels in Supabase
        db_res = supabase.table("whatsapp_channels").select("*").eq("connection_id", connection_id).execute()
        if db_res.data:
            seen = {d["id"] for d in discovered}
            for d in db_res.data:
                if d["channel_id"] not in seen:
                    discovered.append({
                        "id": d["channel_id"],
                        "name": d["channel_name"],
                        "link": d.get("channel_link", ""),
                        "role": d.get("role", "admin"),
                        "selected": d.get("selected", False)
                    })

        return discovered

    @staticmethod
    async def publish_to_channel(
        connection_id: str,
        channel_id: str,
        text: Optional[str] = None,
        caption: Optional[str] = None,
        media_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """Publishes content to target WhatsApp Channel via Gateway WebSocket."""
        api_key = WhatsAppManager.get_api_key()
        resolved_media_url = MediaManager.get_public_url(media_url) if media_url else None

        payload = {
            "type": "image" if resolved_media_url and not any(x in (resolved_media_url or "") for x in [".mp4", ".mov"]) else "video" if any(x in (resolved_media_url or "") for x in [".mp4", ".mov"]) else "text",
            "text": text or "",
            "caption": caption or text or "",
            "mediaUrl": resolved_media_url
        }

        for base_url in WhatsAppManager.get_gateway_urls():
            try:
                async with httpx.AsyncClient(timeout=45.0) as client:
                    resp = await client.post(
                        f"{base_url}/v1/whatsapp/connections/{connection_id}/channels/{channel_id}/publish",
                        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
                        json=payload
                    )
                    if resp.status_code == 200:
                        return resp.json()
                    elif resp.status_code in [400, 401, 500]:
                        err_detail = resp.json().get("error") or resp.text
                        raise Exception(err_detail)
            except httpx.ConnectError:
                continue

        raise Exception("UNAI WhatsApp Gateway service unreachable. Please ensure gateway is running.")
