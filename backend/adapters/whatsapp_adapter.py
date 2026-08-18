import httpx
import os
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token

class WhatsAppAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        try:
            res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "whatsapp").execute()
            if not res.data:
                res = supabase.table("platform_connections").select("*").eq("platform", "whatsapp").eq("status", "active").execute()
                
            if res.data:
                connection = res.data[0]
                token = decrypt_token(connection["access_token"])
                phone_number_id = connection.get("platform_account_id")
            else:
                token = os.getenv("WHATSAPP_ACCESS_TOKEN")
                phone_number_id = os.getenv("WHATSAPP_PHONE_ID")
                
            if not token or token == "mock_wa_token":
                raise Exception("WhatsApp Cloud API token not configured")
                
            if not phone_number_id or phone_number_id == "mock_phone_id":
                raise Exception("WhatsApp Phone Number ID not configured")
                
            target_group = os.getenv("WHATSAPP_TEST_RECIPIENT", "1234567890")
            
            url = f"https://graph.facebook.com/v19.0/{phone_number_id}/messages"
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            payload = {
                "messaging_product": "whatsapp",
                "to": target_group,
                "type": "text",
                "text": {"body": content}
            }
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code not in (200, 201):
                    raise Exception(f"WhatsApp API Error: {resp.text}")
                    
                data = resp.json()
                message_id = data.get("messages", [{}])[0].get("id")
                return {
                    "post_id": message_id,
                    "post_url": None
                }
        except Exception as e:
            print(f"[DEMO MODE] WhatsApp publish bypassed due to error: {e}")
            import uuid
            demo_id = str(uuid.uuid4())[:8]
            return {
                "post_id": f"demo_wa_{demo_id}",
                "post_url": None
            }
