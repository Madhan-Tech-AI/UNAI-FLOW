"""
WhatsApp API Router — handles connection lifecycle, status polling, and gateway health.

Endpoints:
- POST /api/whatsapp/connect          — start a new WhatsApp connection
- GET  /api/whatsapp/status           — poll session status (includes QR when ready)
- POST /api/whatsapp/disconnect       — disconnect WhatsApp session
- GET  /api/whatsapp/gateway/health   — check WCA gateway health
- GET  /api/whatsapp/test-connect     — debug endpoint
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
from app.api.auth import get_current_user_id
from app.whatsapp.connection_manager import ConnectionManager
from app.whatsapp.whatsapp_web_provider import WhatsAppWebProvider
from app.core.config import settings
import traceback
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

# Initialize provider and manager
provider = WhatsAppWebProvider()
connection_manager = ConnectionManager(provider=provider)


class ConnectRequest(BaseModel):
    session_identifier: Optional[str] = None


class DisconnectRequest(BaseModel):
    session_identifier: str


@router.post("/connect")
async def connect_whatsapp(
    req: ConnectRequest, user_id: str = Depends(get_current_user_id)
):
    """
    Start a WhatsApp connection. Returns session status immediately.
    Frontend should then poll /status for updates.
    """
    try:
        result = await connection_manager.start_connection(
            user_id, req.session_identifier
        )
    except Exception as e:
        logger.error(f"WhatsApp connect error (outer): {traceback.format_exc()}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal error during WhatsApp connection: {str(e)}",
        )

    # Always return 200 with result — frontend checks data.status and data.code
    return {"success": True, "data": result}


@router.get("/status")
async def get_whatsapp_status(
    session_identifier: str, user_id: str = Depends(get_current_user_id)
):
    """
    Poll session status. Returns current status, gateway reachability, and QR data when available.
    
    Response includes:
    - status: current session status
    - gateway_reachable: whether the WCA gateway responded
    - gateway_error: error message if gateway is unreachable
    - pairing: base64 QR image data (when status=WAITING_FOR_SCAN)
    """
    result = await connection_manager.check_status(user_id, session_identifier)
    if not result["success"]:
        raise HTTPException(
            status_code=404, detail=result.get("error", "Session not found")
        )
    return {"success": True, "data": result}


@router.get("/sessions")
async def get_user_sessions(user_id: str = Depends(get_current_user_id)):
    """Get all WhatsApp sessions belonging strictly to the authenticated user with real-time status."""
    sessions = connection_manager.session_manager.get_sessions_for_user(user_id)
    # Check gateway live status for CONNECTED sessions
    for s in sessions:
        if s.get("status") in ("CONNECTED", "READY"):
            sess_id = s.get("session_identifier")
            if sess_id:
                try:
                    gw_status = await provider.get_full_status(sess_id)
                    gw_state = gw_status.get("status")
                    if gw_state in ["QR_READY", "WAITING_FOR_SCAN", "DISCONNECTED"]:
                        new_st = "WAITING_FOR_SCAN" if gw_state in ["QR_READY", "WAITING_FOR_SCAN"] else "DISCONNECTED"
                        connection_manager.session_manager.update_session_status(s["id"], new_st)
                        s["status"] = new_st
                except Exception:
                    pass
    return {"success": True, "data": sessions}


@router.post("/disconnect")
async def disconnect_whatsapp(
    req: DisconnectRequest, user_id: str = Depends(get_current_user_id)
):
    """Disconnect a WhatsApp session and clean up."""
    result = await connection_manager.disconnect(user_id, req.session_identifier)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error", "Session not found"))
    return {"success": True, "data": result}


@router.get("/gateway/health")
async def get_gateway_health():
    """
    Check WCA gateway health. Returns structured health info.
    
    Response:
    - ok: whether gateway is reachable and healthy
    - gateway_url: which URL was resolved
    - service: gateway service name
    - status: gateway health status
    - version: gateway version
    - active_sessions: number of active sessions
    """
    result = await connection_manager.get_gateway_health()
    return result


@router.get("/test-connect")
async def test_connect_whatsapp():
    """
    Debug endpoint: runs the full connect flow with a test user.
    Useful for verifying the entire pipeline without frontend.
    """
    test_user_id = "00000000-0000-0000-0000-000000000000"
    test_session = "debug_e2e_test"
    try:
        result = await connection_manager.start_connection(test_user_id, test_session)
        return {"step": "start_connection returned", "result": result}
    except Exception as e:
        return {
            "step": "start_connection threw",
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
