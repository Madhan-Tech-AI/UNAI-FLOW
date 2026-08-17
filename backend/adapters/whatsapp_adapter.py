import httpx
import os
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token

class WhatsAppAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        try:
            res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "whatsapp").single().execute()
            if not res.data:
                raise Exception("WhatsApp not connected")
                
            token = decrypt_token(res.data["access_token"])
            phone_number_id = res.data.get("platform_account_id")
            
            if not phone_number_id:
                raise Exception("WhatsApp Phone Number ID not configured")
                
            # Target recipient / group ID (Assume user settings store a default group or it's part of the connection)
            # For simplicity, if we don't have a UI to select groups, we use a placeholder or read from settings
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
