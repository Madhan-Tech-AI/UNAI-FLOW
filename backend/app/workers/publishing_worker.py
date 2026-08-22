import asyncio
import traceback
from datetime import datetime
from app.database.supabase import get_supabase_client
from app.providers.whatsapp.session_provider import WhatsAppWebSessionProvider
from app.core.config import settings

class PublishingWorker:
    def __init__(self):
        self.sb = get_supabase_client()
        self.provider = WhatsAppWebSessionProvider()
        self.running = False

    async def start(self):
        self.running = True
        while self.running:
            try:
                await self.process_queue()
            except Exception as e:
                pass
            await asyncio.sleep(5)  # Poll every 5 seconds

    def stop(self):
        self.running = False

    async def process_queue(self):
        # 1. Get queued jobs
        try:
            res = self.sb.table("whatsapp_publish_jobs").select("*").eq("status", "QUEUED").limit(1).execute()
            if not res.data:
                return
                
            job = res.data[0]
            job_id = job["id"]
            
            # 2. Mark PROCESSING
            self.sb.table("whatsapp_publish_jobs").update({
                "status": "PROCESSING",
                "started_at": datetime.utcnow().isoformat()
            }).eq("id", job_id).execute()
            
            # 3. Get channel details to get external channel_id
            ch_res = self.sb.table("channels").select("channel_id, whatsapp_session_id").eq("id", job["channel_id"]).execute()
            if not ch_res.data:
                raise ValueError("Channel not found")
                
            external_channel_id = ch_res.data[0]["channel_id"]
            session_id = ch_res.data[0]["whatsapp_session_id"]
            
            sess_res = self.sb.table("whatsapp_sessions").select("session_identifier").eq("id", session_id).execute()
            if not sess_res.data:
                raise ValueError("Session not found")
                
            session_identifier = sess_res.data[0]["session_identifier"]
            
            # 4. Publish
            if job["type"] == "text":
                result = await self.provider.send_text(session_identifier, external_channel_id, job["payload"]["body"])
            else:
                raise ValueError(f"Unsupported job type: {job['type']}")
                
            # 5. Mark SENT
            self.sb.table("whatsapp_publish_jobs").update({
                "status": "SENT",
                "completed_at": datetime.utcnow().isoformat(),
                "message_id": result.message_id
            }).eq("id", job_id).execute()
        except Exception as e:
            pass
