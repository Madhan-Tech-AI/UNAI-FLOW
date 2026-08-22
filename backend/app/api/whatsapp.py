from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from app.api.auth import get_current_user_id
from app.whatsapp.connection_manager import ConnectionManager
from app.whatsapp.baileys_provider import BaileysProvider
from app.core.config import settings

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

# Initialize provider and manager
# In a real app, you might want to use dependency injection for these
provider = BaileysProvider()
connection_manager = ConnectionManager(provider=provider)

class ConnectRequest(BaseModel):
    session_identifier: str

@router.post("/connect")
async def connect_whatsapp(req: ConnectRequest, user_id: str = Depends(get_current_user_id)):
    result = await connection_manager.start_connection(user_id, req.session_identifier)
    if not result["success"]:
        error_msg = result.get("error", "Failed to connect")
        # If the WCA service is unreachable, return 503 instead of 400
        if any(keyword in error_msg.lower() for keyword in ["connect", "timeout", "refused", "unreachable"]):
            raise HTTPException(status_code=503, detail=f"WhatsApp Channel service is currently unavailable. Please try again later. ({error_msg})")
        raise HTTPException(status_code=400, detail=error_msg)
    return {"success": True, "data": result}

@router.get("/status")
async def get_whatsapp_status(session_identifier: str, user_id: str = Depends(get_current_user_id)):
    result = await connection_manager.check_status(user_id, session_identifier)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error", "Session not found"))
    return {"success": True, "data": result}
