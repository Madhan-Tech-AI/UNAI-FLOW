from typing import Dict, Any
from .session_manager import SessionManager
from .provider import WhatsAppProvider

class ConnectionManager:
    """
    Orchestrates the connection workflow between the frontend, Supabase, and the WhatsAppProvider.
    """
    def __init__(self, provider: WhatsAppProvider):
        self.provider = provider
        self.session_manager = SessionManager()

    async def start_connection(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        # 1. Create or update session in DB as CONNECTING
        session = self.session_manager.create_or_update_session(user_id, session_identifier, "meta", "CONNECTING")
        
        try:
            # 2. Ask provider to connect
            res = await self.provider.connect(session_identifier)
            
            # 3. If connected, update DB
            if res.get("status") == "CONNECTED":
                self.session_manager.update_session_status(session["id"], "CONNECTED")
                return {"success": True, "status": "CONNECTED", "session_id": session["id"]}
                
            # If pairing data is returned (like QR code)
            pairing_data = await self.provider.get_pairing_data(session_identifier)
            if pairing_data.get("type") != "not_required":
                self.session_manager.update_session_status(session["id"], "WAITING_FOR_SCAN")
                return {"success": True, "status": "WAITING_FOR_SCAN", "pairing": pairing_data, "session_id": session["id"]}
                
            return {"success": True, "status": res.get("status"), "session_id": session["id"]}
            
        except Exception as e:
            self.session_manager.update_session_status(session["id"], "ERROR")
            return {"success": False, "error": str(e)}

    async def check_status(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session:
            return {"success": False, "error": "Session not found"}
            
        # Optional: Ask provider for real status
        try:
            provider_status = await self.provider.get_status(session_identifier)
            if provider_status != session["status"]:
                self.session_manager.update_session_status(session["id"], provider_status)
                session["status"] = provider_status
        except Exception:
            pass
            
        return {"success": True, "status": session["status"], "session": session}
