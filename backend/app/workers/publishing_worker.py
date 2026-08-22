import asyncio
import traceback
import uuid
from datetime import datetime, timezone
from app.database.supabase import get_supabase_client
from app.whatsapp.whatsapp_web_provider import WhatsAppWebProvider
from app.core.logging import logger


class PublishingWorker:
    """
    Polls whatsapp_publish_jobs for QUEUED jobs and processes them
    using the WhatsAppWebProvider (legacy pipeline → WCA service).

    Features:
    - Atomic job claiming (conditional UPDATE with worker_id)
    - Exponential backoff when idle (5s → 10s → 30s → 60s)
    - Full pipeline logging
    - Never swallows exceptions
    """

    def __init__(self):
        self.sb = get_supabase_client()
        self.provider = WhatsAppWebProvider()
        self.running = False
        self.worker_id = f"worker_{uuid.uuid4().hex[:8]}"
        self._idle_count = 0  # Tracks consecutive empty polls for backoff

    async def start(self):
        self.running = True
        logger.info(f"[WORKER] PublishingWorker {self.worker_id} started.")
        while self.running:
            try:
                processed = await self.process_queue()
                if processed:
                    self._idle_count = 0  # Reset backoff on successful processing
                else:
                    self._idle_count += 1
            except Exception as e:
                logger.error(f"[WORKER] Unhandled error in process_queue: {e}\n{traceback.format_exc()}")
                self._idle_count += 1

            # Exponential backoff: 5s → 10s → 30s → 60s max
            if self._idle_count <= 1:
                sleep_time = 5
            elif self._idle_count <= 5:
                sleep_time = 10
            elif self._idle_count <= 20:
                sleep_time = 30
            else:
                sleep_time = 60
            await asyncio.sleep(sleep_time)

    def stop(self):
        self.running = False
        logger.info(f"[WORKER] PublishingWorker {self.worker_id} stopping.")

    async def process_queue(self) -> bool:
        """Returns True if a job was processed, False if queue was empty."""

        # 1. Find a QUEUED job
        try:
            res = self.sb.table("whatsapp_publish_jobs") \
                .select("*") \
                .eq("status", "QUEUED") \
                .limit(1) \
                .execute()
        except Exception as e:
            logger.error(f"[WORKER] Failed to query job queue: {e}")
            return False

        if not res.data:
            return False  # No jobs — caller will backoff

        job = res.data[0]
        job_id = job["id"]
        logger.info(f"[WORKER] JOB_FOUND job={job_id} type={job.get('type', 'text')}")

        # 2. Atomic claim: UPDATE only if still QUEUED (prevents double-claiming)
        try:
            claim_res = self.sb.table("whatsapp_publish_jobs").update({
                "status": "PROCESSING",
                "started_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).eq("status", "QUEUED").execute()

            if not claim_res.data:
                logger.warning(f"[WORKER] JOB_CLAIM_FAILED job={job_id} (already claimed by another worker)")
                return False

            logger.info(f"[WORKER] JOB_CLAIMED job={job_id}")
        except Exception as e:
            logger.error(f"[WORKER] Failed to claim job {job_id}: {e}")
            return False

        # 3. Resolve channel details
        try:
            ch_res = self.sb.table("channels") \
                .select("channel_id, whatsapp_session_id") \
                .eq("id", job["channel_id"]) \
                .execute()

            if not ch_res.data:
                raise ValueError(f"Channel {job['channel_id']} not found in channels table")

            external_channel_id = ch_res.data[0]["channel_id"]
            session_id = ch_res.data[0]["whatsapp_session_id"]
            logger.info(f"[WORKER] CHANNEL_RESOLVED job={job_id} channel={external_channel_id}")
        except Exception as e:
            logger.error(f"[WORKER] CHANNEL_RESOLVE_FAILED job={job_id}: {e}")
            self._mark_failed(job_id, str(e))
            return True  # Job was processed (failed)

        # 4. Resolve session identifier
        try:
            sess_res = self.sb.table("whatsapp_sessions") \
                .select("session_identifier, status") \
                .eq("id", session_id) \
                .execute()

            if not sess_res.data:
                raise ValueError(f"Session {session_id} not found")

            session_identifier = sess_res.data[0]["session_identifier"]
            session_status = sess_res.data[0].get("status", "UNKNOWN")

            if session_status != "CONNECTED":
                raise ValueError(f"Session {session_identifier} is not CONNECTED (status={session_status})")

            logger.info(f"[WORKER] SESSION_LOADED job={job_id} session={session_identifier} status={session_status}")
        except Exception as e:
            logger.error(f"[WORKER] SESSION_LOAD_FAILED job={job_id}: {e}")
            self._mark_failed(job_id, str(e))
            return True

        # 5. Send via WhatsAppWebProvider → WCA service
        try:
            payload = job.get("payload", {})
            job_type = job.get("type", "text")

            logger.info(f"[WORKER] SENDING job={job_id} type={job_type} session={session_identifier} channel={external_channel_id}")

            if job_type == "text":
                body = payload.get("body", "")
                result = await self.provider.publish_text(session_identifier, external_channel_id, body)
            elif job_type == "image":
                result = await self.provider.publish_image(
                    session_identifier, external_channel_id,
                    payload.get("media_url", ""), payload.get("caption", "")
                )
            elif job_type == "video":
                result = await self.provider.publish_video(
                    session_identifier, external_channel_id,
                    payload.get("media_url", ""), payload.get("caption", "")
                )
            else:
                raise ValueError(f"Unsupported job type: {job_type}")

            message_id = result.get("messageId") or result.get("id") or f"msg_{uuid.uuid4().hex[:8]}"
            logger.info(f"[WORKER] PROVIDER_ACCEPTED job={job_id} message_id={message_id}")

        except Exception as e:
            logger.error(f"[WORKER] SEND_FAILED job={job_id}: {e}\n{traceback.format_exc()}")
            self._mark_failed(job_id, str(e))
            return True

        # 6. Mark PUBLISHED
        try:
            self.sb.table("whatsapp_publish_jobs").update({
                "status": "PUBLISHED",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "message_id": message_id,
            }).eq("id", job_id).execute()

            logger.info(f"[WORKER] JOB_PUBLISHED job={job_id} message_id={message_id}")
        except Exception as e:
            logger.error(f"[WORKER] Failed to mark job {job_id} as PUBLISHED: {e}")

        return True

    def _mark_failed(self, job_id: str, error_msg: str):
        """Mark a job as FAILED with error details."""
        try:
            self.sb.table("whatsapp_publish_jobs").update({
                "status": "FAILED",
                "error": error_msg[:500],
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            logger.info(f"[WORKER] JOB_FAILED job={job_id} error={error_msg[:100]}")
        except Exception as e:
            logger.error(f"[WORKER] Failed to mark job {job_id} as FAILED: {e}")
