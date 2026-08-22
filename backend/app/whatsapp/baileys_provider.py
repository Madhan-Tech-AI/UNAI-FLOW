import httpx
from typing import Dict, Any, List
from .provider import WhatsAppProvider
from app.core.config import settings


class BaileysProvider(WhatsAppProvider):
    """
    Talks to the UNAI WhatsApp Channel API (WCA) service.
    """

    def __init__(self, endpoint: str = None):
        self.endpoint = endpoint or settings.wca_api_url
        self.api_key = getattr(settings, "wca_api_key", "")

    def _headers(self) -> Dict[str, str]:
        """Return auth headers for protected endpoints."""
        h: Dict[str, str] = {}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        return h

    async def _make_request(self, method: str, path: str, timeout: float = 30.0, **kwargs) -> httpx.Response:
        """Helper to make HTTP requests with a fresh client per request."""
        async with httpx.AsyncClient(base_url=self.endpoint, timeout=timeout) as client:
            # Inject auth headers if not already provided
            kwargs.setdefault("headers", {})
            kwargs["headers"].update(self._headers())
            
            response = await client.request(method, path, **kwargs)
            return response

    # ── Connection lifecycle ──

    async def connect(self, session_identifier: str) -> Dict[str, Any]:
        """POST /v1/whatsapp/connect"""
        # Increased timeout to 90s to give WCA Node service enough time for cold start / initial WASocket setup
        response = await self._make_request(
            "POST",
            "/v1/whatsapp/connect",
            timeout=90.0,
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
        """DELETE /v1/whatsapp/{session_identifier}"""
        response = await self._make_request("DELETE", f"/v1/whatsapp/{session_identifier}")
        return response.status_code == 200

    async def get_status(self, session_identifier: str) -> str:
        """GET /v1/whatsapp/{session_identifier}/status"""
        response = await self._make_request("GET", f"/v1/whatsapp/{session_identifier}/status")
        response.raise_for_status()
        return response.json().get("status", "DISCONNECTED")

    async def get_pairing_data(self, session_identifier: str) -> Dict[str, Any]:
        """GET /v1/whatsapp/:connectionId/qr"""
        # Fetch the raw PNG image, not the json format, because frontend expects an image
        response = await self._make_request("GET", f"/v1/whatsapp/{session_identifier}/qr")
        
        if response.status_code == 204:
            # No QR available yet or already connected
            return {"type": "not_required"}
        response.raise_for_status()
        
        # If the response is an image, we base64 encode it
        content_type = response.headers.get("content-type", "")
        if "image" in content_type:
            import base64
            b64_img = base64.b64encode(response.content).decode("utf-8")
            data_uri = f"data:{content_type};base64,{b64_img}"
            return {"type": "qr", "data": data_uri}
            
        # Fallback if it returned JSON for some reason
        try:
            data = response.json()
            if data.get("state") == "connected":
                return {"type": "not_required"}
            qr = data.get("qr")
            if qr:
                return {"type": "qr", "data": qr}
        except Exception:
            pass

        return {"type": "not_required"}

    # ── Channel discovery ──

    async def get_channels(self, session_identifier: str) -> List[Dict[str, Any]]:
        """GET /v1/whatsapp/:connectionId/channels"""
        response = await self._make_request("GET", f"/v1/whatsapp/{session_identifier}/channels")
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
        payload = {"type": "text", "text": body}
        response = await self._make_request("POST", f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish", json=payload)
        response.raise_for_status()
        return response.json()

    async def publish_image(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        payload = {"type": "image", "mediaUrl": media_url, "caption": caption}
        response = await self._make_request("POST", f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish", json=payload)
        response.raise_for_status()
        return response.json()

    async def publish_video(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        payload = {"type": "video", "mediaUrl": media_url, "caption": caption}
        response = await self._make_request("POST", f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish", json=payload)
        response.raise_for_status()
        return response.json()

    async def publish_link(self, session_identifier: str, channel_id: str, url: str, caption: str) -> Dict[str, Any]:
        payload = {"type": "text", "text": f"{caption}\n{url}"}
        response = await self._make_request("POST", f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish", json=payload)
        response.raise_for_status()
        return response.json()

    async def publish_poll(self, session_identifier: str, channel_id: str, question: str, options: List[str]) -> Dict[str, Any]:
        raise NotImplementedError("NOT_SUPPORTED_BY_PROVIDER")

    async def register_webhook(self) -> bool:
        return True
