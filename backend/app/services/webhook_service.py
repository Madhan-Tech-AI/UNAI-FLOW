import json
import uuid
import httpx
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from app.database.supabase import get_supabase_client
from app.core.security import sign_webhook_payload
from app.core.logging import logger

class WebhookService:
    def __init__(self):
        self.sb = get_supabase_client()

    def register_webhook(self, organization_id: str, url: str, events: List[str]) -> Dict[str, Any]:
        secret = f"whsec_{uuid.uuid4().hex}"
        record = {
            "organization_id": organization_id,
            "url": url,
            "secret": secret,
            "events": events,
            "enabled": True,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        res = self.sb.table("webhooks").insert(record).execute()
        return res.data[0]

    def list_webhooks(self, organization_id: str) -> List[Dict[str, Any]]:
        res = self.sb.table("webhooks").select("id, organization_id, url, events, enabled, created_at").eq("organization_id", organization_id).execute()
        return res.data or []

    def delete_webhook(self, organization_id: str, webhook_id: str) -> bool:
        res = self.sb.table("webhooks").delete().eq("id", webhook_id).eq("organization_id", organization_id).execute()
        return bool(res.data)

    async def trigger_event(self, organization_id: str, event_type: str, data: Dict[str, Any]):
        """Dispatches event to all enabled webhook endpoints subscribed to this event_type."""
        res = self.sb.table("webhooks").select("*").eq("organization_id", organization_id).eq("enabled", True).execute()
        webhooks = res.data or []
        
        event_id = f"evt_{uuid.uuid4().hex[:12]}"
        now_ts = str(int(datetime.now(timezone.utc).timestamp()))
        
        payload_dict = {
            "id": event_id,
            "type": event_type,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "data": data
        }
        payload_str = json.dumps(payload_dict)
        
        for wh in webhooks:
            subscribed_events = wh.get("events") or []
            if event_type in subscribed_events or "*" in subscribed_events:
                signature = sign_webhook_payload(f"{now_ts}.{payload_str}", wh.get("secret"))
                headers = {
                    "Content-Type": "application/json",
                    "X-Webhook-ID": event_id,
                    "X-Webhook-Timestamp": now_ts,
                    "X-Webhook-Signature": signature
                }
                
                try:
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        await client.post(wh["url"], headers=headers, content=payload_str)
                except Exception as e:
                    logger.warning(f"Webhook delivery failed for {wh['url']}: {str(e)}")

webhook_service = WebhookService()
