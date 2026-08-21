import os
import httpx
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token
from services.media_manager import MediaManager
from services.session_manager import SessionManager
from services.publish_queue import PublishQueue
from services.whatsapp_manager import WhatsAppManager

"""
UNAI WhatsApp Gateway Production Platform Adapter.
Dispatches automation posts to either:
1. UNAI WhatsApp Gateway (Direct WebSocket / @newsletter Channel publishing with queue & retries).
2. Meta WhatsApp Business Cloud API (if user explicitly connected a verified WABA).
"""

class WhatsAppAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        # ── 1. Check user's selected channel from whatsapp_connections / whatsapp_channels ──
        connection_id = SessionManager.get_or_create_connection_id(user_id)
        selected_ch = SessionManager.get_selected_channel(connection_id)

        channel_id = selected_ch.get("channel_id") if selected_ch else None
        channel_name = selected_ch.get("channel_name") if selected_ch else "WhatsApp Channel"
        channel_link = selected_ch.get("channel_link") if selected_ch else ""

        # Fallback to legacy platform_connections if not found in new table
        access_token = ""
        if not channel_id:
            conn_res = supabase.table("platform_connections") \
                .select("platform_account_id, platform_account_name, access_token, status") \
                .eq("user_id", user_id) \
                .eq("platform", "whatsapp") \
                .execute()
            conn_data = conn_res.data[0] if conn_res.data else None
            if conn_data and conn_data.get("status") != "revoked":
                channel_id = conn_data.get("platform_account_id")
                channel_name = conn_data.get("platform_account_name") or "WhatsApp Channel"
                encrypted_token = conn_data.get("access_token", "")
                access_token = decrypt_token(encrypted_token) if encrypted_token else ""

        if not channel_id:
            raise Exception(
                "No WhatsApp Channel selected. Please open Connections, connect your WhatsApp account, and select your channel."
            )

        if not channel_link:
            clean_id = str(channel_id).split("@")[0]
            channel_link = f"https://whatsapp.com/channel/{clean_id}"

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

        public_media_url = MediaManager.get_public_url(raw_media) if raw_media else None

        # ── 3. Path A: Official Meta WhatsApp Cloud API (if numeric phone_number_id & Meta OAuth token) ──
        if access_token and not access_token.startswith("105eadef") and str(channel_id).isdigit():
            phone_number_id = channel_id
            async with httpx.AsyncClient(timeout=30.0) as client:
                headers = {
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                }
                payload = {
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "type": "image" if public_media_url else "text",
                }
                if public_media_url:
                    payload["image"] = {"link": public_media_url, "caption": content}
                else:
                    payload["text"] = {"body": content}

                try:
                    resp = await client.post(
                        f"https://graph.facebook.com/v19.0/{phone_number_id}/messages",
                        headers=headers,
                        json=payload
                    )
                    data = resp.json()
                    if resp.status_code == 200 and "messages" in data:
                        return {
                            "post_id": data["messages"][0]["id"],
                            "post_url": f"https://wa.me/{phone_number_id}",
                        }
                except Exception as meta_err:
                    print(f"Meta Cloud API call failed: {meta_err}")

        # ── 4. Path B: UNAI WhatsApp Gateway (API-driven / Native WebSocket) ──
        try:
            result = await PublishQueue.enqueue_and_publish(
                user_id=user_id,
                connection_id=connection_id,
                channel_id=channel_id,
                content=content,
                media_url=public_media_url,
                automation_id=automation_id
            )
            return {
                "post_id": result.get("post_id", f"wa_{automation_id}"),
                "post_url": channel_link,
            }
        except Exception as queue_err:
            raise Exception(f"WhatsApp Gateway error: {str(queue_err)}")
