import asyncio
import httpx
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
from app.providers.whatsapp.base import WhatsAppProvider
from app.providers.whatsapp.models import (
    ProviderQR,
    ProviderStatus,
    ProviderChannel,
    ProviderMessageResult
)
from app.core.config import settings
from app.core.exceptions import (
    WhatsAppSessionException,
    MessageSendFailedException,
    RateLimitedException
)
from app.core.logging import logger

class WhatsAppWebSessionProvider(WhatsAppProvider):
    """
    Production WhatsApp Web / Linked Device Provider.
    Interfaces with the isolated stateful WhatsApp Channel Engine daemon (FastAPI/Playwright/Baileys).
    """
    def __init__(self, endpoint: Optional[str] = None, api_key: Optional[str] = None):
        self.endpoint = (endpoint or settings.wca_api_url).rstrip("/")
        self.api_key = api_key or settings.wca_api_key

    def _headers(self) -> Dict[str, str]:
        headers = {}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    async def _request(self, method: str, path: str, timeout: float = 30.0, **kwargs) -> httpx.Response:
        url = f"{self.endpoint}{path}"
        headers = self._headers()
        if "headers" in kwargs:
            headers.update(kwargs.pop("headers"))
            
        delays = [2, 4, 8]
        last_exc = None
        
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.request(method, url, headers=headers, **kwargs)
                    if resp.status_code == 429:
                        retry_after = resp.headers.get("Retry-After")
                        sleep_s = int(retry_after) if retry_after and retry_after.isdigit() else delays[attempt]
                        logger.warning(f"WCA 429 rate limit hit, backoff {sleep_s}s (attempt {attempt+1})")
                        await asyncio.sleep(sleep_s)
                        continue
                    resp.raise_for_status()
                    return resp
            except httpx.HTTPStatusError as e:
                last_exc = e
                if e.response.status_code in [502, 503, 504] and attempt < 2:
                    await asyncio.sleep(delays[attempt])
                    continue
                break
            except (httpx.ConnectError, httpx.ReadTimeout) as e:
                last_exc = e
                if attempt < 2:
                    await asyncio.sleep(delays[attempt])
                    continue
                break
                
        raise WhatsAppSessionException(f"WhatsApp session engine communication failed: {str(last_exc)}")

    async def create_instance(self, instance_id: str) -> Dict[str, Any]:
        return {"instance_id": instance_id, "status": "INITIALIZING"}

    async def connect(self, instance_id: str) -> ProviderStatus:
        resp = await self._request("POST", "/v1/whatsapp/connect", json={"connection_id": instance_id}, timeout=60.0)
        data = resp.json()
        raw_status = data.get("status", "INITIALIZING")
        is_ready = raw_status in ["CONNECTED", "AUTHENTICATED"]
        return ProviderStatus(status=raw_status, is_ready=is_ready)

    async def get_qr(self, instance_id: str) -> Optional[ProviderQR]:
        try:
            resp = await self._request("GET", f"/v1/whatsapp/{instance_id}/pairing", timeout=15.0)
            data = resp.json()
            qr_data = data.get("pairing") or data.get("qr")
            if qr_data:
                return ProviderQR(
                    qr_data=qr_data,
                    expires_at=datetime.now(timezone.utc) + timedelta(seconds=60)
                )
        except Exception:
            pass
        return None

    async def get_connection_status(self, instance_id: str) -> ProviderStatus:
        try:
            resp = await self._request("GET", f"/v1/whatsapp/{instance_id}/status", timeout=15.0)
            data = resp.json()
            raw_status = data.get("status", "DISCONNECTED")
            if raw_status == "QR_READY":
                raw_status = "WAITING_FOR_QR"
            is_ready = raw_status in ["CONNECTED", "AUTHENTICATED"]
            return ProviderStatus(
                status=raw_status,
                is_ready=is_ready,
                phone_number=data.get("phone_number"),
                display_name=data.get("display_name")
            )
        except Exception as e:
            return ProviderStatus(status="ERROR", is_ready=False, error=str(e))

    async def logout(self, instance_id: str) -> bool:
        try:
            await self._request("POST", f"/v1/whatsapp/{instance_id}/logout", timeout=15.0)
            return True
        except Exception:
            return False

    async def restart(self, instance_id: str) -> ProviderStatus:
        await self._request("POST", f"/v1/whatsapp/{instance_id}/restart", timeout=30.0)
        return await self.get_connection_status(instance_id)

    async def restore_session(self, instance_id: str, session_data: Dict[str, Any]) -> ProviderStatus:
        resp = await self._request("POST", f"/v1/whatsapp/{instance_id}/restore", json=session_data, timeout=45.0)
        return await self.get_connection_status(instance_id)

    async def list_channels(self, instance_id: str) -> List[ProviderChannel]:
        resp = await self._request("GET", f"/v1/whatsapp/{instance_id}/channels", timeout=30.0)
        data = resp.json()
        raw_channels = data.get("channels") or data.get("data") or []
        
        channels = []
        for ch in raw_channels:
            jid = ch.get("newsletter_jid") or ch.get("id") or ""
            if not jid.endswith("@newsletter") and jid:
                jid = f"{jid}@newsletter" if "@" not in jid else jid
                
            channels.append(ProviderChannel(
                newsletter_jid=jid,
                name=ch.get("name") or "WhatsApp Channel",
                description=ch.get("description"),
                invite_code=ch.get("invite_code") or ch.get("link"),
                profile_picture=ch.get("profile_picture") or ch.get("picture"),
                role=ch.get("role", "admin"),
                subscribers_count=ch.get("subscribers_count") or ch.get("followers") or 0,
                verified=bool(ch.get("verified", False)),
                metadata=ch.get("metadata", {})
            ))
        return channels

    async def get_channel(self, instance_id: str, newsletter_jid: str) -> Optional[ProviderChannel]:
        channels = await self.list_channels(instance_id)
        for ch in channels:
            if ch.newsletter_jid == newsletter_jid:
                return ch
        return None

    async def send_text(self, instance_id: str, to: str, text: str) -> ProviderMessageResult:
        resp = await self._request(
            "POST",
            f"/v1/whatsapp/{instance_id}/messages/text",
            json={"to": to, "body": text, "text": text},
            timeout=45.0
        )
        data = resp.json()
        msg_id = data.get("message_id") or data.get("id") or f"msg_{datetime.now().timestamp()}"
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc), provider_raw=data)

    async def send_image(self, instance_id: str, to: str, image_url_or_bytes: Any, caption: Optional[str] = None) -> ProviderMessageResult:
        payload = {"to": to, "caption": caption}
        if isinstance(image_url_or_bytes, str):
            payload["media_url"] = image_url_or_bytes
        resp = await self._request("POST", f"/v1/whatsapp/{instance_id}/messages/image", json=payload, timeout=60.0)
        data = resp.json()
        msg_id = data.get("message_id") or data.get("id") or f"msg_{datetime.now().timestamp()}"
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc), provider_raw=data)

    async def send_video(self, instance_id: str, to: str, video_url_or_bytes: Any, caption: Optional[str] = None) -> ProviderMessageResult:
        payload = {"to": to, "caption": caption}
        if isinstance(video_url_or_bytes, str):
            payload["media_url"] = video_url_or_bytes
        resp = await self._request("POST", f"/v1/whatsapp/{instance_id}/messages/video", json=payload, timeout=90.0)
        data = resp.json()
        msg_id = data.get("message_id") or data.get("id") or f"msg_{datetime.now().timestamp()}"
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc), provider_raw=data)

    async def send_audio(self, instance_id: str, to: str, audio_url_or_bytes: Any) -> ProviderMessageResult:
        payload = {"to": to}
        if isinstance(audio_url_or_bytes, str):
            payload["media_url"] = audio_url_or_bytes
        resp = await self._request("POST", f"/v1/whatsapp/{instance_id}/messages/audio", json=payload, timeout=60.0)
        data = resp.json()
        msg_id = data.get("message_id") or data.get("id") or f"msg_{datetime.now().timestamp()}"
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc), provider_raw=data)

    async def send_poll(self, instance_id: str, to: str, question: str, options: List[str], selectable_count: int = 1) -> ProviderMessageResult:
        payload = {
            "to": to,
            "question": question,
            "options": options,
            "selectable_count": selectable_count
        }
        resp = await self._request("POST", f"/v1/whatsapp/{instance_id}/messages/poll", json=payload, timeout=45.0)
        data = resp.json()
        msg_id = data.get("message_id") or data.get("id") or f"msg_{datetime.now().timestamp()}"
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc), provider_raw=data)

    async def upload_media(self, instance_id: str, media_bytes: bytes, mime_type: str) -> str:
        files = {"file": ("media", media_bytes, mime_type)}
        resp = await self._request("POST", f"/v1/whatsapp/{instance_id}/media", files=files, timeout=60.0)
        return resp.json().get("media_id", "")

    async def get_messages(self, instance_id: str, channel_jid: str, limit: int = 20) -> List[Dict[str, Any]]:
        resp = await self._request("GET", f"/v1/whatsapp/{instance_id}/channels/{channel_jid}/messages?limit={limit}", timeout=30.0)
        return resp.json().get("messages", [])
