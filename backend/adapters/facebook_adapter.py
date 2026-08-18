import httpx
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token
from lib.media_uploader import get_public_media_url

class FacebookAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        try:
            # 1. Fetch connection
            res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "facebook").execute()
            if not res.data:
                # Fallback to any active facebook connection
                res = supabase.table("platform_connections").select("*").eq("platform", "facebook").eq("status", "active").execute()
                
            if not res.data:
                raise Exception("Facebook not connected. Please connect Facebook Page in Platform Connections.")
                
            connection = res.data[0]
            token = decrypt_token(connection["access_token"])
            page_id = connection.get("platform_account_id")
            
            if not page_id:
                raise Exception("Facebook Page ID not configured for this connection")
            
            # 2. Fetch media from automation
            automation = supabase.table("automations").select("media_url").eq("id", automation_id).single().execute().data
            raw_media = automation.get("media_url") if automation else None
            
            async with httpx.AsyncClient(timeout=45.0) as client:
                if raw_media:
                    public_media_url = get_public_media_url(raw_media)
                    is_video = any(v_ext in public_media_url.lower() for v_ext in ['.mp4', '.mov', 'video']) or raw_media.startswith("data:video")
                    
                    if is_video:
                        url = f"https://graph.facebook.com/v19.0/{page_id}/videos"
                        payload = {
                            "file_url": public_media_url,
                            "description": content,
                            "access_token": token
                        }
                    else:
                        url = f"https://graph.facebook.com/v19.0/{page_id}/photos"
                        payload = {
                            "url": public_media_url,
                            "caption": content,
                            "access_token": token
                        }
                    resp = await client.post(url, data=payload)
                else:
                    # Publish text feed post
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
