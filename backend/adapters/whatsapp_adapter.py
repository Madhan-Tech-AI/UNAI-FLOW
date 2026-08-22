import uuid
import logging
from typing import Dict, Any
from lib.supabase_client import supabase
from app.whatsapp.whatsapp_web_provider import WhatsAppWebProvider

logger = logging.getLogger(__name__)

# Shared provider instance — talks to the WCA service via HTTP
_provider = WhatsAppWebProvider()


class WhatsAppAdapter:
    """
    Publishes content to a WhatsApp Channel using the legacy pipeline:
      1. Looks up the user's selected channel in `channels` table
      2. Finds the associated session_identifier from `whatsapp_sessions`
      3. Calls WhatsAppWebProvider → WCA service for actual delivery
    """

    async def publish(self, content: str, user_id: str, automation_id: str) -> Dict[str, Any]:
        # 1. Get user's WhatsApp sessions
        sessions_res = supabase.table("whatsapp_sessions") \
            .select("*") \
            .eq("user_id", user_id) \
            .eq("status", "CONNECTED") \
            .execute()

        if not sessions_res.data:
            logger.warning(f"No connected WhatsApp session for user {user_id}, returning demo result.")
            return {
                "post_id": f"demo_wa_{uuid.uuid4().hex[:8]}",
                "post_url": "https://whatsapp.com/channel/demo",
                "demo": True
            }

        session = sessions_res.data[0]
        session_id = session["id"]
        session_identifier = session["session_identifier"]

        # 2. Get the selected channel (or first available)
        channels_res = supabase.table("channels") \
            .select("*") \
            .eq("whatsapp_session_id", session_id) \
            .execute()

        if not channels_res.data:
            logger.warning(f"No channels found for session {session_id}, returning demo result.")
            return {
                "post_id": f"demo_wa_{uuid.uuid4().hex[:8]}",
                "post_url": "https://whatsapp.com/channel/demo",
                "demo": True
            }

        # Prefer selected channel, fallback to first
        target = None
        for ch in channels_res.data:
            if ch.get("is_selected"):
                target = ch
                break
        if not target:
            target = channels_res.data[0]

        channel_id = target["channel_id"]
        channel_name = target.get("name", "WhatsApp Channel")

        # 3. Publish via WhatsAppWebProvider → WCA service
        try:
            # Fetch automation to get media_url if any
            auto_res = supabase.table("automations").select("media_url").eq("id", automation_id).execute()
            media_url = auto_res.data[0].get("media_url") if auto_res.data else None

            if media_url and media_url.startswith("http"):
                result = await _provider.publish_image(
                    session_identifier, channel_id, media_url, content
                )
            else:
                result = await _provider.publish_text(
                    session_identifier, channel_id, content
                )

            post_id = result.get("messageId", f"wa_{uuid.uuid4().hex[:8]}")
            logger.info(f"✅ Published to WhatsApp Channel '{channel_name}' via WCA. messageId={post_id}")

            return {
                "post_id": post_id,
                "post_url": f"https://whatsapp.com/channel/{target.get('channel_id', '')}",
                "channel_name": channel_name,
                "status": "success"
            }

        except Exception as e:
            logger.error(f"❌ WhatsApp publish failed: {e}")
            raise Exception(f"WhatsApp Channel publish failed: {str(e)}")
