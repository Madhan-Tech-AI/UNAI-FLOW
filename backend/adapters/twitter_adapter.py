import httpx
from adapters.base_adapter import PlatformAdapter
from lib.supabase_client import supabase
from lib.encryption import decrypt_token

class TwitterAdapter(PlatformAdapter):
    async def publish(self, content: str, user_id: str, automation_id: str) -> dict:
        # Fetch connection
        res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "twitter").single().execute()
        if not res.data:
            raise Exception("Twitter not connected")
            
        token = decrypt_token(res.data["access_token"])
        
        # Twitter v2 API to create a tweet
        url = "https://api.twitter.com/2/tweets"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        payload = {"text": content}
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code != 201:
                # E.g. 401 Unauthorized, token expired, etc.
                raise Exception(f"Twitter API Error: {resp.text}")
                
            data = resp.json()
            tweet_id = data.get("data", {}).get("id")
            return {
                "post_id": tweet_id,
                "post_url": f"https://twitter.com/user/status/{tweet_id}"
            }
