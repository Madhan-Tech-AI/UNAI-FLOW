from typing import Dict, Any
from adapters.twitter_adapter import TwitterAdapter
from adapters.instagram_adapter import InstagramAdapter
from adapters.whatsapp_adapter import WhatsAppAdapter
from lib.supabase_client import supabase

ADAPTERS = {
    "twitter": TwitterAdapter(),
    "instagram": InstagramAdapter(),
    "whatsapp": WhatsAppAdapter()
}

async def orchestrate_publish(automation_id: str, user_id: str):
    # Fetch all approved variants for this automation
    res = supabase.table("content_variants").select("*").eq("automation_id", automation_id).execute()
    if not res.data:
        raise ValueError("No variants found for this automation")
        
    variants = res.data
    
    for variant in variants:
        platform = variant["platform"]
        content = variant["generated_text"]
        
        # 1. Create a publish job
        job_res = supabase.table("publish_jobs").insert({
            "automation_id": automation_id,
            "variant_id": variant["id"],
            "platform": platform,
            "status": "processing"
        }).execute()
        job_id = job_res.data[0]["id"]
        
        adapter = ADAPTERS.get(platform)
        if not adapter:
            _mark_failed(job_id, "Unsupported platform adapter")
            continue
            
        try:
            # 2. Call the adapter
            result = await adapter.publish(content, user_id, automation_id)
            
            # 3. Mark success
            supabase.table("publish_jobs").update({
                "status": "success",
                "platform_post_id": result.get("post_id"),
                "platform_post_url": result.get("post_url"),
                "attempts": 1
            }).eq("id", job_id).execute()
            
        except Exception as e:
            _mark_failed(job_id, str(e))
            
    # Log the general event
    platforms = [v["platform"] for v in variants]
    supabase.table("automation_logs").insert({
        "automation_id": automation_id,
        "event": "published",
        "meta": {"platforms": platforms, "orchestrator": "Phase4"}
    }).execute()
    
    # Update the automation status to published
    supabase.table("automations").update({"status": "published"}).eq("id", automation_id).execute()

def _mark_failed(job_id: str, error_msg: str):
    supabase.table("publish_jobs").update({
        "status": "failed",
        "error_message": error_msg,
        "attempts": 1
    }).eq("id", job_id).execute()
