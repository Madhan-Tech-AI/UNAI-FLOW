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
            # 2. Ask provider to connect / initialize
            res = await self.provider.connect(session_identifier)
            
            # 3. If already connected, update DB and return
            if res.get("status") == "CONNECTED" or res.get("isReady"):
                self.session_manager.update_session_status(session["id"], "CONNECTED")
                return {"success": True, "status": "CONNECTED", "session_id": session["id"]}
                
            # 4. Fetch pairing data (QR code) from the provider
            pairing_data = await self.provider.get_pairing_data(session_identifier)
            if pairing_data.get("type") != "not_required":
                self.session_manager.update_session_status(session["id"], "WAITING_FOR_SCAN")
                return {"success": True, "status": "WAITING_FOR_SCAN", "pairing": pairing_data.get("data"), "session_id": session["id"]}
                
            # 5. Session initializing – QR not ready yet, tell frontend to poll
            self.session_manager.update_session_status(session["id"], "WAITING_FOR_SCAN")
            return {"success": True, "status": "WAITING_FOR_SCAN", "pairing": None, "session_id": session["id"]}
            
        except Exception as e:
            self.session_manager.update_session_status(session["id"], "ERROR")
            return {"success": False, "error": str(e)}

    async def check_status(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session:
            return {"success": False, "error": "Session not found"}
            
        # Ask provider for real status
        try:
            provider_status = await self.provider.get_status(session_identifier)
            if provider_status != session["status"]:
                self.session_manager.update_session_status(session["id"], provider_status)
                session["status"] = provider_status
        except Exception:
            pass
        
        result: Dict[str, Any] = {"success": True, "status": session["status"], "session": session}
        
        # If still waiting for scan, include QR data for frontend
        if session["status"] in ("WAITING_FOR_SCAN", "CONNECTING"):
            try:
                pairing_data = await self.provider.get_pairing_data(session_identifier)
                if pairing_data.get("type") != "not_required":
                    result["pairing"] = pairing_data.get("data")
            except Exception:
                pass
            
        return result
