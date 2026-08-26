import httpx
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from .provider import WhatsAppProvider
from app.core.config import settings

logger = logging.getLogger(__name__)


class WhatsAppWebProvider(WhatsAppProvider):
    """
    Talks to the UNAI WhatsApp Channel API (WCA) service.
    Includes structured boundary logging at every gateway interaction.
    """

    def __init__(self, endpoint: str = None):
        self.endpoint = endpoint or settings.wca_api_url
        self.api_key = getattr(settings, "wca_api_key", "")
        self._resolved_url: Optional[str] = None  # Cache the resolved gateway URL

    def _headers(self) -> Dict[str, str]:
        """Return auth headers for protected endpoints."""
        h: Dict[str, str] = {}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        return h

    # ── Gateway Resolution ──

    async def resolve_gateway(self) -> Optional[str]:
        """
        Try each candidate WCA URL in order. Return the first healthy one.
        Logs the resolution process at every step.
        """
        candidate_urls = settings.get_wca_candidate_urls()
        logger.info(f"[WA] GATEWAY_RESOLVE candidates={candidate_urls}")

        for url in candidate_urls:
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    r = await client.get(f"{url}/health")
                    if r.status_code == 200:
                        data = r.json()
                        logger.info(
                            f"[WA] GATEWAY_HEALTH_CHECK url={url} status=healthy "
                            f"service={data.get('service', 'unknown')} "
                            f"version={data.get('version', 'unknown')}"
                        )
                        self._resolved_url = url
                        return url
                    else:
                        logger.warning(f"[WA] GATEWAY_HEALTH_CHECK url={url} status=unhealthy http={r.status_code}")
            except httpx.ConnectError:
                logger.warning(f"[WA] GATEWAY_HEALTH_CHECK url={url} status=unreachable error=connection_refused")
            except httpx.ReadTimeout:
                logger.warning(f"[WA] GATEWAY_HEALTH_CHECK url={url} status=unreachable error=timeout")
            except Exception as e:
                logger.warning(f"[WA] GATEWAY_HEALTH_CHECK url={url} status=error error={type(e).__name__}: {e}")

        logger.error("[WA] GATEWAY_RESOLVE result=ALL_UNAVAILABLE")
        self._resolved_url = None
        return None

    async def health_check(self) -> Dict[str, Any]:
        """
        Perform a health check against the gateway. Returns structured result.
        """
        url = await self.resolve_gateway()
        if url:
            try:
                async with httpx.AsyncClient(timeout=15.0) as client:
                    r = await client.get(f"{url}/health")
                    if r.status_code == 200:
                        data = r.json()
                        raw_status = data.get("status")
                        normalized_status = "healthy" if (raw_status in ["ok", "healthy", "online"] or data.get("ok")) else (raw_status or "unknown")
                        raw_version = data.get("version")
                        normalized_version = raw_version if (raw_version and raw_version != "unknown") else "2.0.0"
                        return {
                            "ok": True,
                            "gateway_url": url,
                            "service": data.get("service", "whatsapp-channel-api"),
                            "status": normalized_status,
                            "version": normalized_version,
                            "timestamp": data.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                            "active_sessions": data.get("active_sessions", 0),
                        }
            except Exception as e:
                return {"ok": False, "gateway_url": url, "error": str(e)}
        return {
            "ok": False,
            "gateway_url": None,
            "error": "All gateway candidates unreachable",
        }

    # ── HTTP helper ──

    async def _make_request(
        self,
        method: str,
        path: str,
        timeout: float = 30.0,
        max_retries: int = 3,
        gateway_url: Optional[str] = None,
        **kwargs,
    ) -> httpx.Response:
        """
        Make HTTP request to WCA with cold-start-aware retry.
        Uses resolved gateway URL or tries resolution if not cached.
        """
        base_url = gateway_url or self._resolved_url
        if not base_url:
            # Try to resolve
            base_url = await self.resolve_gateway()
            if not base_url:
                raise httpx.ConnectError(
                    "WhatsApp gateway unavailable — all candidate URLs unreachable"
                )

        kwargs.setdefault("headers", {})
        kwargs["headers"].update(self._headers())

        delays = [2, 4, 8][:max_retries]
        last_exc = None

        for attempt in range(len(delays) + 1):
            try:
                async with httpx.AsyncClient(base_url=base_url, timeout=timeout) as client:
                    response = await client.request(method, path, **kwargs)
                    if response.status_code == 429 and attempt < len(delays):
                        sleep_s = delays[attempt]
                        logger.warning(
                            f"[WA] GATEWAY_RATE_LIMITED path={path} "
                            f"retry_in={sleep_s}s attempt={attempt+1}/{len(delays)+1}"
                        )
                        await asyncio.sleep(sleep_s)
                        continue
                    return response
            except (httpx.ConnectError, httpx.ReadTimeout) as e:
                last_exc = e
                if attempt < len(delays):
                    sleep_s = delays[attempt]
                    logger.warning(
                        f"[WA] GATEWAY_REQUEST_RETRY path={path} "
                        f"error={type(e).__name__} retry_in={sleep_s}s "
                        f"attempt={attempt+1}/{len(delays)+1}"
                    )
                    await asyncio.sleep(sleep_s)
                    continue
                raise

        raise last_exc or Exception("WCA request failed after retries")

    # ── Connection lifecycle ──

    async def connect(self, session_identifier: str) -> Dict[str, Any]:
        """POST /v1/whatsapp/connect — creates or resumes a session on the gateway."""
        logger.info(f"[WA] GATEWAY_SESSION_CREATE session_id={session_identifier} request=sent")
        # Send both field names for compatibility:
        #   - "connection_id": required by production Python WCA (Pydantic model)
        #   - "connectionId": accepted by local TypeScript WCA
        #   - "session_identifier": legacy field (kept for forward compatibility)
        response = await self._make_request(
            "POST",
            "/v1/whatsapp/connect",
            timeout=35.0,
            max_retries=3,
            json={
                "connection_id": session_identifier,
                "connectionId": session_identifier,
                "session_identifier": session_identifier,
            },
        )
        response.raise_for_status()
        data = response.json()
        logger.info(
            f"[WA] GATEWAY_SESSION_CREATE session_id={session_identifier} "
            f"response=received isReady={data.get('isReady', False)}"
        )
        return {
            "success": True,
            "status": "INITIALIZING",
            "session_identifier": session_identifier,
            "connectionId": data.get("connectionId"),
            "isReady": data.get("isReady", False),
        }

    async def disconnect(self, session_identifier: str) -> bool:
        """POST /v1/whatsapp/{session_identifier}/disconnect — purges session on gateway."""
        logger.info(f"[WA] GATEWAY_DISCONNECT session_id={session_identifier}")
        try:
            response = await self._make_request(
                "POST",
                f"/v1/whatsapp/{session_identifier}/disconnect",
                timeout=15.0,
                max_retries=1,
            )
            return response.status_code == 200
        except Exception as e:
            logger.error(f"[WA] GATEWAY_DISCONNECT_FAILED session_id={session_identifier} error={e}")
            return False

    async def get_status(self, session_identifier: str) -> str:
        """GET /v1/whatsapp/{session_identifier}/status"""
        response = await self._make_request(
            "GET",
            f"/v1/whatsapp/{session_identifier}/status",
            timeout=6.0,
            max_retries=0,
        )
        response.raise_for_status()
        return response.json().get("status", "DISCONNECTED")

    async def get_full_status(self, session_identifier: str) -> Dict[str, Any]:
        """
        GET /v1/whatsapp/{session_identifier}/status (returns full JSON).
        CRITICAL: This must NOT silently swallow errors.
        """
        logger.info(f"[WA] STATUS_REQUEST session_id={session_identifier}")

        response = await self._make_request(
            "GET",
            f"/v1/whatsapp/{session_identifier}/status",
            timeout=6.0,
            max_retries=0,
        )
        response.raise_for_status()
        data = response.json()

        status = data.get("status", "DISCONNECTED")
        logger.info(
            f"[WA] STATUS_RESPONSE session_id={session_identifier} "
            f"status={status} hasQR={data.get('hasQR', False)} "
            f"isReady={data.get('isReady', False)}"
        )
        return data

    async def get_pairing_data(self, session_identifier: str) -> Dict[str, Any]:
        """GET /v1/whatsapp/:connectionId/qr — fetch QR code from gateway."""
        logger.info(f"[WA] QR_REQUEST session_id={session_identifier}")

        response = await self._make_request(
            "GET",
            f"/v1/whatsapp/{session_identifier}/qr",
            timeout=6.0,
            max_retries=0,
        )

        if response.status_code == 204:
            logger.info(f"[WA] QR_NOT_READY session_id={session_identifier} reason=204_no_content")
            return {"type": "not_required"}

        response.raise_for_status()

        # If the response is an image, we base64 encode it
        content_type = response.headers.get("content-type", "")
        if "image" in content_type:
            import base64

            b64_img = base64.b64encode(response.content).decode("utf-8")
            data_uri = f"data:{content_type};base64,{b64_img}"
            logger.info(
                f"[WA] QR_RECEIVED session_id={session_identifier} "
                f"format=image length={len(response.content)}"
            )
            return {"type": "qr", "data": data_uri}

        # Fallback if it returned JSON for some reason
        try:
            data = response.json()
            if data.get("state") == "connected":
                logger.info(f"[WA] QR_NOT_REQUIRED session_id={session_identifier} reason=already_connected")
                return {"type": "not_required"}
            qr = data.get("qr")
            if qr:
                logger.info(
                    f"[WA] QR_RECEIVED session_id={session_identifier} "
                    f"format=json length={len(qr)}"
                )
                return {"type": "qr", "data": qr}
        except Exception:
            pass

        logger.warning(f"[WA] QR_EMPTY session_id={session_identifier} content_type={content_type}")
        return {"type": "not_required"}

    # ── Channel discovery ──

    async def get_channels(self, session_identifier: str) -> List[Dict[str, Any]]:
        """GET /v1/whatsapp/:connectionId/channels"""
        logger.info(f"[WA] CHANNELS_REQUEST session_id={session_identifier}")
        response = await self._make_request(
            "GET", f"/v1/whatsapp/{session_identifier}/channels"
        )
        if response.status_code == 400:
            logger.warning(f"[WA] CHANNELS_REQUEST session_id={session_identifier} error=400")
            return []
        response.raise_for_status()
        data = response.json()
        channels = data.get("channels", [])
        logger.info(f"[WA] CHANNELS_RECEIVED session_id={session_identifier} count={len(channels)}")
        return channels

    async def get_channel(
        self, session_identifier: str, channel_id: str
    ) -> Dict[str, Any]:
        channels = await self.get_channels(session_identifier)
        for ch in channels:
            if ch.get("id") == channel_id:
                return ch
        raise ValueError("Channel not found")

    async def get_channel_permissions(
        self, session_identifier: str, channel_id: str
    ) -> Dict[str, Any]:
        ch = await self.get_channel(session_identifier, channel_id)
        role = ch.get("role", "GUEST")
        return {
            "can_publish": role in ["ADMIN", "OWNER"],
            "can_edit": role in ["ADMIN", "OWNER"],
            "can_manage": role == "OWNER",
        }

    # ── Publishing ──

    async def publish_text(
        self, session_identifier: str, channel_id: str, body: str
    ) -> Dict[str, Any]:
        logger.info(f"[WA] PUBLISH_TEXT session_id={session_identifier} channel_id={channel_id}")
        payload = {"type": "text", "text": body}
        response = await self._make_request(
            "POST",
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
        )
        response.raise_for_status()
        result = response.json()
        logger.info(
            f"[WA] PUBLISH_TEXT_RESULT session_id={session_identifier} "
            f"message_id={result.get('postId', 'unknown')}"
        )
        return result

    async def publish_image(
        self, session_identifier: str, channel_id: str, media_url: str, caption: str
    ) -> Dict[str, Any]:
        logger.info(f"[WA] PUBLISH_IMAGE session_id={session_identifier} channel_id={channel_id}")
        payload = {"type": "image", "mediaUrl": media_url, "caption": caption}
        response = await self._make_request(
            "POST",
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def publish_video(
        self, session_identifier: str, channel_id: str, media_url: str, caption: str
    ) -> Dict[str, Any]:
        logger.info(f"[WA] PUBLISH_VIDEO session_id={session_identifier} channel_id={channel_id}")
        payload = {"type": "video", "mediaUrl": media_url, "caption": caption}
        response = await self._make_request(
            "POST",
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def publish_link(
        self, session_identifier: str, channel_id: str, url: str, caption: str
    ) -> Dict[str, Any]:
        logger.info(f"[WA] PUBLISH_LINK session_id={session_identifier} channel_id={channel_id}")
        payload = {"type": "text", "text": f"{caption}\n{url}"}
        response = await self._make_request(
            "POST",
            f"/v1/whatsapp/connections/{session_identifier}/channels/{channel_id}/publish",
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def publish_poll(
        self,
        session_identifier: str,
        channel_id: str,
        question: str,
        options: List[str],
    ) -> Dict[str, Any]:
        raise NotImplementedError("NOT_SUPPORTED_BY_PROVIDER")

    async def get_channels(self, session_identifier: str) -> List[Dict[str, Any]]:
        """Discover WhatsApp Channels/Newsletters from the gateway."""
        logger.info(f"[WA] CHANNELS_REQUEST session_id={session_identifier}")
        try:
            response = await self._make_request(
                "GET", f"/v1/whatsapp/{session_identifier}/channels",
                timeout=8.0,
                max_retries=0,
            )
            if response.status_code == 200:
                data = response.json()
                channels = data.get("channels", [])
                logger.info(f"[WA] CHANNELS_RESPONSE session_id={session_identifier} count={len(channels)}")
                return channels
            logger.warning(f"[WA] CHANNELS_RESPONSE session_id={session_identifier} status={response.status_code}")
            return []
        except Exception as e:
            logger.error(f"[WA] CHANNELS_REQUEST_FAILED session_id={session_identifier} error={e}")
            return []

    async def resolve_channel(self, session_identifier: str, link_or_code: str) -> Optional[Dict[str, Any]]:
        """Resolve a WhatsApp Channel by invite link or code from the gateway."""
        logger.info(f"[WA] RESOLVE_CHANNEL_REQUEST session_id={session_identifier} input={link_or_code}")
        try:
            response = await self._make_request(
                "POST",
                f"/v1/whatsapp/{session_identifier}/channels/resolve",
                json={"link": link_or_code},
                timeout=10.0,
                max_retries=0,
            )
            if response.status_code == 200:
                data = response.json()
                channel = data.get("channel")
                logger.info(f"[WA] RESOLVE_CHANNEL_RESPONSE session_id={session_identifier} found={bool(channel)}")
                return channel
            logger.warning(f"[WA] RESOLVE_CHANNEL_FAILED session_id={session_identifier} status={response.status_code}")
            return None
        except Exception as e:
            logger.error(f"[WA] RESOLVE_CHANNEL_ERROR session_id={session_identifier} error={e}")
            return None

    async def register_webhook(self) -> bool:
        return True
