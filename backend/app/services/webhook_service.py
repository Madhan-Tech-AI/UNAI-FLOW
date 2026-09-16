import json
import uuid
import httpx
import asyncio
import time
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from app.database.supabase import get_supabase_client
from app.core.security import sign_webhook_payload
from app.core.logging import logger


class WebhookService:
    def __init__(self):
        self.sb = get_supabase_client()

    def register_webhook(
        self,
        organization_id: str,
        url: str,
        events: List[str],
        description: Optional[str] = None,
        application_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        secret = f"whsec_{uuid.uuid4().hex}"
        record = {
            "organization_id": organization_id,
            "url": url,
            "secret": secret,
            "events": events,
            "enabled": True,
            "consecutive_failures": 0,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        if application_id:
            record["application_id"] = application_id
        res = self.sb.table("webhooks").insert(record).execute()
        return res.data[0]

    def list_webhooks(self, organization_id: str, application_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = (
            self.sb.table("webhooks")
            .select("id, organization_id, application_id, url, events, enabled, consecutive_failures, last_triggered_at, disabled_at, created_at")
            .eq("organization_id", organization_id)
        )
        if application_id:
            query = query.eq("application_id", application_id)
        res = query.execute()
        return res.data or []

    def delete_webhook(self, organization_id: str, webhook_id: str) -> bool:
        res = self.sb.table("webhooks").delete().eq("id", webhook_id).eq("organization_id", organization_id).execute()
        return bool(res.data)

    def get_delivery_logs(
        self,
        organization_id: str,
        webhook_id: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Returns recent webhook delivery logs."""
        query = self.sb.table("webhook_delivery_log").select("*")
        if webhook_id:
            query = query.eq("webhook_id", webhook_id)
        res = query.order("created_at", desc=True).limit(limit).execute()
        return res.data or []

    async def _deliver_with_retry(
        self,
        webhook: Dict[str, Any],
        event_id: str,
        event_type: str,
        payload_str: str,
        now_ts: str
    ):
        """Attempts webhook HTTP delivery up to 3 times with exponential backoff and logs results."""
        webhook_id = webhook["id"]
        url = webhook["url"]
        secret = webhook.get("secret", "")
        signature = sign_webhook_payload(f"{now_ts}.{payload_str}", secret)

        headers = {
            "Content-Type": "application/json",
            "X-Webhook-ID": event_id,
            "X-Webhook-Timestamp": now_ts,
            "X-Webhook-Signature": signature
        }

        max_attempts = 3
        backoff_delays = [1.0, 3.0, 10.0]
        delivery_success = False

        for attempt in range(1, max_attempts + 1):
            start_time = time.monotonic()
            status_code = None
            response_body = None
            error_message = None

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(url, headers=headers, content=payload_str)
                    status_code = response.status_code
                    response_body = response.text[:1000] if response.text else None
                    if 200 <= status_code < 300:
                        delivery_success = True
                    else:
                        error_message = f"HTTP status {status_code}"
            except Exception as e:
                error_message = str(e)[:500]

            latency_ms = int((time.monotonic() - start_time) * 1000)

            # Log this delivery attempt in webhook_delivery_log
            try:
                self.sb.table("webhook_delivery_log").insert({
                    "webhook_id": webhook_id,
                    "event_id": event_id,
                    "event_type": event_type,
                    "attempt_number": attempt,
                    "status_code": status_code,
                    "response_body": response_body,
                    "error_message": error_message,
                    "success": delivery_success,
                    "latency_ms": latency_ms,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }).execute()
            except Exception as log_err:
                logger.warning(f"[WEBHOOK] Failed to write delivery log: {log_err}")

            if delivery_success:
                break

            if attempt < max_attempts:
                await asyncio.sleep(backoff_delays[attempt - 1])

        # Update webhook health stats
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            if delivery_success:
                self.sb.table("webhooks").update({
                    "consecutive_failures": 0,
                    "last_triggered_at": now_iso
                }).eq("id", webhook_id).execute()
            else:
                consecutive = (webhook.get("consecutive_failures") or 0) + 1
                update_data = {
                    "consecutive_failures": consecutive,
                    "last_triggered_at": now_iso
                }
                # Auto-disable after 10 consecutive failures
                if consecutive >= 10:
                    update_data["enabled"] = False
                    update_data["disabled_at"] = now_iso
                    logger.error(f"[WEBHOOK] Auto-disabling webhook {webhook_id} after {consecutive} consecutive failures")

                self.sb.table("webhooks").update(update_data).eq("id", webhook_id).execute()
        except Exception as e:
            logger.warning(f"[WEBHOOK] Failed to update webhook stats: {e}")

    async def trigger_event(
        self,
        organization_id: str,
        event_type: str,
        data: Dict[str, Any],
        application_id: Optional[str] = None,
    ):
        """Dispatches event to enabled webhook endpoints subscribed to this event_type.
        If application_id is provided, prefers application-specific webhooks;
        falls back to org-level webhooks if none exist for the application."""
        try:
            query = (
                self.sb.table("webhooks")
                .select("*")
                .eq("organization_id", organization_id)
                .eq("enabled", True)
            )
            res = query.execute()
            all_webhooks = res.data or []
        except Exception as e:
            logger.warning(f"[WEBHOOK] Failed to load webhooks for org {organization_id}: {e}")
            return

        if not all_webhooks:
            return

        # If an application_id is set, prefer application-scoped webhooks
        if application_id:
            app_webhooks = [wh for wh in all_webhooks if wh.get("application_id") == application_id]
            # Fall back to org-level (non-application) webhooks if no app-specific ones exist
            webhooks = app_webhooks if app_webhooks else [wh for wh in all_webhooks if not wh.get("application_id")]
        else:
            webhooks = all_webhooks

        event_id = f"evt_{uuid.uuid4().hex[:12]}"
        now_ts = str(int(datetime.now(timezone.utc).timestamp()))

        payload_dict = {
            "id": event_id,
            "type": event_type,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "data": data
        }
        payload_str = json.dumps(payload_dict)

        tasks = []
        for wh in webhooks:
            subscribed_events = wh.get("events") or []
            if event_type in subscribed_events or "*" in subscribed_events:
                tasks.append(
                    self._deliver_with_retry(
                        webhook=wh,
                        event_id=event_id,
                        event_type=event_type,
                        payload_str=payload_str,
                        now_ts=now_ts
                    )
                )

        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


webhook_service = WebhookService()
