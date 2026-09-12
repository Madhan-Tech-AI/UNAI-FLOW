from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any
from app.api.dependencies import get_auth_context, AuthContext
from app.schemas.api_key import ApiKeyCreate, ApiKeyResponse, ApiKeyCreatedResponse, ApiKeyRotateRequest
from app.services.api_key_service import api_key_service

router = APIRouter(prefix="/v1/api-keys", tags=["API Keys"])


@router.post("", response_model=ApiKeyCreatedResponse)
async def create_api_key(
    req: ApiKeyCreate,
    ctx: AuthContext = Depends(get_auth_context)
):
    """Generate a new developer API key with designated scopes, environment, and optional rate limit."""
    record, raw_key = api_key_service.create_key(
        organization_id=ctx.organization_id,
        name=req.name,
        scopes=req.scopes,
        expires_in_days=req.expires_in_days,
        environment=req.environment,
        rate_limit_override=req.rate_limit_override,
        description=req.description
    )

    return ApiKeyCreatedResponse(
        id=record["id"],
        organization_id=record["organization_id"],
        name=record["name"],
        description=record.get("description"),
        prefix=record["prefix"],
        scopes=record["scopes"],
        environment=record.get("environment", "live"),
        rate_limit_override=record.get("rate_limit_override"),
        raw_key=raw_key,
        expires_at=record.get("expires_at"),
        created_at=record.get("created_at")
    )


@router.get("", response_model=List[ApiKeyResponse])
async def list_api_keys(ctx: AuthContext = Depends(get_auth_context)):
    """List all active API keys for the current organization."""
    return api_key_service.list_keys(ctx.organization_id)


@router.post("/{key_id}/rotate", response_model=ApiKeyCreatedResponse)
async def rotate_api_key(
    key_id: str,
    req: ApiKeyRotateRequest = ApiKeyRotateRequest(),
    ctx: AuthContext = Depends(get_auth_context)
):
    """Revoke an existing API key and issue a new one with the same configuration."""
    try:
        record, raw_key = api_key_service.rotate_key(
            organization_id=ctx.organization_id,
            key_id=key_id,
            expires_in_days=req.expires_in_days
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rotate API key: {str(e)}")

    return ApiKeyCreatedResponse(
        id=record["id"],
        organization_id=record["organization_id"],
        name=record["name"],
        description=record.get("description"),
        prefix=record["prefix"],
        scopes=record["scopes"],
        environment=record.get("environment", "live"),
        rate_limit_override=record.get("rate_limit_override"),
        raw_key=raw_key,
        expires_at=record.get("expires_at"),
        created_at=record.get("created_at")
    )


@router.delete("/{key_id}")
async def revoke_api_key(key_id: str, ctx: AuthContext = Depends(get_auth_context)):
    """Revoke an API key immediately."""
    success = api_key_service.revoke_key(ctx.organization_id, key_id)
    if not success:
        raise HTTPException(status_code=404, detail="API key not found or already revoked.")
    return {"success": True, "message": f"API key {key_id} revoked."}
