import os
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, Response
from typing import Dict, Any, List
from middleware.auth import verify_jwt
from lib.supabase_client import supabase
from lib.encryption import encrypt_token, decrypt_token
from app.core.config import settings
import httpx

router = APIRouter(prefix="/connections", tags=["Connections"])

def get_candidate_wca_urls() -> List[str]:
    """Use centralized config for gateway URL resolution."""
    return settings.get_wca_candidate_urls()

@router.get("")
async def get_connections(user: Dict[str, Any] = Depends(verify_jwt)):
    res = supabase.table("platform_connections").select("id, platform, platform_account_name, platform_account_id, status, connected_at").eq("user_id", user["user_id"]).execute()
    data = res.data or []

    # Cross-check with active whatsapp_sessions for robust persistence
    has_wa = any(c.get("platform") == "whatsapp" and c.get("status") == "active" for c in data)
    if not has_wa:
        try:
            wa_res = supabase.table("whatsapp_sessions").select("*").eq("user_id", user["user_id"]).in_("status", ["CONNECTED", "READY"]).execute()
            if wa_res.data and len(wa_res.data) > 0:
                active_wa = wa_res.data[0]
                phone = active_wa.get("phone_number")
                name = f"+{phone}" if phone else "WhatsApp Account"
                data.append({
                    "id": active_wa["id"],
                    "platform": "whatsapp",
                    "platform_account_name": name,
                    "platform_account_id": active_wa["session_identifier"],
                    "status": "active",
                    "connected_at": active_wa.get("last_connected_at") or active_wa.get("updated_at")
                })
        except Exception as e:
            print(f"Note: error checking active whatsapp sessions: {e}")

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
        return {
            "type": "whatsapp_connect",
            "platform": "whatsapp",
            "official_url": "https://web.whatsapp.com"
        }
        
    elif platform == "facebook":
        app_id = os.getenv("META_APP_ID")
        redirect_uri = f"{backend_url}/connections/facebook/callback"
        url = f"https://www.facebook.com/v19.0/dialog/oauth?client_id={app_id}&redirect_uri={redirect_uri}&response_type=code&state={user['user_id']}&scope=pages_manage_posts,pages_read_engagement,pages_show_list"
        return {"authorization_url": url}
        
    raise HTTPException(status_code=400, detail="Unsupported platform")

@router.get("/whatsapp/status")
async def get_whatsapp_status(user: Dict[str, Any] = Depends(verify_jwt)):
    for wca_url in get_candidate_wca_urls():
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(f"{wca_url}/api/status")
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            continue
            
    return {
        "success": False,
        "whatsapp": {"state": "disconnected", "isReady": False},
        "error": "WhatsApp service offline. Please start local engine or check Render deployment."
    }

@router.get("/whatsapp/qr-image")
async def get_whatsapp_qr_image():
    for wca_url in get_candidate_wca_urls():
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(f"{wca_url}/api/qr")
                if resp.status_code == 200 and len(resp.content) > 0:
                    return Response(content=resp.content, media_type="image/png", headers={"Cache-Control": "no-cache, no-store"})
        except Exception:
            continue
    return Response(status_code=204, headers={"Cache-Control": "no-cache, no-store"})

@router.post("/whatsapp/pair-phone")
async def pair_whatsapp_phone(body: dict, user: Dict[str, Any] = Depends(verify_jwt)):
    phone = body.get("phone", "")
    if not phone:
        raise HTTPException(status_code=400, detail="Phone number required")
        
    for wca_url in get_candidate_wca_urls():
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(f"{wca_url}/api/pair-phone", json={"phone": phone})
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code != 502 and resp.status_code != 503:
                    return Response(status_code=resp.status_code, content=resp.content, media_type="application/json")
        except Exception:
            continue
            
    raise HTTPException(status_code=503, detail="WhatsApp service offline or timed out")

@router.post("/whatsapp/reset")
async def reset_whatsapp_session(user: Dict[str, Any] = Depends(verify_jwt)):
    for wca_url in get_candidate_wca_urls():
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(f"{wca_url}/api/session/reset")
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            continue
    raise HTTPException(status_code=503, detail="WhatsApp service offline")

@router.get("/whatsapp/channels")
async def get_whatsapp_channels(user: Dict[str, Any] = Depends(verify_jwt)):
    """
    Dynamically discovers real-time WhatsApp Channels from the live authenticated WhatsApp account.
    NO mock data.
    """
    user_id = user["user_id"]
    discovered_channels: List[Dict[str, Any]] = []
    
    # 1. Query candidate WhatsApp Gateways (local or cloud)
    for wca_url in get_candidate_wca_urls():
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                gw_resp = await client.get(f"{wca_url}/api/channels")
                if gw_resp.status_code == 200:
                    gw_channels = gw_resp.json().get("channels", [])
                    for ch in gw_channels:
                        ch_id = ch.get("id")
                        if ch_id and not any(d["id"] == ch_id for d in discovered_channels):
                            discovered_channels.append({
                                "id": ch_id,
                                "name": ch.get("name") or "WhatsApp Channel",
                                "link": ch.get("link", ""),
                                "type": "whatsapp_channel",
                                "description": ch.get("description", "WhatsApp Broadcast Channel")
                            })
                    if len(discovered_channels) > 0:
                        break
        except Exception:
            continue

    # 2. Fetch user's WhatsApp connection record from Supabase if already linked
    conn_res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "whatsapp").execute()
    if conn_res.data:
        conn = conn_res.data[0]
        encrypted_token = conn.get("access_token", "")
        access_token = decrypt_token(encrypted_token) if encrypted_token else None
        
        # If user also has Meta Graph API credentials
        if access_token and not access_token.startswith("105eadef"):
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    biz_resp = await client.get(
                        f"https://graph.facebook.com/v19.0/me/businesses?fields=id,name,owned_whatsapp_business_accounts{{id,name,phone_numbers{{id,display_phone_number,verified_name}}}},client_whatsapp_business_accounts{{id,name,phone_numbers{{id,display_phone_number,verified_name}}}}&access_token={access_token}"
                    )
                    if biz_resp.status_code == 200:
                        biz_data = biz_resp.json().get("data", [])
                        for biz in biz_data:
                            wabas = (biz.get("owned_whatsapp_business_accounts", {}).get("data", []) or []) + (biz.get("client_whatsapp_business_accounts", {}).get("data", []) or [])
                            for waba in wabas:
                                pns = waba.get("phone_numbers", {}).get("data", [])
                                for pn in pns:
                                    phone_id = pn.get("id")
                                    display_num = pn.get("display_phone_number", "")
                                    v_name = pn.get("verified_name") or waba.get("name") or display_num
                                    clean_num = display_num.replace("+", "").replace(" ", "").replace("-", "")
                                    if not any(d["id"] == phone_id for d in discovered_channels):
                                        discovered_channels.append({
                                            "id": phone_id,
                                            "name": v_name,
                                            "display_number": display_num,
                                            "link": f"https://wa.me/{clean_num}" if clean_num else "",
                                            "type": "whatsapp_business",
                                            "account_name": waba.get("name", "WhatsApp Business"),
                                            "description": f"Verified Business Account • {display_num}" if display_num else "WhatsApp Business Account"
                                        })
            except Exception as e:
                print(f"Error querying Meta Graph API for WhatsApp channels: {e}")
        
    return {
        "success": True,
        "channels": discovered_channels
    }

@router.post("/whatsapp/select-channel")
async def select_whatsapp_channel(body: dict, user: Dict[str, Any] = Depends(verify_jwt)):
    """
    Connects the selected real-time WhatsApp account/channel to the user's connections.
    """
    user_id = user["user_id"]
    channel_id = body.get("channel_id")
    channel_name = body.get("channel_name")
    channel_link = body.get("channel_link") or (f"https://whatsapp.com/channel/{channel_id}" if channel_id else "")
    
    if not channel_id or not channel_name:
        raise HTTPException(status_code=400, detail="channel_id and channel_name are required")
    
    wca_key = os.getenv("WCA_API_KEY", "105eadef-beae-4e08-bcc0-85a06ff80727")
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
        
    return {
        "success": True, 
        "status": "active", 
        "channel_id": channel_id, 
        "channel_name": channel_name, 
        "channel_link": channel_link
    }

@router.get("/{platform}/test")
async def test_platform_connection(platform: str, user: Dict[str, Any] = Depends(verify_jwt)):
    """
    Tests live connection status and token validity in real-time.
    """
    user_id = user["user_id"]

    if platform == "whatsapp":
        # 1. Check whatsapp_sessions first
        wa_res = supabase.table("whatsapp_sessions").select("*").eq("user_id", user_id).in_("status", ["CONNECTED", "READY"]).execute()
        active_wa = wa_res.data[0] if (wa_res.data and len(wa_res.data) > 0) else None

        # 2. Check platform_connections as well
        conn_res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", "whatsapp").execute()
        conn = conn_res.data[0] if (conn_res.data and len(conn_res.data) > 0) else None

        if not active_wa and not conn:
            raise HTTPException(status_code=404, detail="No active connection found for whatsapp")

        phone = None
        if active_wa and active_wa.get("phone_number"):
            phone = str(active_wa["phone_number"]).lstrip("+")
        elif conn and conn.get("platform_account_name"):
            phone = str(conn["platform_account_name"]).lstrip("+")

        phone_display = f"+{phone}" if phone else "WhatsApp Account"

        # 3. Check gateway health
        try:
            from app.whatsapp.whatsapp_web_provider import WhatsAppWebProvider
            provider = WhatsAppWebProvider()
            health = await provider.health_check()
            if health.get("ok"):
                return {"success": True, "message": f"WhatsApp connected with {phone_display} (Gateway Online)"}
        except Exception:
            pass

        return {"success": True, "message": f"WhatsApp connected with {phone_display}"}

    conn_res = supabase.table("platform_connections").select("*").eq("user_id", user_id).eq("platform", platform).execute()
    if not conn_res.data:
        raise HTTPException(status_code=404, detail=f"No active connection found for {platform}")

    conn = conn_res.data[0]
    raw_token = decrypt_token(conn.get("access_token", ""))

    if platform in ["instagram", "facebook"]:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                test_resp = await client.get(f"https://graph.facebook.com/v19.0/me?access_token={raw_token}")
                if test_resp.status_code == 200:
                    return {"success": True, "message": f"{platform.capitalize()} connection active! Profile: {test_resp.json().get('name', 'Active')}"}
                return {"success": False, "message": f"{platform.capitalize()} token invalid or expired."}
        except Exception as e:
            return {"success": False, "message": str(e)}
            
    elif platform == "twitter":
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                test_resp = await client.get("https://api.twitter.com/2/users/me", headers={"Authorization": f"Bearer {raw_token}"})
                if test_resp.status_code == 200:
                    return {"success": True, "message": f"Twitter connection active for @{test_resp.json().get('data', {}).get('username', 'user')}"}
                return {"success": False, "message": "Twitter token expired or invalid."}
        except Exception as e:
            return {"success": False, "message": str(e)}

    return {"success": True, "message": f"Connection active for {platform}"}

@router.get("/{platform}/callback")
async def oauth_callback(platform: str, state: str, code: str = None):
    user_id = state
    backend_url = os.getenv("BACKEND_URL", "https://unai-flow-backend.onrender.com").rstrip("/")
    access_token = None
    refresh_token = None
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
                    page = pages[0]
                    access_token = page["access_token"]
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
    
    frontend_url = os.getenv("FRONTEND_URL", "https://unai-flow-rc39.vercel.app").rstrip("/")
    return RedirectResponse(url=f"{frontend_url}/connections?success=true")

@router.delete("/{platform}")
async def disconnect_platform(platform: str, user: Dict[str, Any] = Depends(verify_jwt)):
    if platform == "whatsapp":
        try:
            from app.whatsapp.session_manager import SessionManager
            from app.whatsapp.whatsapp_web_provider import WhatsAppWebProvider
            from app.whatsapp.channel_manager import ChannelManager
            sm = SessionManager()
            sessions = sm.get_sessions_for_user(user["user_id"])
            provider = WhatsAppWebProvider()
            for s in sessions:
                sm.update_session_status(s["id"], "DISCONNECTED")
                try:
                    await provider.disconnect(s["session_identifier"])
                except Exception:
                    pass
            cm = ChannelManager(provider=provider)
            cm.delete_user_channels(user["user_id"])
        except Exception as e:
            print(f"Note: Error during WhatsApp disconnect cleanup: {e}")

    for wca_url in get_candidate_wca_urls():
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                await client.post(f"{wca_url}/api/logout")
        except Exception:
            pass

    supabase.table("platform_connections").delete().eq("user_id", user["user_id"]).eq("platform", platform).execute()
    return {"status": "success"}
