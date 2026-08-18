import httpx
import base64
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token

class FacebookAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        # 1. Fetch connection
        res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "facebook").execute()
        if not res.data:
            res = supabase.table("platform_connections").select("*").eq("platform", "facebook").eq("status", "active").execute()
            
        if not res.data:
            raise Exception("Facebook not connected. Please connect Facebook Page in Platform Connections page.")
            
        connection = res.data[0]
        token = decrypt_token(connection["access_token"])
        page_id = connection.get("platform_account_id")
        
        if not page_id:
            raise Exception("Facebook Page ID not configured for this connection.")
        
        # 2. Fetch media from automation
        automation = supabase.table("automations").select("media_url").eq("id", automation_id).single().execute().data
        raw_media = automation.get("media_url") if automation else None
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            if raw_media:
                file_bytes = None
                mime_type = "image/png"
                ext = "png"
                is_video = False
                
                # Case A: Base64 Data URI
                if raw_media.startswith("data:"):
                    try:
                        header, encoded = raw_media.split(",", 1)
                        mime_type = header.split(";")[0].split(":")[1]
                        ext = mime_type.split("/")[1]
                        if ext == "jpeg":
                            ext = "jpg"
                        elif ext == "quicktime":
                            ext = "mov"
                        is_video = mime_type.startswith("video/")
                        file_bytes = base64.b64decode(encoded)
                    except Exception as parse_err:
                        print(f"Error parsing base64 media: {parse_err}")
                
                # Case B: HTTP/HTTPS URL
                elif raw_media.startswith("http://") or raw_media.startswith("https://"):
                    try:
                        download_resp = await client.get(raw_media)
                        if download_resp.status_code == 200:
                            file_bytes = download_resp.content
                            mime_type = download_resp.headers.get("content-type", "image/png").split(";")[0]
                            if "/" in mime_type:
                                ext = mime_type.split("/")[1]
                            is_video = mime_type.startswith("video/") or any(v in raw_media.lower() for v in ['.mp4', '.mov'])
                    except Exception as dl_err:
                        print(f"Error downloading media from URL: {dl_err}")
                
                # Upload direct binary stream to Facebook Graph API
                if file_bytes:
                    if is_video:
                        url = f"https://graph.facebook.com/v19.0/{page_id}/videos"
                        params = {
                            "description": content,
                            "access_token": token
                        }
                        files = {
                            "source": (f"video.{ext}", file_bytes, mime_type)
                        }
                        resp = await client.post(url, params=params, files=files)
                    else:
                        url = f"https://graph.facebook.com/v19.0/{page_id}/photos"
                        params = {
                            "message": content,
                            "access_token": token
                        }
                        files = {
                            "source": (f"photo.{ext}", file_bytes, mime_type)
                        }
                        resp = await client.post(url, params=params, files=files)
                else:
                    # Fallback to URL parameter if bytes could not be resolved
                    url = f"https://graph.facebook.com/v19.0/{page_id}/photos"
                    params = {
                        "url": raw_media,
                        "message": content,
                        "access_token": token
                    }
                    resp = await client.post(url, params=params)
            else:
                # Text-only feed post
                url = f"https://graph.facebook.com/v19.0/{page_id}/feed"
                params = {
                    "message": content,
                    "access_token": token
                }
                resp = await client.post(url, params=params)
            
            if resp.status_code != 200:
                raise Exception(f"Facebook API Error: {resp.text}")
                
            data = resp.json()
            post_id = data.get("id") or data.get("post_id")
            return {
                "post_id": post_id,
                "post_url": f"https://facebook.com/{post_id}"
            }
