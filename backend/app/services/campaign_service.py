import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from app.database.supabase import get_supabase_client
from app.schemas.campaign import CampaignCreate
from app.core.exceptions import InstanceNotFoundException
from app.core.logging import logger
from app.services.instance_service import instance_service


class CampaignService:
    def __init__(self):
        self.sb = get_supabase_client()
        self._worker_trigger = None  # Hook to wake CampaignWorker

    def set_worker_trigger(self, trigger_callable):
        self._worker_trigger = trigger_callable

    def _resolve_instance(self, organization_id: str, instance_id: Optional[str], application_id: Optional[str] = None) -> Dict[str, Any]:
        """Resolves the instance or picks an active/connected instance.
        Priority: explicit instance_id > application default > org auto-select > active session fallback."""
        if instance_id:
            try:
                return instance_service.get_instance(organization_id, instance_id)
            except Exception as e:
                logger.warning(f"[CAMPAIGN] Explicit instance {instance_id} not found, trying fallback: {e}")

        # If an application has a default instance, use it
        if application_id:
            try:
                app_res = self.sb.table("applications").select("default_instance_id").eq("id", application_id).execute()
                if app_res.data and app_res.data[0].get("default_instance_id"):
                    return instance_service.get_instance(organization_id, app_res.data[0]["default_instance_id"])
            except Exception as e:
                logger.warning(f"[CAMPAIGN] Failed to resolve application default instance: {e}")

        instances = instance_service.list_instances(organization_id)
        auth_inst = next((i for i in instances if i.get("status") in ["AUTHENTICATED", "CONNECTED", "READY"]), None)
        if auth_inst:
            return auth_inst
        if instances:
            return instances[0]

        # Direct fallback to active whatsapp_sessions
        try:
            s_res = self.sb.table("whatsapp_sessions").select("*").eq("user_id", organization_id).execute()
            if s_res.data:
                active_s = next((s for s in s_res.data if s.get("status") in ["CONNECTED", "READY", "AUTHENTICATED"]), s_res.data[0])
                if active_s:
                    session_ident = active_s.get("session_identifier") or f"sess_{active_s['id']}"
                    return {
                        "id": active_s.get("instance_id") or active_s["id"],
                        "organization_id": organization_id,
                        "instance_uuid": session_ident,
                        "display_name": f"WhatsApp Gateway (+{active_s.get('phone_number')})",
                        "phone_number": active_s.get("phone_number"),
                        "status": active_s.get("status", "CONNECTED"),
                        "connection_state": "CONNECTED"
                    }
        except Exception as e:
            logger.warning(f"[CAMPAIGN] Direct session fallback failed: {e}")

        raise InstanceNotFoundException("No WhatsApp instance configured for this organization.")

    def create_campaign(
        self,
        organization_id: str,
        data: CampaignCreate,
        api_key_id: Optional[str] = None,
        application_id: Optional[str] = None,
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """Creates a campaign in 'draft' status with all recipient records staged."""
        # 1. Check idempotency
        if idempotency_key:
            existing = (
                self.sb.table("api_campaigns")
                .select("*")
                .eq("organization_id", organization_id)
                .eq("idempotency_key", idempotency_key)
                .execute()
            )
            if existing.data:
                logger.info(f"[CAMPAIGN] Idempotent replay for campaign {existing.data[0]['id']}")
                return existing.data[0]

        # 2. Resolve instance (application default > org auto-select)
        inst = self._resolve_instance(organization_id, data.instance_id, application_id=application_id)

        # 3. Create campaign record
        total = len(data.recipients)
        now_iso = datetime.now(timezone.utc).isoformat()
        campaign_record = {
            "organization_id": organization_id,
            "api_key_id": api_key_id,
            "application_id": application_id,
            "instance_id": inst["id"],
            "name": data.name,
            "description": data.description,
            "message_type": data.message_type,
            "message_payload": data.message_payload,
            "status": "draft",
            "total_recipients": total,
            "queued_count": 0,
            "sent_count": 0,
            "delivered_count": 0,
            "failed_count": 0,
            "messages_per_second": data.messages_per_second or 1.0,
            "idempotency_key": idempotency_key,
            "created_at": now_iso,
            "updated_at": now_iso,
        }

        res = self.sb.table("api_campaigns").insert(campaign_record).execute()
        if not res.data:
            raise Exception("Failed to insert campaign record.")
        campaign = res.data[0]
        campaign_id = campaign["id"]

        # 4. Batch insert recipients (chunks of 500)
        recipient_records = []
        for r in data.recipients:
            recipient_records.append({
                "campaign_id": campaign_id,
                "organization_id": organization_id,
                "recipient_jid": r.recipient_jid.strip(),
                "recipient_name": r.recipient_name,
                "variables": r.variables or {},
                "status": "pending",
                "created_at": now_iso,
                "updated_at": now_iso,
            })

        chunk_size = 500
        for i in range(0, len(recipient_records), chunk_size):
            chunk = recipient_records[i:i + chunk_size]
            self.sb.table("api_campaign_recipients").insert(chunk).execute()

        logger.info(f"[CAMPAIGN] Created campaign {campaign_id} with {total} recipients")
        return campaign

    def launch_campaign(self, organization_id: str, campaign_id: str) -> Dict[str, Any]:
        """Launches a campaign by moving it and all recipients into 'queued' status."""
        camp_res = (
            self.sb.table("api_campaigns")
            .select("*")
            .eq("id", campaign_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        if not camp_res.data:
            raise ValueError(f"Campaign {campaign_id} not found.")

        campaign = camp_res.data[0]
        if campaign["status"] not in ["draft", "failed", "cancelled"]:
            raise ValueError(f"Campaign cannot be launched from status '{campaign['status']}'.")

        now_iso = datetime.now(timezone.utc).isoformat()

        # Update recipients from pending -> queued
        upd_rec = (
            self.sb.table("api_campaign_recipients")
            .update({
                "status": "queued",
                "queued_at": now_iso,
                "updated_at": now_iso,
            })
            .eq("campaign_id", campaign_id)
            .eq("status", "pending")
            .execute()
        )
        queued_count = len(upd_rec.data) if upd_rec.data else campaign["total_recipients"]

        # Update campaign status
        upd_camp = (
            self.sb.table("api_campaigns")
            .update({
                "status": "queued",
                "queued_count": queued_count,
                "launched_at": now_iso,
                "updated_at": now_iso,
            })
            .eq("id", campaign_id)
            .execute()
        )

        logger.info(f"[CAMPAIGN] Launched campaign {campaign_id} with {queued_count} queued recipients")

        # Wake worker
        if self._worker_trigger:
            self._worker_trigger()

        # Trigger webhook event
        try:
            from app.services.webhook_service import webhook_service
            import asyncio
            asyncio.create_task(
                webhook_service.trigger_event(
                    organization_id=organization_id,
                    event_type="campaign.launched",
                    data={
                        "campaign_id": campaign_id,
                        "name": campaign["name"],
                        "total_recipients": campaign["total_recipients"],
                        "queued_count": queued_count,
                        "launched_at": now_iso
                    }
                )
            )
        except Exception as e:
            logger.warning(f"[CAMPAIGN] Failed to emit campaign.launched webhook: {e}")

        return upd_camp.data[0] if upd_camp.data else campaign

    def get_campaign(self, organization_id: str, campaign_id: str) -> Dict[str, Any]:
        """Fetches campaign details and stats."""
        res = (
            self.sb.table("api_campaigns")
            .select("*")
            .eq("id", campaign_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        if not res.data:
            raise ValueError(f"Campaign {campaign_id} not found.")
        return res.data[0]

    def list_campaigns(
        self,
        organization_id: str,
        page: int = 1,
        page_size: int = 20,
        status: Optional[str] = None
    ) -> Dict[str, Any]:
        """Lists campaigns for an organization with pagination and filtering."""
        query = (
            self.sb.table("api_campaigns")
            .select("*", count="exact")
            .eq("organization_id", organization_id)
        )
        if status:
            query = query.eq("status", status)

        start = (page - 1) * page_size
        end = start + page_size - 1
        res = query.order("created_at", desc=True).range(start, end).execute()

        return {
            "campaigns": res.data or [],
            "total": res.count or 0,
            "page": page,
            "page_size": page_size
        }

    def get_campaign_recipients(
        self,
        organization_id: str,
        campaign_id: str,
        page: int = 1,
        page_size: int = 50,
        status: Optional[str] = None
    ) -> Dict[str, Any]:
        """Returns paginated recipients for a campaign."""
        # Verify ownership
        self.get_campaign(organization_id, campaign_id)

        query = (
            self.sb.table("api_campaign_recipients")
            .select("*", count="exact")
            .eq("campaign_id", campaign_id)
        )
        if status:
            query = query.eq("status", status)

        start = (page - 1) * page_size
        end = start + page_size - 1
        res = query.order("created_at", desc=False).range(start, end).execute()

        return {
            "recipients": res.data or [],
            "total": res.count or 0,
            "page": page,
            "page_size": page_size
        }

    def cancel_campaign(self, organization_id: str, campaign_id: str) -> Dict[str, Any]:
        """Cancels a pending or queued campaign and marks queued recipients as cancelled."""
        campaign = self.get_campaign(organization_id, campaign_id)
        if campaign["status"] in ["completed", "failed", "cancelled"]:
            return campaign

        now_iso = datetime.now(timezone.utc).isoformat()

        # Mark queued/pending recipients as cancelled
        self.sb.table("api_campaign_recipients").update({
            "status": "cancelled",
            "updated_at": now_iso
        }).eq("campaign_id", campaign_id).in_("status", ["pending", "queued"]).execute()

        res = (
            self.sb.table("api_campaigns")
            .update({
                "status": "cancelled",
                "completed_at": now_iso,
                "updated_at": now_iso
            })
            .eq("id", campaign_id)
            .execute()
        )

        logger.info(f"[CAMPAIGN] Cancelled campaign {campaign_id}")

        try:
            from app.services.webhook_service import webhook_service
            import asyncio
            asyncio.create_task(
                webhook_service.trigger_event(
                    organization_id=organization_id,
                    event_type="campaign.cancelled",
                    data={"campaign_id": campaign_id, "name": campaign["name"], "cancelled_at": now_iso}
                )
            )
        except Exception:
            pass

        return res.data[0] if res.data else campaign

    def refresh_campaign_status(self, campaign_id: str):
        """Re-aggregates recipient statuses and updates the campaign status."""
        try:
            # Query counts
            res = (
                self.sb.table("api_campaign_recipients")
                .select("status")
                .eq("campaign_id", campaign_id)
                .execute()
            )
            recipients = res.data or []
            total = len(recipients)
            if total == 0:
                return

            counts = {"pending": 0, "queued": 0, "sending": 0, "sent": 0, "delivered": 0, "failed": 0, "cancelled": 0}
            for r in recipients:
                st = r.get("status", "pending")
                counts[st] = counts.get(st, 0) + 1

            queued_count = counts["queued"] + counts["pending"] + counts["sending"]
            sent_count = counts["sent"]
            delivered_count = counts["delivered"]
            failed_count = counts["failed"]

            done_count = sent_count + delivered_count + failed_count + counts["cancelled"]
            new_status = "sending"
            completed_at = None

            if done_count >= total:
                completed_at = datetime.now(timezone.utc).isoformat()
                if failed_count == total:
                    new_status = "failed"
                elif failed_count > 0:
                    new_status = "partial_failure"
                else:
                    new_status = "completed"

            self.sb.table("api_campaigns").update({
                "queued_count": queued_count,
                "sent_count": sent_count,
                "delivered_count": delivered_count,
                "failed_count": failed_count,
                "status": new_status,
                "completed_at": completed_at,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", campaign_id).execute()

        except Exception as e:
            logger.warning(f"[CAMPAIGN] Failed to refresh status for campaign {campaign_id}: {e}")


campaign_service = CampaignService()
