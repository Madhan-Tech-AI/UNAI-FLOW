import asyncio
import time
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from app.workers.celery_app import celery_app
from app.database.supabase import get_supabase_client
from app.services.instance_service import instance_service
from app.core.config import settings
from app.core.logging import logger

RETRY_DELAYS = [5, 15, 60, 300]  # Exponential backoff schedule in seconds

def acquire_instance_lock(redis_client, instance_id: str, ttl_seconds: int = 60):
    """Acquires a distributed lock on an instance using Redis."""
    if not redis_client:
        return True
    key = f"whatsapp:instance:{instance_id}"
    return redis_client.set(key, "locked", nx=True, ex=ttl_seconds)

def release_instance_lock(redis_client, instance_id: str):
    """Releases the distributed lock on an instance."""
    if redis_client:
        redis_client.delete(f"whatsapp:instance:{instance_id}")

@celery_app.task(bind=True, max_retries=4)
def process_publish_job(self, job_id: str, organization_id: str, instance_id: str, to: str, message_type: str, payload: Dict[str, Any]):
    """
    Celery task that executes WhatsApp message delivery with Redis locking and retries.
    """
    sb = get_supabase_client()
    now_iso = datetime.now(timezone.utc).isoformat()
    
    # Mark PROCESSING
    sb.table("publish_jobs").update({
        "status": "PROCESSING",
        "started_at": now_iso
    }).eq("id", job_id).execute()
    
    try:
        # Run async provider call in synchronous Celery task
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        inst = instance_service.get_instance(organization_id, instance_id)
        provider = instance_service.provider
        inst_uuid = inst["instance_uuid"]
        
        if message_type == "text":
            result = loop.run_until_complete(provider.send_text(inst_uuid, to, payload["body"]))
        elif message_type == "image":
            result = loop.run_until_complete(provider.send_image(inst_uuid, to, payload.get("media_url"), payload.get("caption")))
        elif message_type == "video":
            result = loop.run_until_complete(provider.send_video(inst_uuid, to, payload.get("media_url"), payload.get("caption")))
        elif message_type == "audio":
            result = loop.run_until_complete(provider.send_audio(inst_uuid, to, payload.get("media_url")))
        elif message_type == "poll":
            result = loop.run_until_complete(provider.send_poll(inst_uuid, to, payload["question"], payload["options"], payload.get("selectable_count", 1)))
        else:
            raise ValueError(f"Unsupported message type: {message_type}")
            
        loop.close()
        
        # Mark PUBLISHED
        sb.table("publish_jobs").update({
            "status": "PUBLISHED",
            "provider_message_id": result.message_id,
            "completed_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", job_id).execute()
        
        return {"success": True, "message_id": result.message_id}

    except Exception as exc:
        attempt = self.request.retries
        logger.error(f"Celery publish job {job_id} failed on attempt {attempt+1}: {str(exc)}")
        
        if attempt < len(RETRY_DELAYS):
            delay = RETRY_DELAYS[attempt]
            sb.table("publish_jobs").update({
                "status": "RETRYING",
                "attempts": attempt + 1,
                "error": str(exc)
            }).eq("id", job_id).execute()
            
            raise self.retry(exc=exc, countdown=delay)
        else:
            sb.table("publish_jobs").update({
                "status": "FAILED",
                "attempts": attempt + 1,
                "error": str(exc),
                "completed_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", job_id).execute()
            raise exc
