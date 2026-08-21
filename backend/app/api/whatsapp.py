from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any
from app.api.auth import get_current_user_id
from app.whatsapp.connection_manager import ConnectionManager
from app.whatsapp.authorized_provider import MetaCloudAPIProvider
from app.core.config import settings

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

# Initialize provider and manager
# In a real app, you might want to use dependency injection for these
provider = MetaCloudAPIProvider(token=settings.whatsapp_provider_config)
connection_manager = ConnectionManager(provider=provider)

class ConnectRequest(BaseModel):
    session_identifier: str

@router.post("/connect")
async def connect_whatsapp(req: ConnectRequest, user_id: str = Depends(get_current_user_id)):
    result = await connection_manager.start_connection(user_id, req.session_identifier)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("error", "Failed to connect"))
    return {"success": True, "data": result}

@router.get("/status")
async def get_whatsapp_status(session_identifier: str, user_id: str = Depends(get_current_user_id)):
    result = await connection_manager.check_status(user_id, session_identifier)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error", "Session not found"))
    return {"success": True, "data": result}
