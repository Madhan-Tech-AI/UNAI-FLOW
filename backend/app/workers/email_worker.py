import asyncio
import traceback
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from lib.supabase_client import supabase
from services.email.service import get_email_service

logger = logging.getLogger(__name__)

class EmailWorker:
    """
    Production background worker for bulk email sending.
    Polls email_recipients with status='queued', enforces rate limits,
    executes real delivery via EmailService, updates recipient states,
    and maintains campaign aggregate statistics.
    """

    def __init__(self):
        self.running = False
        self.email_service = get_email_service()
        self._wake_event = asyncio.Event()
        self._idle_count = 0

    def trigger(self):
        """Signals the worker to immediately process queued emails without waiting for the sleep interval."""
        self._wake_event.set()

    async def start(self):
        self.running = True
        logger.info("[EMAIL_WORKER] EmailWorker started.")
        while self.running:
            try:
                processed_any = await self.process_queue()
                if processed_any:
                    self._idle_count = 0
                else:
                    self._idle_count += 1
            except Exception as e:
                logger.error(f"[EMAIL_WORKER] Error in queue processing: {e}\n{traceback.format_exc()}")
                self._idle_count += 1

            # Determine sleep duration with event wait
            sleep_duration = 2.0 if self._idle_count == 0 else min(5.0 + self._idle_count * 2.0, 30.0)
            try:
                # Wait for wake event or timeout
                await asyncio.wait_for(self._wake_event.wait(), timeout=sleep_duration)
                self._wake_event.clear()
            except asyncio.TimeoutError:
                pass

    def stop(self):
        self.running = False
        self._wake_event.set()
        logger.info("[EMAIL_WORKER] EmailWorker stopped.")

    async def process_queue(self) -> bool:
        """
        Processes one batch of queued email recipients across active campaigns.
        Returns True if at least one email was processed, False otherwise.
        """
        batch_size = self.email_service.batch_size
        rate_limit = self.email_service.rate_limit_per_second
        delay_between_emails = 1.0 / max(rate_limit, 1.0)

        # 1. Fetch batch of queued recipients
        try:
            res = (
                supabase.table("email_recipients")
                .select("*, email_campaigns(*)")
                .eq("status", "queued")
                .order("created_at", desc=False)
                .limit(batch_size)
                .execute()
            )
            recipients = res.data or []
        except Exception as e:
            logger.error(f"[EMAIL_WORKER] Failed to query queued recipients: {e}")
            return False

        if not recipients:
            return False

        logger.info(f"[EMAIL_WORKER] Processing batch of {len(recipients)} recipients...")

        # Cache campaign data to avoid repeated lookups
        campaigns_cache: Dict[str, Dict[str, Any]] = {}

        for item in recipients:
            if not self.running:
                break

            recipient_id = item["id"]
            campaign_id = item["campaign_id"]
            user_id = item["user_id"]
            email_address = item["email"]
            recipient_name = item.get("name") or ""
            variables = item.get("variables") or {}
            retry_count = item.get("retry_count", 0)

            # Retrieve campaign data
            campaign = item.get("email_campaigns")
            if not campaign:
                if campaign_id not in campaigns_cache:
                    c_res = supabase.table("email_campaigns").select("*").eq("id", campaign_id).execute()
                    if c_res.data:
                        campaigns_cache[campaign_id] = c_res.data[0]
                campaign = campaigns_cache.get(campaign_id)

            if not campaign or campaign.get("status") in ("cancelled", "failed"):
                # If campaign was cancelled, mark recipient cancelled
                try:
                    supabase.table("email_recipients").update({
                        "status": "cancelled",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", recipient_id).execute()
                except Exception:
                    pass
                continue

            # 2. Claim recipient: mark as 'sending'
            try:
                claim_res = (
                    supabase.table("email_recipients")
                    .update({
                        "status": "sending",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    .eq("id", recipient_id)
                    .eq("status", "queued")
                    .execute()
                )
                if not claim_res.data:
                    # Already claimed by another worker or process
                    continue
            except Exception as claim_err:
                logger.warning(f"[EMAIL_WORKER] Failed to claim recipient {recipient_id}: {claim_err}")
                continue

            # Ensure campaign is marked 'sending' if still 'queued'
            if campaign.get("status") == "queued":
                try:
                    supabase.table("email_campaigns").update({
                        "status": "sending",
                        "started_at": datetime.now(timezone.utc).isoformat(),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("id", campaign_id).execute()
                    campaign["status"] = "sending"
                except Exception:
                    pass

            # 3. Send email via EmailService
            send_result = await self.email_service.send_single_recipient(
                user_id=user_id,
                to_email=email_address,
                to_name=recipient_name,
                raw_subject=campaign.get("subject", "Notification"),
                raw_html=campaign.get("html_body", ""),
                variables=variables,
                from_email=campaign.get("from_email"),
                from_name=campaign.get("from_name"),
                reply_to=campaign.get("reply_to"),
                headers={"X-Campaign-ID": campaign_id, "X-Recipient-ID": recipient_id},
            )

            now_iso = datetime.now(timezone.utc).isoformat()

            # 4. Handle delivery result
            if send_result.success:
                try:
                    supabase.table("email_recipients").update({
                        "status": "sent",
                        "provider_message_id": send_result.provider_message_id,
                        "sent_at": now_iso,
                        "delivered_at": now_iso if self.email_service.provider_name == "smtp" else None,
                        "error_message": None,
                        "updated_at": now_iso,
                    }).eq("id", recipient_id).execute()

                    # Increment campaign counters
                    self._increment_campaign_counter(campaign_id, "sent")
                except Exception as update_err:
                    logger.error(f"[EMAIL_WORKER] Failed to update success for {recipient_id}: {update_err}")

            else:
                # Failure handling
                is_retryable = send_result.is_retryable and (retry_count < self.email_service.max_retries)
                if is_retryable:
                    # Re-queue for next retry
                    try:
                        supabase.table("email_recipients").update({
                            "status": "queued",
                            "retry_count": retry_count + 1,
                            "error_message": send_result.error_message,
                            "updated_at": now_iso,
                        }).eq("id", recipient_id).execute()
                        logger.info(f"[EMAIL_WORKER] Re-queued {email_address} for retry {retry_count + 1}")
                    except Exception as retry_err:
                        logger.error(f"[EMAIL_WORKER] Failed to re-queue retry for {recipient_id}: {retry_err}")
                else:
                    # Permanent failure
                    try:
                        supabase.table("email_recipients").update({
                            "status": "failed",
                            "failed_at": now_iso,
                            "error_message": send_result.error_message,
                            "updated_at": now_iso,
                        }).eq("id", recipient_id).execute()

                        self._increment_campaign_counter(campaign_id, "failed")

                        # If bounced or permanent error, record in suppression list
                        if "bounce" in (send_result.error_message or "").lower():
                            asyncio.create_task(
                                self.email_service.add_suppression(
                                    user_id=user_id,
                                    email=email_address,
                                    reason="bounced",
                                    notes=send_result.error_message or "Permanent delivery failure",
                                )
                            )
                    except Exception as fail_err:
                        logger.error(f"[EMAIL_WORKER] Failed to record failure for {recipient_id}: {fail_err}")

            # 5. Check if campaign is now complete
            await self._check_campaign_completion(campaign_id)

            # 6. Rate limiting sleep
            if delay_between_emails > 0:
                await asyncio.sleep(delay_between_emails)

        return True

    def _increment_campaign_counter(self, campaign_id: str, count_type: str):
        """Increments campaign stats in Supabase."""
        try:
            c_res = supabase.table("email_campaigns").select("sent_count, failed_count, queued_count, total_recipients").eq("id", campaign_id).execute()
            if c_res.data:
                row = c_res.data[0]
                update_data = {}
                if count_type == "sent":
                    update_data["sent_count"] = (row.get("sent_count") or 0) + 1
                    update_data["queued_count"] = max(0, (row.get("queued_count") or 1) - 1)
                elif count_type == "failed":
                    update_data["failed_count"] = (row.get("failed_count") or 0) + 1
                    update_data["queued_count"] = max(0, (row.get("queued_count") or 1) - 1)

                supabase.table("email_campaigns").update(update_data).eq("id", campaign_id).execute()
        except Exception as e:
            logger.debug(f"[EMAIL_WORKER] Counter increment note: {e}")

    async def _check_campaign_completion(self, campaign_id: str):
        """Checks if all recipients in a campaign have finalized and updates status accordingly."""
        try:
            # Check if any recipients remain queued or sending
            remaining = (
                supabase.table("email_recipients")
                .select("id")
                .eq("campaign_id", campaign_id)
                .in_("status", ["queued", "sending"])
                .limit(1)
                .execute()
            )
            if remaining.data and len(remaining.data) > 0:
                # Still in progress
                return

            # All finished! Get final stats
            c_res = supabase.table("email_campaigns").select("sent_count, failed_count, total_recipients").eq("id", campaign_id).execute()
            if not c_res.data:
                return

            c_data = c_res.data[0]
            sent = c_data.get("sent_count") or 0
            failed = c_data.get("failed_count") or 0
            now_iso = datetime.now(timezone.utc).isoformat()

            if sent > 0 and failed == 0:
                final_status = "completed"
            elif sent > 0 and failed > 0:
                final_status = "partial_failure"
            elif failed > 0:
                final_status = "failed"
            else:
                final_status = "completed"

            supabase.table("email_campaigns").update({
                "status": final_status,
                "queued_count": 0,
                "completed_at": now_iso,
                "updated_at": now_iso,
            }).eq("id", campaign_id).execute()

            logger.info(f"[EMAIL_WORKER] Campaign {campaign_id} finalized with status: {final_status} (sent={sent}, failed={failed})")

        except Exception as e:
            logger.error(f"[EMAIL_WORKER] Error in completion check for {campaign_id}: {e}")


# Singleton worker instance
email_worker = EmailWorker()
