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
            
        connection = res.data
        token = decrypt_token(connection["access_token"])
        
        async def post_tweet(tok):
            url = "https://api.twitter.com/2/tweets"
            headers = {
                "Authorization": f"Bearer {tok}",
                "Content-Type": "application/json"
            }
            payload = {"text": content}
            async with httpx.AsyncClient(timeout=30.0) as client:
                return await client.post(url, headers=headers, json=payload)
        
        resp = await post_tweet(token)
        
        # If token is expired, try to refresh
        if resp.status_code == 401 and connection.get("refresh_token"):
            try:
                print("Twitter token expired. Attempting refresh...")
                new_token = await refresh_twitter_token(connection["id"], decrypt_token(connection["refresh_token"]))
                resp = await post_tweet(new_token)
            except Exception as refresh_err:
                print(f"Failed to refresh Twitter token: {refresh_err}")
        
        if resp.status_code != 201:
            raise Exception(f"Twitter API Error: {resp.text}")
            
        data = resp.json()
        tweet_id = data.get("data", {}).get("id")
        return {
            "post_id": tweet_id,
            "post_url": f"https://twitter.com/user/status/{tweet_id}"
        }

async def refresh_twitter_token(connection_id: str, refresh_token: str) -> str:
    import os
    from lib.encryption import encrypt_token
    
    client_id = os.getenv("TWITTER_CLIENT_ID")
    client_secret = os.getenv("TWITTER_CLIENT_SECRET")
    url = "https://api.twitter.com/2/oauth2/token"
    
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id
    }
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, data=data, auth=(client_id, client_secret))
        if resp.status_code != 200:
            raise Exception(f"Twitter token refresh failed: {resp.text}")
            
        res_json = resp.json()
        new_access = res_json["access_token"]
        new_refresh = res_json.get("refresh_token")
        
        update_data = {
            "access_token": encrypt_token(new_access),
            "status": "active"
        }
        if new_refresh:
            update_data["refresh_token"] = encrypt_token(new_refresh)
            
        supabase.table("platform_connections").update(update_data).eq("id", connection_id).execute()
        return new_access
