import asyncio
import traceback
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from app.database.supabase import get_supabase_client
from app.services.instance_service import instance_service
from app.services.webhook_service import webhook_service
from app.core.logging import logger


class CampaignWorker:
    """
    Background asynchronous worker for bulk WhatsApp messaging campaigns.
    Polls api_campaign_recipients with status='queued', delivers messages
    via the configured WhatsAppProvider, updates recipient states,
    maintains aggregate campaign statistics, and emits webhook delivery events.
    """

    def __init__(self):
        self.sb = get_supabase_client()
        self.running = False
        self._wake_event = asyncio.Event()
        self._idle_count = 0
        self.batch_size = 50

    def trigger(self):
        """Signals the worker to immediately process queued messages."""
        self._wake_event.set()

    async def start(self):
        self.running = True
        logger.info("[CAMPAIGN_WORKER] CampaignWorker started.")

        # Recover any stuck sending recipients from previous server restart
        await self._recover_stuck_sending()

        while self.running:
            try:
                processed_any = await self.process_queue()
                if processed_any:
                    self._idle_count = 0
                else:
                    self._idle_count += 1
                    if self._idle_count % 10 == 0:
                        await self._recover_stuck_sending()
            except Exception as e:
                logger.error(f"[CAMPAIGN_WORKER] Error in queue processing: {e}\n{traceback.format_exc()}")
                self._idle_count += 1

            # Sleep with exponential backoff or wait for wake event
            sleep_duration = 2.0 if self._idle_count == 0 else min(5.0 + self._idle_count * 2.0, 30.0)
            try:
                await asyncio.wait_for(self._wake_event.wait(), timeout=sleep_duration)
                self._wake_event.clear()
            except asyncio.TimeoutError:
                pass

    def stop(self):
        self.running = False
        self._wake_event.set()
        logger.info("[CAMPAIGN_WORKER] CampaignWorker stopped.")

    async def _recover_stuck_sending(self):
        """Recovers recipients stuck in 'sending' state for more than 5 minutes."""
        try:
            cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            res = (
                self.sb.table("api_campaign_recipients")
                .update({"status": "queued"})
                .eq("status", "sending")
                .lt("updated_at", cutoff)
                .execute()
            )
            count = len(res.data) if res.data else 0
            if count > 0:
                logger.warning(f"[CAMPAIGN_WORKER] Recovered {count} stuck sending recipients back to queued.")
        except Exception as e:
            logger.warning(f"[CAMPAIGN_WORKER] Failed to recover stuck sending recipients: {e}")

    def _interpolate_text(self, template: str, variables: Dict[str, Any], recipient_name: Optional[str]) -> str:
        """Simple {{var}} variable interpolation."""
        result = template
        all_vars = dict(variables or {})
        if recipient_name and "name" not in all_vars:
            all_vars["name"] = recipient_name

        for k, v in all_vars.items():
            result = result.replace(f"{{{{{k}}}}}", str(v))
        return result

    async def process_queue(self) -> bool:
        """
        Pulls a batch of queued recipients, executes delivery, and updates states.
        Returns True if work was done, False if queue was empty.
        """
        # 1. Fetch batch of queued recipients
        try:
            res = (
                self.sb.table("api_campaign_recipients")
                .select("*")
                .eq("status", "queued")
                .order("created_at", desc=False)
                .limit(self.batch_size)
                .execute()
            )
            recipients = res.data or []
        except Exception as e:
            logger.error(f"[CAMPAIGN_WORKER] Failed to query queued recipients: {e}")
            return False

        if not recipients:
            return False

        logger.info(f"[CAMPAIGN_WORKER] Processing batch of {len(recipients)} recipients...")

        campaigns_cache: Dict[str, Dict[str, Any]] = {}
        instances_cache: Dict[str, Dict[str, Any]] = {}
        affected_campaign_ids = set()

        for item in recipients:
            if not self.running:
                break

            recipient_id = item["id"]
            campaign_id = item["campaign_id"]
            organization_id = item["organization_id"]
            recipient_jid = item["recipient_jid"]
            variables = item.get("variables") or {}
            recipient_name = item.get("recipient_name")
            retry_count = item.get("retry_count", 0)
            max_retries = item.get("max_retries", 3)

            affected_campaign_ids.add(campaign_id)

            # 2. Claim recipient atomically
            try:
                now_iso = datetime.now(timezone.utc).isoformat()
                claim = (
                    self.sb.table("api_campaign_recipients")
                    .update({"status": "sending", "updated_at": now_iso})
                    .eq("id", recipient_id)
                    .eq("status", "queued")
                    .execute()
                )
                if not claim.data:
                    # Claimed by another worker
                    continue
            except Exception as e:
                logger.warning(f"[CAMPAIGN_WORKER] Failed to claim recipient {recipient_id}: {e}")
                continue

            # 3. Cache and resolve campaign
            if campaign_id not in campaigns_cache:
                camp_res = self.sb.table("api_campaigns").select("*").eq("id", campaign_id).execute()
                if camp_res.data:
                    campaigns_cache[campaign_id] = camp_res.data[0]
                    # Ensure campaign status is marked as 'sending'
                    if camp_res.data[0]["status"] == "queued":
                        self.sb.table("api_campaigns").update({"status": "sending"}).eq("id", campaign_id).execute()
                else:
                    logger.error(f"[CAMPAIGN_WORKER] Campaign {campaign_id} not found.")
                    self.sb.table("api_campaign_recipients").update({
                        "status": "failed",
                        "error_message": "Associated campaign not found"
                    }).eq("id", recipient_id).execute()
                    continue

            campaign = campaigns_cache[campaign_id]

            # Check if campaign was cancelled in the meantime
            if campaign.get("status") == "cancelled":
                self.sb.table("api_campaign_recipients").update({
                    "status": "cancelled",
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", recipient_id).execute()
                continue

            # 4. Resolve instance
            instance_id = campaign.get("instance_id")
            if instance_id not in instances_cache:
                try:
                    inst_record = instance_service.get_instance(organization_id, instance_id)
                    instances_cache[instance_id] = inst_record
                except Exception as e:
                    logger.error(f"[CAMPAIGN_WORKER] Failed to resolve instance {instance_id}: {e}")
                    instances_cache[instance_id] = None

            inst = instances_cache.get(instance_id)
            if not inst:
                self.sb.table("api_campaign_recipients").update({
                    "status": "failed",
                    "error_message": "Instance not available or disconnected",
                    "failed_at": datetime.now(timezone.utc).isoformat()
                }).eq("id", recipient_id).execute()
                continue

            inst_uuid = inst["instance_uuid"]
            message_type = campaign.get("message_type", "text")
            payload = campaign.get("message_payload", {})
            provider = instance_service.provider

            # 5. Execute delivery
            provider_message_id = None
            send_error = None
            try:
                if message_type == "text":
                    raw_body = payload.get("body", "")
                    interpolated_body = self._interpolate_text(raw_body, variables, recipient_name)
                    result = await provider.send_text(inst_uuid, recipient_jid, interpolated_body)
                elif message_type == "image":
                    caption = self._interpolate_text(payload.get("caption", ""), variables, recipient_name)
                    result = await provider.send_image(inst_uuid, recipient_jid, payload.get("media_url"), caption)
                elif message_type == "video":
                    caption = self._interpolate_text(payload.get("caption", ""), variables, recipient_name)
                    result = await provider.send_video(inst_uuid, recipient_jid, payload.get("media_url"), caption)
                elif message_type == "document":
                    caption = self._interpolate_text(payload.get("caption", ""), variables, recipient_name)
                    result = await provider.send_document(inst_uuid, recipient_jid, payload.get("media_url"), payload.get("filename"), caption)
                elif message_type == "audio":
                    result = await provider.send_audio(inst_uuid, recipient_jid, payload.get("media_url"))
                elif message_type == "poll":
                    result = await provider.send_poll(
                        inst_uuid,
                        recipient_jid,
                        payload.get("question", ""),
                        payload.get("options", []),
                        payload.get("selectable_count", 1)
                    )
                else:
                    raise ValueError(f"Unsupported message type: {message_type}")

                provider_message_id = result.message_id
            except Exception as ex:
                send_error = str(ex)
                logger.warning(f"[CAMPAIGN_WORKER] Failed delivery to {recipient_jid}: {send_error}")

            now_iso = datetime.now(timezone.utc).isoformat()

            # 6. Update recipient status & emit webhook
            if not send_error:
                # Delivery succeeded
                self.sb.table("api_campaign_recipients").update({
                    "status": "delivered",
                    "provider_message_id": provider_message_id,
                    "sent_at": now_iso,
                    "delivered_at": now_iso,
                    "updated_at": now_iso,
                    "error_message": None
                }).eq("id", recipient_id).execute()

                # Emit webhook: message.sent
                asyncio.create_task(
                    webhook_service.trigger_event(
                        organization_id=organization_id,
                        event_type="message.sent",
                        data={
                            "campaign_id": campaign_id,
                            "recipient_id": recipient_id,
                            "recipient_jid": recipient_jid,
                            "provider_message_id": provider_message_id,
                            "status": "delivered",
                            "timestamp": now_iso
                        }
                    )
                )
            else:
                # Delivery failed
                new_retry = retry_count + 1
                if new_retry < max_retries:
                    self.sb.table("api_campaign_recipients").update({
                        "status": "queued",
                        "retry_count": new_retry,
                        "error_message": send_error[:500],
                        "updated_at": now_iso
                    }).eq("id", recipient_id).execute()
                else:
                    self.sb.table("api_campaign_recipients").update({
                        "status": "failed",
                        "retry_count": new_retry,
                        "error_message": send_error[:500],
                        "failed_at": now_iso,
                        "updated_at": now_iso
                    }).eq("id", recipient_id).execute()

                    # Emit webhook: message.failed
                    asyncio.create_task(
                        webhook_service.trigger_event(
                            organization_id=organization_id,
                            event_type="message.failed",
                            data={
                                "campaign_id": campaign_id,
                                "recipient_id": recipient_id,
                                "recipient_jid": recipient_jid,
                                "error": send_error[:500],
                                "status": "failed",
                                "timestamp": now_iso
                            }
                        )
                    )

            # Rate limiting delay between messages
            mps = float(campaign.get("messages_per_second") or 1.0)
            delay = 1.0 / max(mps, 0.1)
            await asyncio.sleep(delay)

        # 7. Refresh aggregate counters for affected campaigns
        from app.services.campaign_service import campaign_service
        for c_id in affected_campaign_ids:
            campaign_service.refresh_campaign_status(c_id)

        return True


campaign_worker = CampaignWorker()
