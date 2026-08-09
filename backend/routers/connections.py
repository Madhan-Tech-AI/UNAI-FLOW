import os
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from typing import Dict, Any
from middleware.auth import verify_jwt
from lib.supabase_client import supabase
from lib.encryption import encrypt_token

router = APIRouter(prefix="/connections", tags=["Connections"])

@router.get("")
async def get_connections(user: Dict[str, Any] = Depends(verify_jwt)):
    res = supabase.table("platform_connections").select("id, platform, platform_account_name, status, connected_at").eq("user_id", user["user_id"]).execute()
    return {"connections": res.data}

@router.post("/{platform}/start")
async def start_oauth(platform: str, user: Dict[str, Any] = Depends(verify_jwt)):
    backend_url = os.getenv("BACKEND_URL", "http://localhost:8000")
    
    # In a real app, this returns the OAuth authorization URL
    if platform == "twitter":
        client_id = os.getenv("TWITTER_CLIENT_ID")
        redirect_uri = f"{backend_url}/connections/twitter/callback"
        # Dummy URL for Phase 4 architecture layout
        url = f"https://twitter.com/i/oauth2/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope=tweet.read%20tweet.write%20users.read&state={user['user_id']}&code_challenge=challenge&code_challenge_method=plain"
        return {"authorization_url": url}
        
    elif platform == "instagram":
        app_id = os.getenv("META_APP_ID")
        redirect_uri = f"{backend_url}/connections/instagram/callback"
        url = f"https://www.facebook.com/v19.0/dialog/oauth?client_id={app_id}&redirect_uri={redirect_uri}&state={user['user_id']}&scope=instagram_basic,instagram_content_publish"
        return {"authorization_url": url}
        
    elif platform == "whatsapp":
        # WhatsApp Business API connections often involve a system user token or embedded signup
        return {"authorization_url": "https://business.facebook.com/"}
        
    raise HTTPException(status_code=400, detail="Unsupported platform")

@router.get("/{platform}/callback")
async def oauth_callback(platform: str, code: str, state: str):
    user_id = state
    # In a real app, you exchange `code` for `access_token` and `refresh_token` using httpx
    # Here we mock the token exchange to prove the encrypted storage architecture works
    mock_access_token = f"mock_token_{platform}_{code}"
    encrypted_token = encrypt_token(mock_access_token)
    
    # Store in Supabase
    supabase.table("platform_connections").upsert({
        "user_id": user_id,
        "platform": platform,
        "access_token": encrypted_token,
        "status": "active"
    }, on_conflict="user_id, platform").execute()
    
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    # Redirect back to frontend
    return RedirectResponse(url=f"{frontend_url}/connections?success=true")

@router.delete("/{platform}")
async def disconnect_platform(platform: str, user: Dict[str, Any] = Depends(verify_jwt)):
    supabase.table("platform_connections").delete().eq("user_id", user["user_id"]).eq("platform", platform).execute()
    return {"status": "success"}
