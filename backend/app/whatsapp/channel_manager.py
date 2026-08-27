from typing import List, Dict, Any, Optional
from app.database.supabase import get_supabase_client
from app.whatsapp.provider import WhatsAppProvider
from app.whatsapp.session_manager import SessionManager
import logging

logger = logging.getLogger(__name__)

class ChannelManager:
    def __init__(self, provider: WhatsAppProvider):
        self.provider = provider
        self.session_manager = SessionManager()
        self.sb = get_supabase_client()

    def _ensure_connection_record(self, user_id: str, session: Dict[str, Any]):
        """Ensure a row exists in whatsapp_connections table for FK constraints."""
        session_identifier = session.get("session_identifier")
        if not session_identifier:
            return
        phone = session.get("phone_number") or ""
        try:
            self.sb.table("whatsapp_connections").upsert({
                "user_id": user_id,
                "connection_id": session_identifier,
                "status": session.get("status", "CONNECTED"),
                "phone_number": phone,
                "platform_account_name": f"+{phone}" if phone else "WhatsApp Account",
            }, on_conflict="connection_id").execute()
        except Exception as e:
            logger.debug(f"[WA] whatsapp_connections upsert note: {e}")

    async def sync_channels(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        """
        Fetches channels from the provider and upserts them into Supabase tables
        (both whatsapp_channels and channels).
        """
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session or session["status"] not in ("CONNECTED", "READY"):
            return {"success": False, "error": "WhatsApp session is not connected."}

        self._ensure_connection_record(user_id, session)

        try:
            # 1. Fetch from provider with retry for cold starts
            import asyncio
            channels = None
            delays = [3, 6, 12]

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

            # 2. Upsert to Supabase tables
            upserted_channels = []
            for ch in channels:
                ch_id = ch["id"]
                ch_name = ch.get("name") or "WhatsApp Channel"
                ch_link = ch.get("link") or f"https://whatsapp.com/channel/{ch_id}"
                ch_role = (ch.get("role") or "admin").lower()
                ch_subs = int(ch.get("subscribers_count") or ch.get("followers") or 0)
                ch_pic = ch.get("pictureUrl") or ch.get("picture") or ch.get("picture_url") or ""
                ch_desc = ch.get("description") or ""

                # Table 1: whatsapp_channels (official schema)
                try:
                    wa_ch_data = {
                        "connection_id": session_identifier,
                        "channel_id": ch_id,
                        "channel_name": ch_name,
                        "channel_link": ch_link,
                        "role": ch_role if ch_role in ("admin", "owner", "subscriber", "guest") else "admin",
                        "subscribers_count": ch_subs,
                        "verified": bool(ch.get("verified", False)),
                        "newsletter_jid": ch_id if "@newsletter" in ch_id else None,
                        "name": ch_name,
                        "metadata": {
                            "picture_url": ch_pic,
                            "description": ch_desc,
                        }
                    }
                    self.sb.table("whatsapp_channels").upsert(wa_ch_data, on_conflict="connection_id,channel_id").execute()
                except Exception as wch_err:
                    logger.debug(f"[WA] whatsapp_channels upsert note: {wch_err}")

                # Table 2: channels (legacy/alternate schema)
                try:
                    data = {
                        "whatsapp_session_id": session["id"],
                        "channel_id": ch_id,
                        "name": ch_name,
                        "description": ch_desc,
                        "picture_url": ch_pic,
                        "followers": ch_subs,
                        "role": ch_role.upper()
                    }
                    existing = self.sb.table("channels").select("id").eq("whatsapp_session_id", session["id"]).eq("channel_id", ch_id).execute()
                    if existing.data and len(existing.data) > 0:
                        res = self.sb.table("channels").update(data).eq("id", existing.data[0]["id"]).execute()
                        if res.data:
                            upserted_channels.append(res.data[0])
                    else:
                        res = self.sb.table("channels").insert(data).execute()
                        if res.data:
                            upserted_channels.append(res.data[0])
                except Exception as ch_err:
                    logger.debug(f"[WA] channels table upsert note: {ch_err}")

            return {"success": True, "channels": upserted_channels}

        except NotImplementedError as e:
            return {"success": False, "error": str(e), "code": "NOT_SUPPORTED_BY_PROVIDER"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def save_resolved_channel(self, user_id: str, session_identifier: str, channel_data: Dict[str, Any]) -> Dict[str, Any]:
        """Directly persists a resolved channel into the database."""
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session:
            sessions = self.session_manager.get_sessions_for_user(user_id)
            session = sessions[0] if sessions else None

        if not session:
            return channel_data

        self._ensure_connection_record(user_id, session)

        ch_id = channel_data.get("id") or channel_data.get("channel_id")
        ch_name = channel_data.get("name") or channel_data.get("channel_name") or "WhatsApp Channel"
        ch_link = channel_data.get("link") or channel_data.get("channel_link") or f"https://whatsapp.com/channel/{ch_id}"
        ch_role = (channel_data.get("role") or "admin").lower()
        ch_subs = int(channel_data.get("subscribers_count") or channel_data.get("followers") or 0)
        ch_pic = channel_data.get("pictureUrl") or channel_data.get("picture_url") or ""
        ch_desc = channel_data.get("description") or ""

        # 1. Upsert into whatsapp_channels with selected=True
        try:
            self.sb.table("whatsapp_channels").update({"selected": False}).eq("connection_id", session_identifier).execute()
            self.sb.table("whatsapp_channels").upsert({
                "connection_id": session_identifier,
                "channel_id": ch_id,
                "channel_name": ch_name,
                "channel_link": ch_link,
                "role": ch_role if ch_role in ("admin", "owner", "subscriber", "guest") else "admin",
                "subscribers_count": ch_subs,
                "verified": bool(channel_data.get("verified", False)),
                "selected": True,
                "newsletter_jid": ch_id if "@newsletter" in str(ch_id) else None,
                "name": ch_name,
                "metadata": {
                    "picture_url": ch_pic,
                    "description": ch_desc,
                }
            }, on_conflict="connection_id,channel_id").execute()
        except Exception as wch_err:
            logger.debug(f"[WA] whatsapp_channels save note: {wch_err}")

        # 2. Upsert into channels table
        try:
            self.sb.table("channels").update({"is_selected": False}).eq("whatsapp_session_id", session["id"]).execute()
            ch_data = {
                "whatsapp_session_id": session["id"],
                "channel_id": ch_id,
                "name": ch_name,
                "description": ch_desc,
                "picture_url": ch_pic,
                "followers": ch_subs,
                "role": ch_role.upper(),
                "is_selected": True
            }
            existing = self.sb.table("channels").select("id").eq("whatsapp_session_id", session["id"]).eq("channel_id", ch_id).execute()
            if existing.data and len(existing.data) > 0:
                self.sb.table("channels").update(ch_data).eq("id", existing.data[0]["id"]).execute()
            else:
                self.sb.table("channels").insert(ch_data).execute()
        except Exception as ch_err:
            logger.debug(f"[WA] channels table save note: {ch_err}")

        return channel_data

    def get_user_channels(self, user_id: str) -> List[Dict[str, Any]]:
        """Fetch all channels belonging to the user from whatsapp_channels or channels."""
        sessions = self.session_manager.get_sessions_for_user(user_id)
        if not sessions:
            return []

        session_ids = [s["id"] for s in sessions]
        session_identifiers = [s["session_identifier"] for s in sessions if s.get("session_identifier")]

        channels_map = {}

        # 1. Try whatsapp_channels table
        if session_identifiers:
            try:
                wa_res = self.sb.table("whatsapp_channels").select("*").in_("connection_id", session_identifiers).execute()
                if wa_res.data:
                    for ch in wa_res.data:
                        ch_id = ch["channel_id"]
                        channels_map[ch_id] = {
                            "id": ch_id,
                            "channel_id": ch_id,
                            "name": ch.get("channel_name") or ch.get("name") or "WhatsApp Channel",
                            "channel_name": ch.get("channel_name") or ch.get("name") or "WhatsApp Channel",
                            "link": ch.get("channel_link") or f"https://whatsapp.com/channel/{ch_id}",
                            "role": ch.get("role", "admin"),
                            "subscribers_count": ch.get("subscribers_count", 0),
                            "followers": ch.get("subscribers_count", 0),
                            "picture_url": ch.get("metadata", {}).get("picture_url") if isinstance(ch.get("metadata"), dict) else "",
                            "pictureUrl": ch.get("metadata", {}).get("picture_url") if isinstance(ch.get("metadata"), dict) else "",
                            "description": ch.get("metadata", {}).get("description") if isinstance(ch.get("metadata"), dict) else "",
                            "is_selected": bool(ch.get("selected", False)),
                            "selected": bool(ch.get("selected", False)),
                        }
            except Exception as e:
                logger.debug(f"[WA] query whatsapp_channels note: {e}")

        # 2. Try channels table
        if session_ids:
            try:
                res = self.sb.table("channels").select("*").in_("whatsapp_session_id", session_ids).execute()
                if res.data:
                    for ch in res.data:
                        ch_id = ch.get("channel_id") or ch.get("id")
                        if ch_id not in channels_map:
                            channels_map[ch_id] = {
                                "id": ch_id,
                                "channel_id": ch_id,
                                "name": ch.get("name", "WhatsApp Channel"),
                                "channel_name": ch.get("name", "WhatsApp Channel"),
                                "link": f"https://whatsapp.com/channel/{ch_id}",
                                "role": ch.get("role", "ADMIN"),
                                "subscribers_count": ch.get("followers", 0),
                                "followers": ch.get("followers", 0),
                                "picture_url": ch.get("picture_url", ""),
                                "pictureUrl": ch.get("picture_url", ""),
                                "description": ch.get("description", ""),
                                "is_selected": bool(ch.get("is_selected", False)),
                                "selected": bool(ch.get("is_selected", False)),
                            }
            except Exception as e:
                logger.debug(f"[WA] query channels note: {e}")

        return list(channels_map.values())

    def get_connected_channels(self, user_id: str) -> List[Dict[str, Any]]:
        """Get channels only from CONNECTED sessions — for automation channel selection."""
        sessions = self.session_manager.get_sessions_for_user(user_id)
        connected = [s for s in sessions if s.get("status") in ("CONNECTED", "READY")]
        if not connected:
            return []
        return self.get_user_channels(user_id)

    def select_channel(self, user_id: str, channel_id: str) -> bool:
        """Select a channel as the primary target for automations."""
        sessions = self.session_manager.get_sessions_for_user(user_id)
        session_ids = [s["id"] for s in sessions]
        session_identifiers = [s["session_identifier"] for s in sessions if s.get("session_identifier")]

        # 1. Update whatsapp_channels table
        if session_identifiers:
            try:
                self.sb.table("whatsapp_channels").update({"selected": False}).in_("connection_id", session_identifiers).execute()
                self.sb.table("whatsapp_channels").update({"selected": True}).in_("connection_id", session_identifiers).eq("channel_id", channel_id).execute()
            except Exception as e:
                logger.debug(f"[WA] update selected in whatsapp_channels note: {e}")

        # 2. Update channels table
        if session_ids:
            try:
                self.sb.table("channels").update({"is_selected": False}).in_("whatsapp_session_id", session_ids).execute()
                self.sb.table("channels").update({"is_selected": True}).in_("whatsapp_session_id", session_ids).eq("channel_id", channel_id).execute()
            except Exception as e:
                logger.debug(f"[WA] update is_selected in channels note: {e}")

        return True

    def delete_user_channels(self, user_id: str) -> None:
        """Delete all channels associated with the user's WhatsApp sessions."""
        sessions = self.session_manager.get_sessions_for_user(user_id)
        session_ids = [s["id"] for s in sessions]
        session_identifiers = [s["session_identifier"] for s in sessions if s.get("session_identifier")]

        if session_identifiers:
            try:
                self.sb.table("whatsapp_channels").delete().in_("connection_id", session_identifiers).execute()
            except Exception:
                pass

        if session_ids:
            try:
                self.sb.table("channels").delete().in_("whatsapp_session_id", session_ids).execute()
            except Exception:
                pass


