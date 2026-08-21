from typing import Dict, Any
import uuid
from app.whatsapp.publisher import Publisher
from app.whatsapp.channel_manager import ChannelManager
from app.whatsapp.authorized_provider import MetaCloudAPIProvider
from app.core.config import settings

class WhatsAppAdapter:
    def __init__(self):
        self.publisher = Publisher()
        self.channel_manager = ChannelManager(provider=MetaCloudAPIProvider(token=settings.whatsapp_provider_config))

    async def publish(self, content: str, user_id: str, automation_id: str) -> Dict[str, Any]:
        """
        Publishes content to the user's selected WhatsApp channel.
        """
        # Find the selected channel for this user
        channels = self.channel_manager.get_user_channels(user_id)
        selected = [c for c in channels if c.get("is_selected")]
        
        if not selected:
            # For demo mode if no channel selected
            return {
                "post_id": f"demo_wa_{uuid.uuid4().hex[:8]}",
                "post_url": "https://whatsapp.com/channel/demo",
                "demo": True
            }
            
        channel_id = selected[0]["id"]
        
        # Enqueue the job using the publisher
        payload = {"body": content}
        result = self.publisher.enqueue_job(user_id, channel_id, "text", payload)
        
        if result["success"]:
            # Returning a job ID as post ID for now. It will update async in the new tables.
            return {
                "post_id": result["job_id"],
                "post_url": "",
                "status": "QUEUED"
            }
        else:
            raise ValueError(result.get("error", "Failed to enqueue WhatsApp publish job"))
