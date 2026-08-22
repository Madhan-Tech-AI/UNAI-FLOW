from app.database.supabase import get_supabase_client
from typing import Optional, Dict, Any

class SessionManager:
    """
    Manages WhatsApp sessions in Supabase securely.
    """
    def __init__(self):
        self.sb = get_supabase_client()

    def get_session(self, user_id: str, session_identifier: str) -> Optional[Dict[str, Any]]:
        res = self.sb.table("whatsapp_sessions").select("*").eq("user_id", user_id).eq("session_identifier", session_identifier).execute()
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None
        
    def get_sessions_for_user(self, user_id: str) -> list[Dict[str, Any]]:
        res = self.sb.table("whatsapp_sessions").select("*").eq("user_id", user_id).execute()
        return res.data

    def create_or_update_session(self, user_id: str, session_identifier: str, provider: str = "whatsapp_web", status: str = "CONNECTING") -> Dict[str, Any]:
        existing = self.get_session(user_id, session_identifier)
        if existing:
            res = self.sb.table("whatsapp_sessions").update({
                "status": status,
                "provider": provider,
                "updated_at": "now()"
            }).eq("id", existing["id"]).execute()
            if not res.data:
                raise Exception("Failed to update session: No data returned from Supabase. Check RLS or DB connection.")
            return res.data[0]
        else:
            res = self.sb.table("whatsapp_sessions").insert({
                "user_id": user_id,
                "session_identifier": session_identifier,
                "status": status,
                "provider": provider
            }).execute()
            if not res.data:
                raise Exception("Failed to create session: No data returned from Supabase. Check RLS or DB connection.")
            return res.data[0]

    def update_session_status(self, session_id: str, status: str) -> None:
        self.sb.table("whatsapp_sessions").update({
            "status": status,
            "updated_at": "now()"
        }).eq("id", session_id).execute()

    def update_session_connection_details(self, session_id: str, phone_number: str) -> None:
        self.sb.table("whatsapp_sessions").update({
            "status": "CONNECTED",
            "phone_number": phone_number,
            "last_connected_at": "now()",
            "updated_at": "now()"
        }).eq("id", session_id).execute()
