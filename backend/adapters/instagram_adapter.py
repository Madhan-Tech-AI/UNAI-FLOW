import httpx
import asyncio
import base64
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token
from lib.media_uploader import get_public_media_url

class InstagramAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        # 1. Fetch connection
        res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "instagram").execute()
        if not res.data:
            res = supabase.table("platform_connections").select("*").eq("platform", "instagram").eq("status", "active").execute()
            
        if not res.data:
            raise Exception("Instagram not connected. Please connect Instagram in Platform Connections page.")
            
        connection = res.data[0]
        token = decrypt_token(connection["access_token"])
        ig_user_id = connection.get("platform_account_id")
        
        if not ig_user_id:
            raise Exception("Instagram Business Account ID not configured for this connection.")
            
        # 2. Fetch automation & media
        automation = supabase.table("automations").select("media_url").eq("id", automation_id).single().execute().data
        raw_media = automation.get("media_url") if automation else None
        
        if not raw_media:
            raise Exception("Instagram requires an image or video URL to publish to feed.")
            
        # Convert base64 media to public HTTP URL
        public_media_url = get_public_media_url(raw_media)
        is_video = any(v_ext in public_media_url.lower() for v_ext in ['.mp4', '.mov', 'video']) or raw_media.startswith("data:video")
        
        # 3. Create Media Container
        container_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media"
        if is_video:
            container_payload = {
                "media_type": "REELS",
                "video_url": public_media_url,
                "caption": content,
                "access_token": token
            }
        else:
            container_payload = {
                "image_url": public_media_url,
                "caption": content,
                "access_token": token
            }
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            c_resp = await client.post(container_url, data=container_payload)
            if c_resp.status_code != 200:
                raise Exception(f"Instagram Media Container Error: {c_resp.text}")
                
            creation_id = c_resp.json().get("id")
            
            # 4. POLL: Wait for media container to be ready before publishing
            status_url = f"https://graph.facebook.com/v19.0/{creation_id}"
            max_attempts = 15
            for attempt in range(max_attempts):
                await asyncio.sleep(3)  # Wait 3 seconds between checks
                
                status_resp = await client.get(status_url, params={
                    "fields": "status_code",
                    "access_token": token
                })
                
                if status_resp.status_code == 200:
                    status_code = status_resp.json().get("status_code")
                    print(f"[Instagram] Container {creation_id} status: {status_code} (attempt {attempt+1}/{max_attempts})")
                    
                    if status_code == "FINISHED":
                        break
                    elif status_code == "ERROR":
                        raise Exception(f"Instagram media processing failed for container {creation_id}")
                else:
                    print(f"[Instagram] Status check failed: {status_resp.text}")
            else:
                raise Exception(f"Instagram media container {creation_id} did not finish processing after {max_attempts} attempts")
            
            # 5. Publish Media Container (now that it's FINISHED)
            publish_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media_publish"
            p_resp = await client.post(publish_url, data={"creation_id": creation_id, "access_token": token})
            if p_resp.status_code != 200:
                raise Exception(f"Instagram Publish Error: {p_resp.text}")
                
            post_id = p_resp.json().get("id")
            return {
                "post_id": post_id,
                "post_url": f"https://instagram.com/p/{post_id}"
            }
