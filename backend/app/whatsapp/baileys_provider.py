import httpx
from typing import Dict, Any, List
from .provider import WhatsAppProvider
from app.core.config import settings


class BaileysProvider(WhatsAppProvider):
    """
    Talks to the UNAI WhatsApp Channel API (WCA) service.
    Routes are based on the WCA v1 API:
      POST /v1/whatsapp/connect
      GET  /v1/whatsapp/:connectionId/status
      GET  /v1/whatsapp/:connectionId/qr
      GET  /v1/whatsapp/:connectionId/channels
      POST /v1/whatsapp/connections/:connectionId/channels/:channelId/publish
      POST /v1/whatsapp/:connectionId/disconnect
    """

    def __init__(self, endpoint: str = None):
        self.endpoint = endpoint or settings.wca_api_url
        self.api_key = getattr(settings, "wca_api_key", "")
        self.client = httpx.AsyncClient(base_url=self.endpoint, timeout=60.0)

    def _headers(self) -> Dict[str, str]:
        """Return auth headers for protected endpoints."""
        h: Dict[str, str] = {}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        return h

    # ── Connection lifecycle ──

    async def connect(self, session_identifier: str) -> Dict[str, Any]:
        """POST /v1/whatsapp/connect"""
        response = await self.client.post(
            "/v1/whatsapp/connect",
            json={"connection_id": session_identifier},
        )
        response.raise_for_status()
        data = response.json()
        # Normalize: WCA returns {success, connectionId, status, isReady}
        return {
            "status": data.get("status", "INITIALIZING"),
            "connectionId": data.get("connectionId"),
            "isReady": data.get("isReady", False),
        }

    async def disconnect(self, session_identifier: str) -> bool:
        """POST /v1/whatsapp/:connectionId/disconnect"""
        response = await self.client.post(
            f"/v1/whatsapp/{session_identifier}/disconnect",
            headers=self._headers(),
        )
        return response.status_code == 200

    async def get_status(self, session_identifier: str) -> str:
        """GET /v1/whatsapp/:connectionId/status"""
        response = await self.client.get(
            f"/v1/whatsapp/{session_identifier}/status"
        )
        response.raise_for_status()
        data = response.json()
        return data.get("status", "DISCONNECTED")

    async def get_pairing_data(self, session_identifier: str) -> Dict[str, Any]:
        """GET /v1/whatsapp/:connectionId/qr?format=json"""
        response = await self.client.get(
            f"/v1/whatsapp/{session_identifier}/qr",
            params={"format": "json"},
        )
        if response.status_code == 204:
            # No QR available yet or already connected
            return {"type": "not_required"}
        response.raise_for_status()
        data = response.json()

        if data.get("state") == "connected":
            return {"type": "not_required"}

        qr = data.get("qr")
        if qr:
            return {"type": "qr", "data": qr}

        return {"type": "not_required"}

    # ── Channel discovery ──

    async def get_channels(self, session_identifier: str) -> List[Dict[str, Any]]:
        """GET /v1/whatsapp/:connectionId/channels"""
        response = await self.client.get(
            f"/v1/whatsapp/{session_identifier}/channels"
        )
        if response.status_code == 400:
            return []
        response.raise_for_status()
        data = response.json()
        return data.get("channels", [])

    async def get_channel(self, session_identifier: str, channel_id: str) -> Dict[str, Any]:
        channels = await self.get_channels(session_identifier)
        for ch in channels:
            if ch.get("id") == channel_id:
                return ch
        raise ValueError("Channel not found")

    async def get_channel_permissions(self, session_identifier: str, channel_id: str) -> Dict[str, Any]:
        ch = await self.get_channel(session_identifier, channel_id)
        role = ch.get("role", "GUEST")
        return {
            "can_publish": role in ["ADMIN", "OWNER"],
            "can_edit": role in ["ADMIN", "OWNER"],
            "can_manage": role == "OWNER",
        }

    # ── Publishing ──

    async def publish_text(self, session_identifier: str, channel_id: str, body: str) -> Dict[str, Any]:
        """POST /v1/whatsapp/connections/:connectionId/channels/:channelId/publish"""
        payload = {"type": "text", "text": body}
        response = await self.client.post(
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    async def publish_image(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        payload = {"type": "image", "mediaUrl": media_url, "caption": caption}
        response = await self.client.post(
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    async def publish_video(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        payload = {"type": "video", "mediaUrl": media_url, "caption": caption}
        response = await self.client.post(
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    async def publish_link(self, session_identifier: str, channel_id: str, url: str, caption: str) -> Dict[str, Any]:
        payload = {"type": "text", "text": f"{caption}\n{url}"}
        response = await self.client.post(
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json()

    async def publish_poll(self, session_identifier: str, channel_id: str, question: str, options: List[str]) -> Dict[str, Any]:
        raise NotImplementedError("NOT_SUPPORTED_BY_PROVIDER")

    async def register_webhook(self) -> bool:
        return True
