import httpx
from typing import Dict, Any, List
from .provider import WhatsAppProvider

class BaileysProvider(WhatsAppProvider):
    def __init__(self, endpoint: str = "http://127.0.0.1:3000"):
        self.endpoint = endpoint
        self.client = httpx.AsyncClient(base_url=self.endpoint, timeout=30.0)

    async def connect(self, session_identifier: str) -> Dict[str, Any]:
        response = await self.client.post("/session/start", json={"session_identifier": session_identifier})
        response.raise_for_status()
        return response.json()

    async def disconnect(self, session_identifier: str) -> bool:
        # We can implement a /session/stop endpoint in Node if needed
        return True

    async def get_status(self, session_identifier: str) -> str:
        response = await self.client.get(f"/session/status?session_identifier={session_identifier}")
        response.raise_for_status()
        data = response.json()
        return data.get("status", "DISCONNECTED")

    async def get_pairing_data(self, session_identifier: str) -> Dict[str, Any]:
        response = await self.client.get(f"/session/status?session_identifier={session_identifier}")
        response.raise_for_status()
        data = response.json()
        
        qr = data.get("qr")
        if qr:
            return {"type": "qr", "data": qr}
            
        return {"type": "not_required"}

    async def get_channels(self, session_identifier: str) -> List[Dict[str, Any]]:
        response = await self.client.get(f"/channels?session_identifier={session_identifier}")
        if response.status_code == 400:
            return []
        response.raise_for_status()
        data = response.json()
        return data.get("channels", [])

    async def get_channel(self, session_identifier: str, channel_id: str) -> Dict[str, Any]:
        channels = await self.get_channels(session_identifier)
        for ch in channels:
            if ch["id"] == channel_id:
                return ch
        raise ValueError("Channel not found")

    async def get_channel_permissions(self, session_identifier: str, channel_id: str) -> Dict[str, Any]:
        ch = await self.get_channel(session_identifier, channel_id)
        role = ch.get("role", "GUEST")
        return {
            "can_publish": role in ["ADMIN", "OWNER"],
            "can_edit": role in ["ADMIN", "OWNER"],
            "can_manage": role == "OWNER"
        }

    async def publish_text(self, session_identifier: str, channel_id: str, body: str) -> Dict[str, Any]:
        payload = {
            "session_identifier": session_identifier,
            "channel_id": channel_id,
            "type": "text",
            "body": body
        }
        response = await self.client.post("/channels/publish", json=payload)
        response.raise_for_status()
        return response.json()

    async def publish_image(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        raise NotImplementedError("NOT_SUPPORTED_BY_PROVIDER")

    async def publish_video(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        raise NotImplementedError("NOT_SUPPORTED_BY_PROVIDER")

    async def publish_link(self, session_identifier: str, channel_id: str, url: str, caption: str) -> Dict[str, Any]:
        raise NotImplementedError("NOT_SUPPORTED_BY_PROVIDER")

    async def publish_poll(self, session_identifier: str, channel_id: str, question: str, options: List[str]) -> Dict[str, Any]:
        raise NotImplementedError("NOT_SUPPORTED_BY_PROVIDER")

    async def register_webhook(self) -> bool:
        return True
