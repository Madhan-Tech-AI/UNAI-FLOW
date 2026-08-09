from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any
from middleware.auth import verify_jwt
from schemas.automations import AutomationCreate
from lib.supabase_client import supabase
from services.customization_engine import generate_variants
from services.orchestrator import orchestrate_publish

router = APIRouter(prefix="/automations", tags=["Automations"])

@router.post("")
async def create_automation(automation: AutomationCreate, user: Dict[str, Any] = Depends(verify_jwt)):
    data = automation.model_dump()
    data["user_id"] = user["user_id"]
    
    res = supabase.table("automations").insert(data).execute()
    if not res.data:
        raise HTTPException(status_code=400, detail="Could not create automation")
        
    return res.data[0]

@router.post("/{automation_id}/generate")
async def run_generation(automation_id: str, user: Dict[str, Any] = Depends(verify_jwt)):
    # Generate variants via Customization Engine
    variants = await generate_variants(automation_id, user["user_id"])
    
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
        
    # 2. Trigger Orchestrator
    # For Phase 4 we run it synchronously. For production scale (v2) this should be a Celery task
    await orchestrate_publish(automation_id, user["user_id"])
    
    return {"status": "success"}
