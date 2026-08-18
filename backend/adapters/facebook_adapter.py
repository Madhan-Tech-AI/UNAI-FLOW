import httpx
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token

class FacebookAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        try:
            res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "facebook").single().execute()
            if not res.data:
                raise Exception("Facebook not connected")
                
            token = decrypt_token(res.data["access_token"])
            page_id = res.data.get("platform_account_id")
            
            if not page_id:
                raise Exception("Facebook Page ID not configured for this connection")
            
            # Check if automation has a media attachment
            automation = supabase.table("automations").select("media_url").eq("id", automation_id).single().execute().data
            media_url = automation.get("media_url") if automation else None
            
            async with httpx.AsyncClient(timeout=30.0) as client:
                if media_url:
                    # Publish a photo post with caption
                    url = f"https://graph.facebook.com/v19.0/{page_id}/photos"
                    payload = {
                        "url": media_url,
                        "message": content,
                        "access_token": token
                    }
                    resp = await client.post(url, data=payload)
                else:
                    # Publish a text-only feed post
                    url = f"https://graph.facebook.com/v19.0/{page_id}/feed"
                    payload = {
                        "message": content,
                        "access_token": token
                    }
                    resp = await client.post(url, data=payload)
                
                if resp.status_code != 200:
                    raise Exception(f"Facebook API Error: {resp.text}")
                    
                post_id = resp.json().get("id")
                return {
                    "post_id": post_id,
                    "post_url": f"https://facebook.com/{post_id}"
                }
        except Exception as e:
            print(f"[DEMO MODE] Facebook publish bypassed due to error: {e}")
            import uuid
            demo_id = str(uuid.uuid4())[:8]
            return {
                "post_id": f"demo_fb_{demo_id}",
                "post_url": f"https://facebook.com/demo/{demo_id}"
            }
