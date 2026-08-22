from typing import Dict, Any, Optional
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

    async def start_connection(self, user_id: str, session_identifier: Optional[str] = None) -> Dict[str, Any]:
        # 1. Check for existing active sessions
        active_states = ["INITIALIZING", "WAITING_FOR_SCAN", "AUTHENTICATING", "CONNECTING"]
        existing_sessions = self.session_manager.get_sessions_for_user(user_id)
        
        target_session = None
        if session_identifier:
            target_session = next((s for s in existing_sessions if s["session_identifier"] == session_identifier), None)
            
        if not target_session:
            # Look for ANY active or connected session for this user
            for s in existing_sessions:
                if s["status"] == "CONNECTED":
                    return {"success": True, "status": "CONNECTED", "session_identifier": s["session_identifier"]}
                if s["status"] in active_states:
                    return {"success": True, "status": s["status"], "session_identifier": s["session_identifier"]}
        
        # If we reach here, we must create a new connection
        import uuid
        if not session_identifier:
            session_identifier = f"sess_{uuid.uuid4().hex}"
            
        # Create or update session in DB as INITIALIZING
        session = self.session_manager.create_or_update_session(user_id, session_identifier, "whatsapp_web", "INITIALIZING")
        
        try:
            # 2. Ask provider to connect / initialize (WCA API is non-blocking)
            import asyncio
            import httpx
            
            delays = [2, 4, 8]
            for attempt in range(4):
                try:
                    await self.provider.connect(session_identifier)
                    break
                except httpx.HTTPStatusError as e:
                    if e.response.status_code in [429, 502, 503, 504] and attempt < 3:
                        retry_after = e.response.headers.get("Retry-After")
                        sleep_time = int(retry_after) if retry_after and retry_after.isdigit() else delays[attempt]
                        logger.warning(f"WCA service unavailable/rate limited ({e.response.status_code}), retrying in {sleep_time}s...")
                        await asyncio.sleep(sleep_time)
                        continue
                    raise
            
            # 3. Return immediately so frontend doesn't timeout
            return {"success": True, "status": "INITIALIZING", "session_identifier": session_identifier}
            
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
            
            # Map WCA QR_READY to our frontend's WAITING_FOR_SCAN
            if provider_status_str == "QR_READY":
                provider_status_str = "WAITING_FOR_SCAN"
                
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
        
        # If we need a QR scan, fetch the pairing data
        if session["status"] == "WAITING_FOR_SCAN":
            try:
                pairing_data = await self.provider.get_pairing_data(session_identifier)
                if pairing_data.get("type") == "qr":
                    result["pairing"] = pairing_data.get("data")
            except Exception as e:
                logger.error(f"Error fetching pairing data: {e}")
                
        return result
