from typing import Dict, Any
from .session_manager import SessionManager
from .provider import WhatsAppProvider
import traceback
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    """
    Orchestrates the connection workflow between the frontend, Supabase, and the WhatsAppProvider.
    """
    def __init__(self, provider: WhatsAppProvider):
        self.provider = provider
        self.session_manager = SessionManager()

    async def start_connection(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        # 1. Create or update session in DB as INITIALIZING
        session = self.session_manager.create_or_update_session(user_id, session_identifier, "whatsapp_web", "INITIALIZING")
        
        try:
            # 2. Ask provider to connect / initialize (WCA API is non-blocking)
            import asyncio
            import httpx
            for attempt in range(3):
                try:
                    await self.provider.connect(session_identifier)
                    break
                except httpx.HTTPStatusError as e:
                    if e.response.status_code in [502, 503, 504] and attempt < 2:
                        logger.warning(f"WCA service unavailable (cold start?), retrying in 5s... {e}")
                        await asyncio.sleep(5)
                        continue
                    raise
            
            # 3. Return immediately so frontend doesn't timeout
            return {"success": True, "status": "INITIALIZING", "session_id": session["id"]}
            
        except Exception as e:
            tb = traceback.format_exc()
            logger.error(f"Connection manager error for session {session_identifier}: {repr(e)}\n{tb}")
            self.session_manager.update_session_status(session["id"], "ERROR")
            return {"success": False, "status": "ERROR", "error": str(e), "traceback": tb}

    async def check_status(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session:
            return {"success": False, "error": "Session not found"}
            
        # Ask provider for real status
        try:
            full_status = await self.provider.get_full_status(session_identifier)
            provider_status_str = full_status.get("status", session["status"])
            
            if provider_status_str != session["status"]:
                if provider_status_str == "CONNECTED":
                    user_info = full_status.get("userInfo") or {}
                    phone = user_info.get("phone")
                    self.session_manager.update_session_connection_details(session["id"], phone)
                else:
                    self.session_manager.update_session_status(session["id"], provider_status_str)
                session["status"] = provider_status_str
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
