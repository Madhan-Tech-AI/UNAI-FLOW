from typing import Dict, Any, List
from adapters.twitter_adapter import TwitterAdapter
from adapters.instagram_adapter import InstagramAdapter
from adapters.facebook_adapter import FacebookAdapter
from adapters.whatsapp_adapter import WhatsAppAdapter
from lib.supabase_client import supabase

ADAPTERS = {
    "twitter": TwitterAdapter(),
    "instagram": InstagramAdapter(),
    "facebook": FacebookAdapter(),
    "whatsapp": WhatsAppAdapter()
}

async def orchestrate_publish(automation_id: str, user_id: str) -> List[Dict[str, Any]]:
    # Fetch all approved variants for this automation
    res = supabase.table("content_variants").select("*").eq("automation_id", automation_id).execute()
    if not res.data:
        raise ValueError("No variants found for this automation")
        
    variants = res.data
    results = []
    
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
            results.append({"platform": platform, "status": "failed", "error": "Unsupported platform", "demo_mode": False})
            continue
            
        try:
            # 2. Call the adapter
            result = await adapter.publish(content, user_id, automation_id)
            
            post_id = result.get("post_id", "")
            is_demo = str(post_id).startswith("demo_")
            
            # 3. Mark success in publish_jobs (DB only allows: queued/processing/success/failed)
            supabase.table("publish_jobs").update({
                "status": "success",
                "platform_post_id": post_id,
                "platform_post_url": result.get("post_url"),
                "attempts": 1
            }).eq("id", job_id).execute()
            
            results.append({
                "platform": platform,
                "status": "success" if not is_demo else "demo",
                "post_id": post_id,
                "post_url": result.get("post_url"),
                "demo_mode": is_demo
            })
            
            # 4. If it's a real publish, store in published_posts table
            if not is_demo:
                try:
                    supabase.table("published_posts").insert({
                        "automation_id": automation_id,
                        "variant_id": variant["id"],
                        "platform": platform,
                        "post_id": post_id,
                        "post_url": result.get("post_url"),
                        "content": content
                    }).execute()
                except Exception as db_err:
                    print(f"Warning: Failed to save to published_posts table: {db_err}")
            
        except Exception as e:
            _mark_failed(job_id, str(e))
            results.append({"platform": platform, "status": "failed", "error": str(e), "demo_mode": False})
            
    # Log the general event
    platforms = [v["platform"] for v in variants]
    has_real_success = any(r["status"] == "success" for r in results)
    event_type = "published" if has_real_success else "demo_published"
    
    supabase.table("automation_logs").insert({
        "automation_id": automation_id,
        "event": event_type,
        "meta": {
            "platforms": platforms,
            "results": results,
            "orchestrator": "Phase4"
        }
    }).execute()
    
    # Update the automation status
    try:
        new_status = "published" if has_real_success else "demo_published"
        supabase.table("automations").update({"status": new_status}).eq("id", automation_id).execute()
    except Exception as e:
        print(f"Warning: Could not update automation status: {e}")

    # 5. Call the Supabase Edge Function to log/process the results
    import httpx
    try:
        edge_url = f"{supabase.supabase_url}/functions/v1/publish-handler"
        headers = {
            "Authorization": f"Bearer {supabase.supabase_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "automation_id": automation_id,
            "event": event_type,
            "results": results
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            await client.post(edge_url, headers=headers, json=payload)
    except Exception as edge_err:
        print(f"Warning: Failed to call Supabase Edge Function: {edge_err}")

    return results

def _mark_failed(job_id: str, error_msg: str):
    supabase.table("publish_jobs").update({
        "status": "failed",
        "error_message": error_msg,
        "attempts": 1
    }).eq("id", job_id).execute()
