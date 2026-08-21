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

    def create_or_update_session(self, user_id: str, session_identifier: str, provider: str, status: str = "CONNECTING") -> Dict[str, Any]:
        existing = self.get_session(user_id, session_identifier)
        if existing:
            res = self.sb.table("whatsapp_sessions").update({
                "status": status,
                "provider": provider
            }).eq("id", existing["id"]).execute()
            return res.data[0]
        else:
            res = self.sb.table("whatsapp_sessions").insert({
                "user_id": user_id,
                "session_identifier": session_identifier,
                "status": status,
                "provider": provider
            }).execute()
            return res.data[0]

    def update_session_status(self, session_id: str, status: str) -> None:
        self.sb.table("whatsapp_sessions").update({"status": status}).eq("id", session_id).execute()
