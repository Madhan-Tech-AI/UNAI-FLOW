from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from typing import Dict, Any, Optional
from app.api.auth import get_current_user_id
from app.whatsapp.publisher import Publisher
from app.whatsapp.channel_manager import ChannelManager
from app.whatsapp.authorized_provider import MetaCloudAPIProvider
from app.core.config import settings

router = APIRouter(prefix="/channels", tags=["Publishing"])

publisher = Publisher()
# Dependency injection ideal here in a larger app
channel_manager = ChannelManager(provider=MetaCloudAPIProvider(token=settings.whatsapp_provider_config))

class TextPublishRequest(BaseModel):
    body: str

@router.post("/{channel_id}/publish/text")
async def publish_text(
    channel_id: str, 
    req: TextPublishRequest, 
    idempotency_key: Optional[str] = Header(None),
    user_id: str = Depends(get_current_user_id)
):
    # 1. Verify channel ownership
    channels = channel_manager.get_user_channels(user_id)
    if not any(c["id"] == channel_id for c in channels):
        raise HTTPException(status_code=403, detail={"code": "CHANNEL_PERMISSION_DENIED", "message": "The connected account cannot publish to this Channel."})
        
    # 2. Queue job
    payload = {"body": req.body}
    result = publisher.enqueue_job(user_id, channel_id, "text", payload, idempotency_key)
    
    return result

@router.get("/publishing/jobs/{job_id}")
async def get_job_status(job_id: str, user_id: str = Depends(get_current_user_id)):
    result = publisher.get_job_status(user_id, job_id)
    if not result["success"]:
        raise HTTPException(status_code=404, detail=result.get("error"))
    return {"success": True, "data": result["data"]}
