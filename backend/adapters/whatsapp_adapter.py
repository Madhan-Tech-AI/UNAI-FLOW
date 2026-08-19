import httpx
import os
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.media_uploader import get_public_media_url

"""
WhatsApp Channel Adapter.

Publishes posts to a WhatsApp Channel via the self-hosted WhatsApp Channel API
(Node.js + whatsapp-web.js) running as a separate service.

Architecture:
  UNAI Flow Backend → HTTP → WhatsApp Channel API → WhatsApp Web → Channel

Required env vars:
  WCA_API_URL  = http://localhost:3001  (URL of the WhatsApp Channel API)
  WCA_API_KEY  = <your-api-key>        (same key configured in the WCA service)
"""


class WhatsAppAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        # ── 1. Load WhatsApp Channel API credentials ──
        wca_url = os.getenv("WCA_API_URL", "").rstrip("/")
        wca_key = os.getenv("WCA_API_KEY", "")

        if not wca_url:
            raise Exception(
                "WhatsApp Channel API URL not configured. "
                "Set WCA_API_URL in your environment variables (e.g., http://localhost:3001)."
            )

        if not wca_key:
            raise Exception(
                "WhatsApp Channel API key not configured. "
                "Set WCA_API_KEY in your environment variables."
            )

        # ── 2. Check API health before attempting publish ──
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                health = await client.get(f"{wca_url}/api/status")
                if health.status_code == 503:
                    status_data = health.json().get("whatsapp", {})
                    state = status_data.get("state", "unknown")
                    if state == "qr_pending":
                        raise Exception(
                            "WhatsApp Channel API requires QR code scanning. "
                            f"Open {wca_url}/api/qr in your browser and scan with WhatsApp."
                        )
                    else:
                        raise Exception(
                            f"WhatsApp Channel API is not connected (state: {state}). "
                            f"Check the service at {wca_url}/api/status."
                        )
            except httpx.ConnectError:
                raise Exception(
                    f"Cannot connect to WhatsApp Channel API at {wca_url}. "
                    "Make sure the service is running (cd whatsapp-channel-api && npm start)."
                )
            except httpx.TimeoutException:
                raise Exception(
                    f"WhatsApp Channel API at {wca_url} timed out on health check."
                )

        # ── 3. Resolve media URL ──
        raw_media = None
        try:
            automation = supabase.table("automations") \
                .select("media_url") \
                .eq("id", automation_id) \
                .single() \
                .execute().data
            raw_media = automation.get("media_url") if automation else None
        except Exception:
            pass

        # ── 4. Build publish payload ──
        channel_link = os.getenv(
            "WHATSAPP_CHANNEL_LINK",
            "https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M"
        )

        payload = {}
        if raw_media:
            public_media_url = get_public_media_url(raw_media)
            payload = {
                "mediaUrl": public_media_url,
                "caption": content,
            }
        else:
            payload = {
                "text": content,
            }

        # ── 5. Call the WhatsApp Channel API (single attempt, no retry) ──
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                resp = await client.post(
                    f"{wca_url}/api/channel/publish",
                    headers={
                        "X-API-Key": wca_key,
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            except httpx.ConnectError:
                raise Exception(
                    f"WhatsApp Channel API connection failed during publish. "
                    f"Service at {wca_url} may have restarted."
                )
            except httpx.TimeoutException:
                raise Exception(
                    "WhatsApp Channel API timed out during publish (60s limit)."
                )

        # ── 6. Parse response ──
        try:
            data = resp.json()
        except Exception:
            raise Exception(
                f"WhatsApp Channel API returned non-JSON response (HTTP {resp.status_code})."
            )

        if resp.status_code == 200 and data.get("success"):
            return {
                "post_id": data.get("messageId", "unknown"),
                "post_url": channel_link,
            }

        # Error response from the API
        error = data.get("error", {})
        error_code = error.get("code", "UNKNOWN")
        error_msg = error.get("message", "Unknown error from WhatsApp Channel API")

        if error_code == "NOT_CONNECTED":
            raise Exception(
                f"WhatsApp is not connected. Open {wca_url}/api/qr "
                "in your browser and scan the QR code with your WhatsApp app."
            )
        elif error_code == "DUPLICATE_POST":
            raise Exception(
                "Duplicate post rejected — this exact content was already "
                "published to your WhatsApp Channel recently."
            )
        elif error_code == "RATE_LIMITED":
            raise Exception(
                "WhatsApp Channel API rate limit reached. Try again in a minute."
            )
        elif resp.status_code == 401:
            raise Exception(
                "WhatsApp Channel API rejected the API key. "
                "Make sure WCA_API_KEY in your backend .env matches "
                "WCA_API_KEY in your whatsapp-channel-api .env."
            )
        else:
            raise Exception(
                f"WhatsApp Channel publish failed ({error_code}): {error_msg}"
            )
