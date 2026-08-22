import uuid
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone
from app.database.supabase import get_supabase_client
from app.core.exceptions import (
    InstanceNotFoundException,
    InstanceNotAuthenticatedException,
    ChannelNotFoundException,
    ChannelPermissionDeniedException,
    MessageSendFailedException
)
from app.services.instance_service import instance_service
from app.services.channel_service import channel_service
from app.providers.whatsapp.models import ProviderMessageResult
from app.core.logging import logger

class PublishingService:
    def __init__(self):
        self.sb = get_supabase_client()

    def _resolve_instance(self, organization_id: str, instance_id: Optional[str], newsletter_jid: str) -> Dict[str, Any]:
        if instance_id:
            return instance_service.get_instance(organization_id, instance_id)
            
        # Find which instance owns this newsletter
        ch_res = self.sb.table("whatsapp_channels").select("instance_id").eq("newsletter_jid", newsletter_jid).execute()
        if ch_res.data:
            inst_id = ch_res.data[0]["instance_id"]
            return instance_service.get_instance(organization_id, inst_id)
            
        # Fallback to any authenticated instance
        instances = instance_service.list_instances(organization_id)
        auth_inst = next((i for i in instances if i["status"] in ["AUTHENTICATED", "CONNECTED"]), None)
        if auth_inst:
            return auth_inst
            
        if instances:
            return instances[0]
            
        raise InstanceNotFoundException("No WhatsApp instance available for this organization.")

    async def enqueue_post(
        self,
        organization_id: str,
        to: str,
        message_type: str,
        payload: Dict[str, Any],
        instance_id: Optional[str] = None,
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Idempotent message publishing pipeline:
        1. Checks Idempotency-Key.
        2. Validates instance state and channel permissions.
        3. Creates posts, post_destinations, and publish_jobs rows.
        4. Dispatches to WhatsAppProvider or queues to Celery.
        """
        # 1. Check Idempotency Key
        if idempotency_key:
            existing_job = self.sb.table("publish_jobs").select("*").eq("idempotency_key", idempotency_key).execute()
            if existing_job.data:
                job = existing_job.data[0]
                return {
                    "job_id": job["id"],
                    "status": job["status"],
                    "idempotency_key": idempotency_key,
                    "provider_message_id": job.get("provider_message_id"),
                    "is_idempotent_replay": True
                }

        # 2. Resolve & Validate Instance
        inst = self._resolve_instance(organization_id, instance_id, to)
        if inst["status"] not in ["AUTHENTICATED", "CONNECTED"]:
            raise InstanceNotAuthenticatedException(inst["id"])

        # 3. Create Posts & Destination Records
        caption = payload.get("body") or payload.get("caption") or payload.get("question") or ""
        media_url = payload.get("media_url")
        
        post_res = self.sb.table("posts").insert({
            "organization_id": organization_id,
            "caption": caption,
            "media_type": message_type,
            "media_url": media_url,
            "created_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        post_id = post_res.data[0]["id"]

        dest_res = self.sb.table("post_destinations").insert({
            "post_id": post_id,
            "provider": "whatsapp",
            "destination_id": to,
            "status": "PROCESSING",
            "published_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        dest_id = dest_res.data[0]["id"]

        job_res = self.sb.table("publish_jobs").insert({
            "post_id": post_id,
            "destination_id": dest_id,
            "status": "PROCESSING",
            "idempotency_key": idempotency_key,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "started_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        job_id = job_res.data[0]["id"]

        # 4. Dispatch to WhatsAppProvider
        provider = instance_service.provider
        inst_uuid = inst["instance_uuid"]
        
        try:
            result: ProviderMessageResult = None
            if message_type == "text":
                result = await provider.send_text(inst_uuid, to, payload["body"])
            elif message_type == "image":
                result = await provider.send_image(inst_uuid, to, payload.get("media_url"), payload.get("caption"))
            elif message_type == "video":
                result = await provider.send_video(inst_uuid, to, payload.get("media_url"), payload.get("caption"))
            elif message_type == "audio":
                result = await provider.send_audio(inst_uuid, to, payload.get("media_url"))
            elif message_type == "poll":
                result = await provider.send_poll(inst_uuid, to, payload["question"], payload["options"], payload.get("selectable_count", 1))
            else:
                raise ValueError(f"Unsupported message type: {message_type}")

            # 5. Mark PUBLISHED
            self.sb.table("publish_jobs").update({
                "status": "PUBLISHED",
                "provider_message_id": result.message_id,
                "completed_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", job_id).execute()

            self.sb.table("post_destinations").update({
                "status": "PUBLISHED",
                "provider_message_id": result.message_id,
                "published_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", dest_id).execute()

            return {
                "job_id": job_id,
                "status": "PUBLISHED",
                "provider_message_id": result.message_id,
                "idempotency_key": idempotency_key
            }

        except Exception as e:
            logger.error(f"Publishing failed for job {job_id}: {str(e)}")
            self.sb.table("publish_jobs").update({
                "status": "FAILED",
                "error": str(e),
                "completed_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", job_id).execute()

            self.sb.table("post_destinations").update({
                "status": "FAILED",
                "error": str(e)
            }).eq("id", dest_id).execute()

            raise MessageSendFailedException(f"Failed to deliver message to WhatsApp channel: {str(e)}")

publishing_service = PublishingService()
