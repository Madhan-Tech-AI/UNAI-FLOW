from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from app.api.auth import get_current_user_id
from app.whatsapp.connection_manager import ConnectionManager
from app.whatsapp.baileys_provider import BaileysProvider
from app.core.config import settings
import traceback
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

# Initialize provider and manager
# In a real app, you might want to use dependency injection for these
provider = BaileysProvider()
connection_manager = ConnectionManager(provider=provider)

class ConnectRequest(BaseModel):
    session_identifier: str

@router.post("/connect")
async def connect_whatsapp(req: ConnectRequest, user_id: str = Depends(get_current_user_id)):
    try:
        result = await connection_manager.start_connection(user_id, req.session_identifier)
    except Exception as e:
        logger.error(f"WhatsApp connect error (outer): {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Internal error during WhatsApp connection: {str(e)}")
    
    if not result["success"]:
        error_msg = result.get("error") or "Failed to connect (unknown error)"
        error_tb = result.get("traceback", "")
        logger.error(f"WhatsApp connect failed: {error_msg}\n{error_tb}")
        # If the WCA service is unreachable, return 503 instead of 400
        if any(keyword in error_msg.lower() for keyword in ["timeout", "refused", "unreachable", "connecterror", "connectionerror"]):
            raise HTTPException(status_code=503, detail=f"WhatsApp Channel service is currently unavailable. Please try again later. ({error_msg})")
        raise HTTPException(status_code=400, detail=error_msg)
    return {"success": True, "data": result}

@router.get("/status")
async def get_whatsapp_status(session_identifier: str, user_id: str = Depends(get_current_user_id)):
    result = await connection_manager.check_status(user_id, session_identifier)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error", "Session not found"))
    return {"success": True, "data": result}

@router.get("/test-connect")
async def test_connect_whatsapp():
    """Temporary debug endpoint: runs the full connect flow with a test user."""
    test_user_id = "00000000-0000-0000-0000-000000000000"
    test_session = "debug_e2e_test"
    try:
        result = await connection_manager.start_connection(test_user_id, test_session)
        return {"step": "start_connection returned", "result": result}
    except Exception as e:
        return {"step": "start_connection threw", "error": str(e), "traceback": traceback.format_exc()}
