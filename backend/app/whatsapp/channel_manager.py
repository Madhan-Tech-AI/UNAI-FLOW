from typing import List, Dict, Any
from app.database.supabase import get_supabase_client
from app.whatsapp.provider import WhatsAppProvider
from app.whatsapp.session_manager import SessionManager

class ChannelManager:
    def __init__(self, provider: WhatsAppProvider):
        self.provider = provider
        self.session_manager = SessionManager()
        self.sb = get_supabase_client()

    async def sync_channels(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        """
        Fetches channels from the provider and upserts them into Supabase.
        Includes retry logic for WCA cold-start 429 errors.
        """
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session or session["status"] != "CONNECTED":
            return {"success": False, "error": "WhatsApp session is not connected."}
            
        try:
            # 1. Fetch from provider with retry for cold starts
            import asyncio
            channels = None
            delays = [5, 10, 20]
            
            for attempt in range(len(delays) + 1):
                try:
                    channels = await self.provider.get_channels(session_identifier)
                    break
                except Exception as e:
                    if attempt < len(delays):
                        await asyncio.sleep(delays[attempt])
                        continue
                    raise
            
            if channels is None:
                channels = []
            
            # 2. Upsert to Supabase
            upserted_channels = []
            for ch in channels:
                data = {
                    "whatsapp_session_id": session["id"],
                    "channel_id": ch["id"],
                    "name": ch.get("name"),
                    "description": ch.get("description"),
                    "picture_url": ch.get("pictureUrl") or ch.get("picture") or ch.get("picture_url"),
                    "followers": ch.get("subscribers_count") or ch.get("followers") or 0,
                    "role": ch.get("role", "UNKNOWN")
                }
                
                # Check if exists
                existing = self.sb.table("channels").select("id").eq("whatsapp_session_id", session["id"]).eq("channel_id", ch["id"]).execute()
                
                if existing.data and len(existing.data) > 0:
                    res = self.sb.table("channels").update(data).eq("id", existing.data[0]["id"]).execute()
                    upserted_channels.append(res.data[0])
                else:
                    res = self.sb.table("channels").insert(data).execute()
                    upserted_channels.append(res.data[0])
                    
            return {"success": True, "channels": upserted_channels}
            
        except NotImplementedError as e:
            return {"success": False, "error": str(e), "code": "NOT_SUPPORTED_BY_PROVIDER"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_user_channels(self, user_id: str) -> List[Dict[str, Any]]:
        # Need to join with whatsapp_sessions to ensure ownership
        sessions = self.session_manager.get_sessions_for_user(user_id)
        if not sessions:
            return []
            
        session_ids = [s["id"] for s in sessions]
        if not session_ids:
            return []
            
        res = self.sb.table("channels").select("*").in_("whatsapp_session_id", session_ids).execute()
        return res.data

    def get_connected_channels(self, user_id: str) -> List[Dict[str, Any]]:
        """Get channels only from CONNECTED sessions — for automation channel selection."""
        sessions = self.session_manager.get_sessions_for_user(user_id)
        connected_session_ids = [
            s["id"] for s in sessions
            if s.get("status") in ("CONNECTED", "READY")
        ]
        if not connected_session_ids:
            return []

        res = self.sb.table("channels").select("*").in_("whatsapp_session_id", connected_session_ids).execute()
        return res.data or []

    def select_channel(self, user_id: str, channel_id: str) -> bool:
        # Verify ownership
        channels = self.get_user_channels(user_id)
        if not any(c["id"] == channel_id for c in channels):
            raise ValueError("Channel not found or unauthorized")
            
        # Deselect all for the same user (or just the same session depending on requirements)
        session_ids = list(set(c["whatsapp_session_id"] for c in channels))
        self.sb.table("channels").update({"is_selected": False}).in_("whatsapp_session_id", session_ids).execute()
        
        # Select the target channel
        res = self.sb.table("channels").update({"is_selected": True}).eq("id", channel_id).execute()
        return len(res.data) > 0

    def delete_user_channels(self, user_id: str) -> None:
        """Delete all channels associated with the user's WhatsApp sessions."""
        sessions = self.session_manager.get_sessions_for_user(user_id)
        session_ids = [s["id"] for s in sessions]
        if session_ids:
            self.sb.table("channels").delete().in_("whatsapp_session_id", session_ids).execute()

