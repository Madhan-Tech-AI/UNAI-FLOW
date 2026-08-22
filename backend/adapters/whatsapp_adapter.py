import uuid
from typing import Dict, Any
from app.services.channel_service import channel_service
from app.services.publishing_service import publishing_service
from lib.supabase_client import supabase

class WhatsAppAdapter:
    async def publish(self, content: str, user_id: str, automation_id: str) -> Dict[str, Any]:
        """
        Publishes content to the user's selected WhatsApp channel via the Whapi-style Gateway.
        """
        # 1. Fetch channels discovered for this user/organization
        channels = channel_service.list_org_channels(user_id)
        
        # Look for a selected channel or the first available channel
        target_channel = None
        for ch in channels:
            if ch.get("metadata", {}).get("selected") or ch.get("selected"):
                target_channel = ch
                break
                
        if not target_channel and channels:
            target_channel = channels[0]
            
        if not target_channel:
            # If no channel is linked yet, fallback gracefully for demo / testing
            return {
                "post_id": f"demo_wa_{uuid.uuid4().hex[:8]}",
                "post_url": "https://whatsapp.com/channel/demo",
                "demo": True
            }
            
        newsletter_jid = target_channel["newsletter_jid"]
        instance_id = target_channel.get("instance_id")
        
        # 2. Dispatch via PublishingService with Idempotency Key
        idempotency_key = f"auto_{automation_id}_wa_{uuid.uuid4().hex[:8]}"
        result = await publishing_service.enqueue_post(
            organization_id=user_id,
            to=newsletter_jid,
            message_type="text",
            payload={"body": content},
            instance_id=instance_id,
            idempotency_key=idempotency_key
        )
        
        return {
            "post_id": result["job_id"],
            "post_url": f"https://whatsapp.com/channel/{target_channel.get('invite_code', '')}",
            "status": result["status"]
        }
