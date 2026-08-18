import httpx
import os
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token
from lib.media_uploader import get_public_media_url

class WhatsAppAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        # 1. Resolve connection & tokens
        # Prioritize latest environment variable if configured
        env_token = os.getenv("WHATSAPP_ACCESS_TOKEN")
        env_phone_id = os.getenv("WHATSAPP_PHONE_ID")
        
        token = env_token
        phone_number_id = env_phone_id
        
        # Fallback to database connection if environment token is not provided
        if not token or token == "mock_wa_token":
            res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "whatsapp").execute()
            if not res.data:
                res = supabase.table("platform_connections").select("*").eq("platform", "whatsapp").eq("status", "active").execute()
                
            if res.data:
                connection = res.data[0]
                token = decrypt_token(connection["access_token"])
                phone_number_id = connection.get("platform_account_id") or env_phone_id
            
        if not token or token == "mock_wa_token":
            raise Exception("WhatsApp Cloud API token not configured in .env (WHATSAPP_ACCESS_TOKEN).")
            
        if not phone_number_id or phone_number_id == "mock_phone_id":
            raise Exception("WhatsApp Phone Number ID not configured in .env (WHATSAPP_PHONE_ID).")
            
        # Target WhatsApp Channel or Recipient
        channel_link = os.getenv("WHATSAPP_CHANNEL_LINK", "https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M")
        channel_id = os.getenv("WHATSAPP_CHANNEL_ID")
        target_recipient = os.getenv("WHATSAPP_TEST_RECIPIENT") or channel_id or "1234567890"
        
        # 2. Check if automation has media
        automation = supabase.table("automations").select("media_url").eq("id", automation_id).single().execute().data
        raw_media = automation.get("media_url") if automation else None
        
        url = f"https://graph.facebook.com/v19.0/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        if raw_media:
            public_media_url = get_public_media_url(raw_media)
            is_video = any(v in public_media_url.lower() for v in ['.mp4', '.mov', 'video']) or raw_media.startswith("data:video")
            
            if is_video:
                payload = {
                    "messaging_product": "whatsapp",
                    "to": target_recipient,
                    "type": "video",
                    "video": {
                        "link": public_media_url,
                        "caption": content
                    }
                }
            else:
                payload = {
                    "messaging_product": "whatsapp",
                    "to": target_recipient,
                    "type": "image",
                    "image": {
                        "link": public_media_url,
                        "caption": content
                    }
                }
        else:
            payload = {
                "messaging_product": "whatsapp",
                "to": target_recipient,
                "type": "text",
                "text": {"body": content}
            }
        
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code not in (200, 201):
                raise Exception(f"WhatsApp API Error: {resp.text}")
                
            data = resp.json()
            message_id = data.get("messages", [{}])[0].get("id")
            return {
                "post_id": message_id,
                "post_url": channel_link
            }
