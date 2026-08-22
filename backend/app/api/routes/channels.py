from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from app.api.dependencies import get_auth_context, AuthContext, require_scope
from app.schemas.channel import ChannelResponse, ChannelListResponse
from app.services.channel_service import channel_service

router = APIRouter(tags=["WhatsApp Channels"])

@router.get("/v1/instances/{instance_id}/channels", response_model=List[ChannelResponse])
async def list_instance_channels(
    instance_id: str,
    ctx: AuthContext = Depends(require_scope("channels:read"))
):
    """Retrieve all discovered WhatsApp Channels for a specific instance."""
    return channel_service.list_instance_channels(ctx.organization_id, instance_id)

@router.post("/v1/instances/{instance_id}/channels/sync", response_model=List[ChannelResponse])
async def sync_instance_channels(
    instance_id: str,
    ctx: AuthContext = Depends(require_scope("channels:write"))
):
    """Force synchronize and discover administered WhatsApp channels from live account."""
    return await channel_service.sync_channels(ctx.organization_id, instance_id)

@router.get("/v1/channels", response_model=ChannelListResponse)
async def list_all_channels(ctx: AuthContext = Depends(require_scope("channels:read"))):
    """Retrieve all WhatsApp Channels discovered across all organization instances."""
    channels = channel_service.list_org_channels(ctx.organization_id)
    return ChannelListResponse(data=channels, total=len(channels))
