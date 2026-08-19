import os
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from typing import Dict, Any
from middleware.auth import verify_jwt
from lib.supabase_client import supabase
from lib.encryption import encrypt_token
import httpx

router = APIRouter(prefix="/connections", tags=["Connections"])

@router.get("")
async def get_connections(user: Dict[str, Any] = Depends(verify_jwt)):
    res = supabase.table("platform_connections").select("id, platform, platform_account_name, status, connected_at").eq("user_id", user["user_id"]).execute()
    data = res.data or []
    
    # Verify live WhatsApp gateway readiness
    wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
    for row in data:
        if row.get("platform") == "whatsapp":
            try:
                async with httpx.AsyncClient(timeout=3.5) as client:
                    wa_resp = await client.get(f"{wca_url}/api/status")
                    if wa_resp.status_code == 200:
                        wa_info = wa_resp.json().get("whatsapp", {})
                        if not wa_info.get("isReady"):
                            row["status"] = "needs_relink"
            except Exception:
                row["status"] = "service_offline"
                
    return {"connections": data}

@router.post("/{platform}/start")
async def start_oauth(platform: str, user: Dict[str, Any] = Depends(verify_jwt)):
    backend_url = os.getenv("BACKEND_URL", "https://unai-flow-backend.onrender.com").rstrip("/")
    
    if platform == "twitter":
        client_id = os.getenv("TWITTER_CLIENT_ID")
        redirect_uri = f"{backend_url}/connections/twitter/callback"
        url = f"https://twitter.com/i/oauth2/authorize?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope=tweet.read%20tweet.write%20users.read%20offline.access&state={user['user_id']}&code_challenge=unai_flow_code_verifier_challenge_long_enough_43_chars&code_challenge_method=plain"
        return {"authorization_url": url}
        
    elif platform == "instagram":
        app_id = os.getenv("META_APP_ID")
        redirect_uri = f"{backend_url}/connections/instagram/callback"
        url = f"https://www.facebook.com/v19.0/dialog/oauth?client_id={app_id}&redirect_uri={redirect_uri}&response_type=code&state={user['user_id']}&scope=instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement"
        return {"authorization_url": url}
        
    elif platform == "whatsapp":
        return {"type": "modal", "platform": "whatsapp"}
        
    elif platform == "facebook":
        app_id = os.getenv("META_APP_ID")
        redirect_uri = f"{backend_url}/connections/facebook/callback"
        url = f"https://www.facebook.com/v19.0/dialog/oauth?client_id={app_id}&redirect_uri={redirect_uri}&response_type=code&state={user['user_id']}&scope=pages_manage_posts,pages_read_engagement,pages_show_list"
        return {"authorization_url": url}
        
    raise HTTPException(status_code=400, detail="Unsupported platform")

@router.get("/whatsapp/status")
async def get_whatsapp_status(user: Dict[str, Any] = Depends(verify_jwt)):
    wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{wca_url}/api/status")
            return resp.json()
    except Exception as e:
        return {
            "success": False,
            "whatsapp": {"state": "disconnected", "isReady": False},
            "error": f"Cannot connect to WhatsApp Channel service at {wca_url}"
        }

@router.get("/whatsapp/qr")
async def get_whatsapp_qr(user: Dict[str, Any] = Depends(verify_jwt)):
    wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{wca_url}/api/qr?format=json")
            return resp.json()
    except Exception as e:
        return {"success": False, "message": "WhatsApp service offline"}

@router.get("/whatsapp/qr-image")
async def get_whatsapp_qr_image():
    from fastapi.responses import Response
    wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{wca_url}/api/qr")
            if resp.status_code == 200:
                return Response(content=resp.content, media_type="image/png", headers={"Cache-Control": "no-cache, no-store"})
            return Response(status_code=204, headers={"Cache-Control": "no-cache, no-store"})
    except Exception as e:
        return Response(status_code=204, headers={"Cache-Control": "no-cache, no-store"})

@router.post("/whatsapp/pair-phone")
async def pair_whatsapp_phone(body: dict, user: Dict[str, Any] = Depends(verify_jwt)):
    from fastapi import HTTPException, Response
    wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
    phone = body.get("phone", "")
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number required")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(f"{wca_url}/api/pair-phone", json={"phone": phone})
            if resp.status_code != 200:
                return Response(status_code=resp.status_code, content=resp.content, media_type="application/json")
            return resp.json()
    except Exception as e:
        print(f"Proxy pair-phone error: {e}")
        raise HTTPException(status_code=503, detail="WhatsApp service offline or timed out")

@router.post("/whatsapp/reset")
async def reset_whatsapp_session(user: Dict[str, Any] = Depends(verify_jwt)):
    from fastapi import HTTPException
    wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{wca_url}/api/session/reset")
            return resp.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail="WhatsApp service offline")

@router.get("/whatsapp/channels")
async def get_whatsapp_channels(user: Dict[str, Any] = Depends(verify_jwt)):
    wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{wca_url}/api/channels")
            return resp.json()
    except Exception as e:
        return {
            "success": True,
            "channels": [
                {
                    "id": os.getenv("WHATSAPP_CHANNEL_ID", "0029VbDxqHz6hENhNBcZM31M"),
                    "name": os.getenv("WHATSAPP_CHANNEL_NAME", "Madhan Tech AI"),
                    "link": os.getenv("WHATSAPP_CHANNEL_LINK", "https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M"),
                    "description": "Default Channel",
                    "isDefault": True
                }
            ]
        }

@router.post("/whatsapp/select-channel")
async def select_whatsapp_channel(body: dict, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    wca_key = os.getenv("WCA_API_KEY", "105eadef-beae-4e08-bcc0-85a06ff80727")
    
    channel_id = body.get("channel_id") or os.getenv("WHATSAPP_CHANNEL_ID", "0029VbDxqHz6hENhNBcZM31M")
    channel_name = body.get("channel_name") or os.getenv("WHATSAPP_CHANNEL_NAME", "Madhan Tech AI")
    channel_link = body.get("channel_link") or os.getenv("WHATSAPP_CHANNEL_LINK", "https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M")
    
    encrypted_token = encrypt_token(wca_key)
    
    existing = supabase.table("platform_connections").select("id").eq("user_id", user_id).eq("platform", "whatsapp").execute()
    db_data = {
        "access_token": encrypted_token,
        "platform_account_name": channel_name,
        "platform_account_id": channel_id,
        "status": "active"
    }
    
    if existing.data:
        supabase.table("platform_connections").update(db_data).eq("id", existing.data[0]["id"]).execute()
    else:
        db_data["user_id"] = user_id
        db_data["platform"] = "whatsapp"
        supabase.table("platform_connections").insert(db_data).execute()
        
    return {"success": True, "status": "active", "channel_id": channel_id, "channel_name": channel_name, "channel_link": channel_link}

@router.post("/whatsapp/confirm")
async def confirm_whatsapp_connection(body: dict = None, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    wca_key = os.getenv("WCA_API_KEY", "105eadef-beae-4e08-bcc0-85a06ff80727")
    
    payload = body or {}
    channel_id = payload.get("channel_id") or os.getenv("WHATSAPP_CHANNEL_ID", "0029VbDxqHz6hENhNBcZM31M")
    channel_name = payload.get("channel_name") or os.getenv("WHATSAPP_CHANNEL_NAME", "Madhan Tech AI")
    channel_link = payload.get("channel_link") or os.getenv("WHATSAPP_CHANNEL_LINK", "https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M")
    
    encrypted_token = encrypt_token(wca_key)
    
    existing = supabase.table("platform_connections").select("id").eq("user_id", user_id).eq("platform", "whatsapp").execute()
    db_data = {
        "access_token": encrypted_token,
        "platform_account_name": channel_name,
        "platform_account_id": channel_id,
        "status": "active"
    }
    
    if existing.data:
        supabase.table("platform_connections").update(db_data).eq("id", existing.data[0]["id"]).execute()
    else:
        db_data["user_id"] = user_id
        db_data["platform"] = "whatsapp"
        supabase.table("platform_connections").insert(db_data).execute()
        
    return {"success": True, "status": "active", "channel_id": channel_id, "channel_name": channel_name}

 
@router.get("/{platform}/callback")
async def oauth_callback(platform: str, state: str, code: str = None):
    user_id = state
    backend_url = os.getenv("BACKEND_URL", "https://unai-flow-backend.onrender.com").rstrip("/")
    access_token = None
    platform_account_name = None
    platform_account_id = None
    
    if platform == "twitter":
        client_id = os.getenv("TWITTER_CLIENT_ID")
        client_secret = os.getenv("TWITTER_CLIENT_SECRET")
        token_url = "https://api.twitter.com/2/oauth2/token"
        
        data = {
            "code": code,
            "grant_type": "authorization_code",
            "client_id": client_id,
            "redirect_uri": f"{backend_url}/connections/twitter/callback",
            "code_verifier": "unai_flow_code_verifier_challenge_long_enough_43_chars"
        }
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(token_url, data=data, auth=(client_id, client_secret))
            if resp.status_code != 200:
                print("Twitter Token Error:", resp.text)
                raise HTTPException(status_code=400, detail="Failed to get Twitter access token")
            
            access_token = resp.json().get("access_token")
            refresh_token = resp.json().get("refresh_token")
            
            # Fetch user info
            user_resp = await client.get("https://api.twitter.com/2/users/me", headers={"Authorization": f"Bearer {access_token}"})
            if user_resp.status_code == 200:
                u_data = user_resp.json().get("data", {})
                platform_account_name = f"@{u_data.get('username')}"
                platform_account_id = u_data.get("id")
            
    elif platform == "instagram":
        app_id = os.getenv("META_APP_ID")
        app_secret = os.getenv("META_APP_SECRET")
        redirect_uri = f"{backend_url}/connections/instagram/callback"
        token_url = f"https://graph.facebook.com/v19.0/oauth/access_token?client_id={app_id}&redirect_uri={redirect_uri}&client_secret={app_secret}&code={code}"
        
        async with httpx.AsyncClient() as client:
            resp = await client.get(token_url)
            if resp.status_code != 200:
                print("Instagram Token Error:", resp.text)
                raise HTTPException(status_code=400, detail="Failed to get Instagram access token")
                
            access_token = resp.json().get("access_token")
            refresh_token = resp.json().get("refresh_token")
            
            # Fetch Instagram Business Account ID
            ig_resp = await client.get(f"https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account,name&access_token={access_token}")
            if ig_resp.status_code == 200:
                pages = ig_resp.json().get("data", [])
                for page in pages:
                    if "instagram_business_account" in page:
                        platform_account_id = page["instagram_business_account"]["id"]
                        platform_account_name = page.get("name")
                        break
            
    elif platform == "whatsapp":
        # For WhatsApp we rely on the WHATSAPP_ACCESS_TOKEN env variable due to embedded signup complexities
        access_token = os.getenv("WHATSAPP_ACCESS_TOKEN", "mock_wa_token")
        refresh_token = None
        platform_account_id = os.getenv("WHATSAPP_PHONE_ID", "mock_phone_id")
        platform_account_name = "WhatsApp Business"
        
    elif platform == "facebook":
        app_id = os.getenv("META_APP_ID")
        app_secret = os.getenv("META_APP_SECRET")
        redirect_uri = f"{backend_url}/connections/facebook/callback"
        token_url = f"https://graph.facebook.com/v19.0/oauth/access_token?client_id={app_id}&redirect_uri={redirect_uri}&client_secret={app_secret}&code={code}"
        
        async with httpx.AsyncClient() as client:
            resp = await client.get(token_url)
            if resp.status_code != 200:
                print("Facebook Token Error:", resp.text)
                raise HTTPException(status_code=400, detail="Failed to get Facebook access token")
                
            access_token = resp.json().get("access_token")
            refresh_token = resp.json().get("refresh_token")
            
            # Fetch Facebook Pages managed by the user
            pages_resp = await client.get(f"https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token={access_token}")
            if pages_resp.status_code == 200:
                pages = pages_resp.json().get("data", [])
                if pages:
                    # Use the first page's long-lived token and ID
                    page = pages[0]
                    access_token = page["access_token"]  # Page-level token
                    platform_account_id = page["id"]
                    platform_account_name = page.get("name", "Facebook Page")
        
    if not access_token:
        raise HTTPException(status_code=400, detail="Failed to acquire access token")
 
    encrypted_token = encrypt_token(access_token)
    encrypted_refresh = encrypt_token(refresh_token) if refresh_token else None
    
    # Store in Supabase
    existing = supabase.table("platform_connections").select("id").eq("user_id", user_id).eq("platform", platform).execute()
    
    db_data = {
        "access_token": encrypted_token,
        "platform_account_name": platform_account_name,
        "platform_account_id": platform_account_id,
        "status": "active"
    }
    if encrypted_refresh:
        db_data["refresh_token"] = encrypted_refresh
 
    if existing.data:
        supabase.table("platform_connections").update(db_data).eq("id", existing.data[0]["id"]).execute()
    else:
        db_data["user_id"] = user_id
        db_data["platform"] = platform
        supabase.table("platform_connections").insert(db_data).execute()
    
    frontend_url = os.getenv("FRONTEND_URL", "https://unai-flow-rc39.vercel.app")
    return RedirectResponse(url=f"{frontend_url}/connections?success=true")

@router.delete("/{platform}")
async def disconnect_platform(platform: str, user: Dict[str, Any] = Depends(verify_jwt)):
    if platform == "whatsapp":
        wca_url = os.getenv("WCA_API_URL", "https://unai-whatsapp-channelapi.onrender.com").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                await client.post(f"{wca_url}/api/logout")
        except Exception as e:
            pass

    supabase.table("platform_connections").delete().eq("user_id", user["user_id"]).eq("platform", platform).execute()
    return {"status": "success"}
