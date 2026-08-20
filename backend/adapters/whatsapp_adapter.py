import httpx
import os
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token
from lib.media_uploader import get_public_media_url

"""
WhatsApp Production Platform Adapter.

Publishes posts to a connected WhatsApp Business Account (via Meta Cloud API) 
or WhatsApp Broadcast Channel (via WhatsApp Channel Gateway).

Architecture:
  UNAI Flow Backend → Meta Graph API (WhatsApp Cloud) / WhatsApp Channel Gateway → WhatsApp Account/Channel
"""

class WhatsAppAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        # ── 1. Fetch user's active WhatsApp connection from Supabase ──
        conn_res = supabase.table("platform_connections") \
            .select("platform_account_id, platform_account_name, access_token, status") \
            .eq("user_id", user_id) \
            .eq("platform", "whatsapp") \
            .execute()

        conn_data = conn_res.data[0] if conn_res.data else None
        if not conn_data or conn_data.get("status") == "revoked":
            raise Exception(
                "WhatsApp is not connected to your UNAI Flow account. "
                "Please go to Connections and click 'Connect Channel' to authenticate your WhatsApp account."
            )

        channel_id = conn_data.get("platform_account_id")
        channel_name = conn_data.get("platform_account_name") or "WhatsApp Channel"
        encrypted_token = conn_data.get("access_token", "")
        access_token = decrypt_token(encrypted_token) if encrypted_token else ""

        if not channel_id:
            raise Exception(
                "No WhatsApp Channel or Phone ID selected for this connection. "
                "Please select your channel in the Connections page."
            )

        channel_link = f"https://whatsapp.com/channel/{channel_id}" if not str(channel_id).startswith("http") else str(channel_id)

        # ── 2. Resolve media URL if attached ──
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

        public_media_url = get_public_media_url(raw_media) if raw_media else None

        # ── 3. Path A: Official Meta WhatsApp Cloud API (if access token is Meta OAuth token) ──
        if access_token and not access_token.startswith("105eadef") and str(channel_id).isdigit():
            phone_number_id = channel_id
            async with httpx.AsyncClient(timeout=30.0) as client:
                headers = {
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                }
                
                # Meta Cloud API message payload
                if public_media_url:
                    payload = {
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "type": "image",
                        "image": {
                            "link": public_media_url,
                            "caption": content
                        }
                    }
                else:
                    payload = {
                        "messaging_product": "whatsapp",
                        "recipient_type": "individual",
                        "type": "text",
                        "text": {"body": content}
                    }

                try:
                    resp = await client.post(
                        f"https://graph.facebook.com/v19.0/{phone_number_id}/messages",
                        headers=headers,
                        json=payload
                    )
                    data = resp.json()
                    if resp.status_code == 200 and "messages" in data:
                        msg_id = data["messages"][0]["id"]
                        return {
                            "post_id": msg_id,
                            "post_url": f"https://wa.me/{phone_number_id}",
                        }
                    else:
                        err_detail = data.get("error", {}).get("message", resp.text)
                        print(f"Meta Cloud API WhatsApp warning: {err_detail}")
                except Exception as meta_err:
                    print(f"Meta Cloud API direct call failed: {meta_err}")

        # ── 4. Path B: WhatsApp Channel Gateway (Local or Cloud) ──
        wca_key = os.getenv("WCA_API_KEY", "105eadef-beae-4e08-bcc0-85a06ff80727")
        candidate_urls = []
        
        # 1. Local gateway (fastest, zero cold starts)
        candidate_urls.append("http://127.0.0.1:3001")
        
        # 2. Deployed cloud gateway
        cloud_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
        if cloud_url and cloud_url not in candidate_urls:
            candidate_urls.append(cloud_url)

        payload = {
            "channelId": channel_id,
            "channelName": channel_name,
            "channelLink": channel_link,
        }
        if public_media_url:
            payload["mediaUrl"] = public_media_url
            payload["caption"] = content
        else:
            payload["text"] = content

        last_error = None
        for wca_url in candidate_urls:
            # Try publishing with automatic wake-up retry for Render cold starts
            max_retries = 6 if "onrender.com" in wca_url else 1
            for attempt in range(max_retries):
                try:
                    async with httpx.AsyncClient(timeout=60.0) as client:
                        resp = await client.post(
                            f"{wca_url}/api/channel/publish",
                            headers={
                                "X-API-Key": wca_key,
                                "Content-Type": "application/json",
                            },
                            json=payload,
                        )
                        
                        if resp.status_code == 200:
                            try:
                                data = resp.json()
                                if data.get("success"):
                                    return {
                                        "post_id": data.get("messageId", f"wa_{automation_id}"),
                                        "post_url": channel_link,
                                    }
                                last_error = data.get("detail") or data.get("error") or data.get("message")
                            except Exception:
                                pass
                            break
                        elif resp.status_code in (502, 503):
                            last_error = f"Gateway at {wca_url} is waking up (HTTP {resp.status_code})."
                            if attempt < max_retries - 1:
                                import asyncio
                                await asyncio.sleep(8)  # Render free tier cold starts take ~25-45s
                                continue
                        elif resp.status_code in (400, 500):
                            try:
                                data = resp.json()
                                last_error = data.get("detail") or data.get("error") or data.get("message")
                            except Exception:
                                last_error = f"Gateway returned status {resp.status_code}"
                            break
                except (httpx.ConnectError, httpx.ConnectTimeout):
                    if attempt < max_retries - 1:
                        import asyncio
                        await asyncio.sleep(8)
                        continue
                    break
                except httpx.TimeoutException:
                    last_error = f"WhatsApp Gateway request timed out."
                    break

        if last_error:
            if "not connected" in str(last_error).lower() or "qr code" in str(last_error).lower():
                raise Exception(
                    "WhatsApp is not linked to your device yet. Please open Connections and scan the QR code under WhatsApp > Linked Devices to link your phone."
                )
            raise Exception(f"WhatsApp publish error: {last_error}")

        raise Exception(
            "WhatsApp service is not running or device is not linked. "
            "Please open Connections, scan the QR code to link your phone, and make sure the gateway is online."
        )
