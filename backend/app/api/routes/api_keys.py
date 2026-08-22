from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from app.api.dependencies import get_auth_context, AuthContext
from app.schemas.api_key import ApiKeyCreate, ApiKeyResponse, ApiKeyCreatedResponse
from app.services.api_key_service import api_key_service

router = APIRouter(prefix="/v1/api-keys", tags=["API Keys"])

@router.post("", response_model=ApiKeyCreatedResponse)
async def create_api_key(
    req: ApiKeyCreate,
    ctx: AuthContext = Depends(get_auth_context)
):
    """Generate a new developer API key with designated scopes."""
    record, raw_key = api_key_service.create_key(
        organization_id=ctx.organization_id,
        name=req.name,
        scopes=req.scopes,
        expires_in_days=req.expires_in_days
    )
    
    return ApiKeyCreatedResponse(
        id=record["id"],
        organization_id=record["organization_id"],
        name=record["name"],
        prefix=record["prefix"],
        scopes=record["scopes"],
        raw_key=raw_key,
        expires_at=record.get("expires_at"),
        created_at=record.get("created_at")
    )

@router.get("", response_model=List[ApiKeyResponse])
async def list_api_keys(ctx: AuthContext = Depends(get_auth_context)):
    """List all active API keys for the current organization."""
    return api_key_service.list_keys(ctx.organization_id)

@router.delete("/{key_id}")
async def revoke_api_key(key_id: str, ctx: AuthContext = Depends(get_auth_context)):
    """Revoke an API key immediately."""
    success = api_key_service.revoke_key(ctx.organization_id, key_id)
    if not success:
        raise HTTPException(status_code=404, detail="API key not found or already revoked.")
    return {"success": True, "message": f"API key {key_id} revoked."}
