from typing import Dict, Any, Optional
from app.database.supabase import get_supabase_client
import uuid

class Publisher:
    def __init__(self):
        self.sb = get_supabase_client()

    def enqueue_job(self, user_id: str, channel_id: str, post_type: str, payload: Dict[str, Any], idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Creates a publish job in the queue.
        """
        # If idempotency_key is provided, check for existing job
        if idempotency_key:
            res = self.sb.table("whatsapp_publish_jobs").select("*").eq("idempotency_key", idempotency_key).execute()
            if res.data and len(res.data) > 0:
                return {"success": True, "job": res.data[0], "status": res.data[0]["status"], "job_id": res.data[0]["id"]}

        data = {
            "user_id": user_id,
            "channel_id": channel_id,
            "type": post_type,
            "payload": payload,
            "status": "QUEUED",
            "idempotency_key": idempotency_key or str(uuid.uuid4())
        }
        
        res = self.sb.table("whatsapp_publish_jobs").insert(data).execute()
        job = res.data[0]
        
        return {"success": True, "job_id": job["id"], "status": job["status"], "job": job}

    def get_job_status(self, user_id: str, job_id: str) -> Dict[str, Any]:
        res = self.sb.table("whatsapp_publish_jobs").select("*").eq("id", job_id).eq("user_id", user_id).execute()
        if not res.data:
            return {"success": False, "error": "Job not found"}
        return {"success": True, "data": res.data[0]}
