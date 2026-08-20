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
                        print(f"Meta Cloud API WhatsApp warning/error: {err_detail}")
                except Exception as meta_err:
                    print(f"Meta Cloud API direct call failed: {meta_err}")

        # ── 4. Path B: WhatsApp Channel Gateway ──
        wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
        wca_key = os.getenv("WCA_API_KEY", "105eadef-beae-4e08-bcc0-85a06ff80727")

        if not wca_url:
            raise Exception("WhatsApp service endpoint not configured.")

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

        async with httpx.AsyncClient(timeout=90.0) as client:
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
                    f"WhatsApp service connection failed. Gateway at {wca_url} is currently offline."
                )
            except httpx.TimeoutException:
                raise Exception("WhatsApp publish request timed out.")

        try:
            data = resp.json()
        except Exception:
            raise Exception(f"WhatsApp service returned unexpected response (HTTP {resp.status_code}).")

        if resp.status_code == 200 and data.get("success"):
            return {
                "post_id": data.get("messageId", f"wa_{automation_id}"),
                "post_url": channel_link,
            }

        error = data.get("error") if isinstance(data.get("error"), dict) else {}
        error_msg = error.get("message") or data.get("detail") or data.get("message") or f"HTTP {resp.status_code}"
        raise Exception(f"WhatsApp publish failed: {error_msg}")
