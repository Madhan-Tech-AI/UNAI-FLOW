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
    Publishes content to a real WhatsApp Channel (@newsletter JID) via WCA gateway.
    Ensures real numeric JIDs are resolved, preventing fake or dropped messages.
    """

    async def publish(self, content: str, user_id: str, automation_id: str) -> Dict[str, Any]:
        # 1. Get user's WhatsApp sessions
        sessions_res = supabase.table("whatsapp_sessions") \
            .select("*") \
            .eq("user_id", user_id) \
            .in_("status", ["CONNECTED", "READY"]) \
            .execute()

        if not sessions_res.data:
            logger.error(f"No connected WhatsApp session for user {user_id}")
            raise Exception("No connected WhatsApp account found. Please link your WhatsApp account in the WhatsApp Channels page before publishing.")

        session = sessions_res.data[0]
        session_id = session["id"]
        session_identifier = session["session_identifier"]

        # 2. Fetch automation to get media_url
        auto_res = supabase.table("automations").select("media_url").eq("id", automation_id).execute()
        automation_data = auto_res.data[0] if auto_res.data else {}
        raw_media_url = automation_data.get("media_url")

        # Resolve media URL to public URL if base64 or storage path
        media_url = None
        if raw_media_url:
            from services.media_manager import MediaManager
            media_url = MediaManager.get_public_url(raw_media_url)

        # 3. Determine target channel (prioritizing newsletter_jid)
        target = None

        # Try whatsapp_channels table
        try:
            wch_res = supabase.table("whatsapp_channels") \
                .select("*") \
                .eq("connection_id", session_identifier) \
                .execute()
            if wch_res.data:
                # Look for selected channel
                for ch in wch_res.data:
                    if ch.get("selected"):
                        meta = ch.get("metadata") if isinstance(ch.get("metadata"), dict) else {}
                        target_id = ch.get("newsletter_jid") or meta.get("newsletter_jid") or ch["channel_id"]
                        target = {
                            "channel_id": target_id,
                            "display_id": ch["channel_id"],
                            "name": ch.get("channel_name") or ch.get("name") or "WhatsApp Channel",
                            "link": ch.get("channel_link") or f"https://whatsapp.com/channel/{ch['channel_id']}"
                        }
                        break
                if not target and wch_res.data:
                    first = wch_res.data[0]
                    meta = first.get("metadata") if isinstance(first.get("metadata"), dict) else {}
                    target_id = first.get("newsletter_jid") or meta.get("newsletter_jid") or first["channel_id"]
                    target = {
                        "channel_id": target_id,
                        "display_id": first["channel_id"],
                        "name": first.get("channel_name") or first.get("name") or "WhatsApp Channel",
                        "link": first.get("channel_link") or f"https://whatsapp.com/channel/{first['channel_id']}"
                    }
        except Exception as e:
            logger.debug(f"[WA] query whatsapp_channels in adapter note: {e}")

        # Try channels table if not found
        if not target:
            try:
                ch_res = supabase.table("channels") \
                    .select("*") \
                    .eq("whatsapp_session_id", session_id) \
                    .execute()
                if ch_res.data:
                    for ch in ch_res.data:
                        if ch.get("is_selected"):
                            target = {
                                "channel_id": ch["channel_id"],
                                "display_id": ch["channel_id"],
                                "name": ch.get("name", "WhatsApp Channel"),
                                "link": f"https://whatsapp.com/channel/{ch['channel_id']}"
                            }
                            break
                    if not target and ch_res.data:
                        first = ch_res.data[0]
                        target = {
                            "channel_id": first["channel_id"],
                            "display_id": first["channel_id"],
                            "name": first.get("name", "WhatsApp Channel"),
                            "link": f"https://whatsapp.com/channel/{first['channel_id']}"
                        }
            except Exception as e:
                logger.debug(f"[WA] query channels in adapter note: {e}")

        if not target:
            logger.error(f"No WhatsApp channels found for session {session_id}")
            raise Exception("No WhatsApp Channels found for your connected account. Please verify or link your channel in WhatsApp Channels page.")

        channel_id = target["channel_id"]
        channel_name = target.get("name", "WhatsApp Channel")
        channel_link = target.get("link", f"https://whatsapp.com/channel/{target.get('display_id', channel_id)}")

        # 4. Ensure gateway has the socket ready before publishing
        try:
            await _provider.connect(session_identifier)
        except Exception as conn_warn:
            logger.warning(f"[WA] Pre-publish gateway connect note: {conn_warn}")

        # 5. Publish via WhatsAppWebProvider → WCA service
        try:
            if media_url and media_url.startswith("http"):
                result = await _provider.publish_image(
                    session_identifier, channel_id, media_url, content,
                    channel_name=channel_name, channel_link=channel_link
                )
            else:
                result = await _provider.publish_text(
                    session_identifier, channel_id, content,
                    channel_name=channel_name, channel_link=channel_link
                )

            post_id = result.get("postId") or result.get("messageId")
            if not post_id:
                raise Exception("Gateway did not return a valid post ID")

            logger.info(f"✅ Published to WhatsApp Channel '{channel_name}' via WCA. messageId={post_id}")

            return {
                "post_id": post_id,
                "post_url": channel_link,
                "channel_name": channel_name,
                "status": "success"
            }

        except Exception as e:
            logger.error(f"❌ WhatsApp publish failed: {e}")
            raise Exception(f"WhatsApp Channel publish failed: {str(e)}")
