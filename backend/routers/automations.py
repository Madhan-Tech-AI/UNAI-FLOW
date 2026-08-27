from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
import base64
import uuid
from middleware.auth import verify_jwt
from schemas.automations import AutomationCreate
from lib.supabase_client import supabase
from services.customization_engine import generate_variants
from services.orchestrator import orchestrate_publish

router = APIRouter(prefix="/automations", tags=["Automations"])

def upload_base64_to_supabase(base64_str: str) -> str:
    header, encoded = base64_str.split(",", 1)
    mime_type = header.split(";")[0].split(":")[1]
    ext = mime_type.split("/")[1]
    
    file_bytes = base64.b64decode(encoded)
    file_name = f"{uuid.uuid4()}.{ext}"
    file_path = f"uploads/{file_name}"
    
    supabase.storage.from_("media").upload(
        path=file_path,
        file=file_bytes,
        file_options={"content-type": mime_type}
    )
    
    public_url = supabase.storage.from_("media").get_public_url(file_path)
    return public_url

@router.post("")
async def create_automation(automation: AutomationCreate, user: Dict[str, Any] = Depends(verify_jwt)):
    data = automation.model_dump()
    data["user_id"] = user["user_id"]
    
    media_url = data.get("media_url")
    if media_url and media_url.startswith("data:"):
        try:
            public_url = upload_base64_to_supabase(media_url)
            data["media_url"] = public_url
        except Exception as e:
            print(f"Warning: Failed to upload media base64 to Supabase storage: {e}")

    wa_channel_id = data.get("whatsapp_channel_id")
    if wa_channel_id:
        try:
            supabase.table("channels").update({"is_selected": False}).neq("channel_id", "").execute()
            supabase.table("channels").update({"is_selected": True}).eq("channel_id", wa_channel_id).execute()
        except Exception as e:
            print(f"Warning: Failed to update channel selection: {e}")

    try:
        res = supabase.table("automations").insert(data).execute()
    except Exception as e:
        # If DB schema lacks whatsapp_channel_id column, fallback cleanly
        if "whatsapp_channel_id" in data:
            data_fallback = {k: v for k, v in data.items() if k != "whatsapp_channel_id"}
            res = supabase.table("automations").insert(data_fallback).execute()
        else:
            raise e

    if not res.data:
        raise HTTPException(status_code=400, detail="Could not create automation")
        
    return res.data[0]

@router.post("/{automation_id}/generate")
async def run_generation(automation_id: str, user: Dict[str, Any] = Depends(verify_jwt)):
    # Generate variants via Customization Engine
    try:
        variants = await generate_variants(automation_id, user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # Log the event
    supabase.table("automation_logs").insert({
        "automation_id": automation_id,
        "event": "generated",
        "meta": {"platforms": [v["platform"] for v in variants]}
    }).execute()
    
    return {"variants": variants}

@router.post("/{automation_id}/publish")
async def publish_automation(automation_id: str, user: Dict[str, Any] = Depends(verify_jwt)):
    # 1. Verify ownership
    res = supabase.table("automations").select("*").eq("id", automation_id).eq("user_id", user["user_id"]).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Automation not found")
        
    # 2. Trigger Orchestrator and get detailed results
    try:
        results = await orchestrate_publish(automation_id, user["user_id"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    # 3. Return detailed per-platform results
    real_successes = [r for r in results if r["status"] == "success"]
    demo_publishes = [r for r in results if r.get("demo_mode")]
    failures = [r for r in results if r["status"] == "failed"]
    
    return {
        "status": "success" if real_successes else "demo",
        "message": f"{len(real_successes)} platform(s) published live, {len(demo_publishes)} in demo mode, {len(failures)} failed.",
        "results": results
    }
