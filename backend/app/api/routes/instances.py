from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Dict, Any
from app.api.dependencies import get_auth_context, AuthContext, require_scope
from app.schemas.instance import (
    InstanceCreate,
    InstanceResponse,
    InstanceQRResponse,
    InstanceHealthResponse
)
from app.services.instance_service import instance_service

router = APIRouter(prefix="/v1/instances", tags=["WhatsApp Instances"])

@router.post("", response_model=InstanceResponse)
async def create_instance(
    req: InstanceCreate,
    ctx: AuthContext = Depends(require_scope("instances:write"))
):
    """Create a new WhatsApp gateway instance for the organization."""
    return instance_service.create_instance(
        organization_id=ctx.organization_id,
        display_name=req.display_name
    )

@router.get("", response_model=List[InstanceResponse])
async def list_instances(ctx: AuthContext = Depends(require_scope("instances:read"))):
    """List all instances registered under the organization."""
    return instance_service.list_instances(ctx.organization_id)

@router.get("/{instance_id}", response_model=InstanceResponse)
async def get_instance(
    instance_id: str,
    ctx: AuthContext = Depends(require_scope("instances:read"))
):
    """Retrieve instance details and current state."""
    return instance_service.get_instance(ctx.organization_id, instance_id)

@router.post("/{instance_id}/connect")
async def connect_instance(
    instance_id: str,
    ctx: AuthContext = Depends(require_scope("instances:write"))
):
    """Initiate linked-device connection and begin QR generation."""
    return await instance_service.connect_instance(ctx.organization_id, instance_id)

@router.get("/{instance_id}/qr", response_model=InstanceQRResponse)
async def get_instance_qr(
    instance_id: str,
    ctx: AuthContext = Depends(require_scope("instances:read"))
):
    """Fetch active QR code payload for device pairing."""
    return await instance_service.get_qr(ctx.organization_id, instance_id)

@router.get("/{instance_id}/health", response_model=InstanceHealthResponse)
async def get_instance_health(
    instance_id: str,
    ctx: AuthContext = Depends(require_scope("instances:read"))
):
    """Check heartbeat and connection health of the instance."""
    return await instance_service.get_health(ctx.organization_id, instance_id)

@router.post("/{instance_id}/logout")
async def logout_instance(
    instance_id: str,
    ctx: AuthContext = Depends(require_scope("instances:write"))
):
    """Log out and unlink WhatsApp account."""
    success = await instance_service.logout_instance(ctx.organization_id, instance_id)
    return {"success": success, "message": f"Instance {instance_id} logged out successfully."}
