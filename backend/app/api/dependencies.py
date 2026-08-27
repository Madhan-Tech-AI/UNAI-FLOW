import uuid
from typing import Dict, Any, Optional
from fastapi import Header, HTTPException, Depends
from fastapi.security import HTTPAuthorizationCredentials
from app.core.exceptions import InvalidApiKeyException, InsufficientScopeException, RateLimitedException
from app.services.api_key_service import api_key_service
from app.core.rate_limiter import rate_limiter
from app.core.logging import request_id_ctx, org_id_ctx
from middleware.auth import verify_jwt

class AuthContext:
    def __init__(
        self,
        auth_type: str, # "jwt" or "api_key"
        organization_id: str,
        user_id: Optional[str] = None,
        api_key_id: Optional[str] = None,
        scopes: Optional[list] = None
    ):
        self.auth_type = auth_type
        self.organization_id = organization_id
        self.user_id = user_id or organization_id
        self.api_key_id = api_key_id
        self.scopes = scopes or ["*"]

async def get_auth_context(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
    x_request_id: Optional[str] = Header(None)
) -> AuthContext:
    """
    Unified authentication dependency supporting:
    1. Authorization: Bearer wa_live_... (API Keys)
    2. Authorization: Bearer <supabase_jwt> (Dashboard user session)
    3. X-API-Key: wa_live_... (Direct header)
    """
    req_id = x_request_id or f"req_{uuid.uuid4().hex[:12]}"
    request_id_ctx.set(req_id)
    
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    elif x_api_key:
        token = x_api_key.strip()
        
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required (Bearer token or X-API-Key).")
        
    # Check if this is a first-party API key
    if token.startswith("wa_live_") or token.startswith("wa_test_"):
        # Rate limit by API key
        rate_limiter.check_rate_limit(f"apikey:{token[:12]}")
        key_record = api_key_service.authenticate_raw_key(token)
        org_id = key_record["organization_id"]
        org_id_ctx.set(org_id)
        
        return AuthContext(
            auth_type="api_key",
            organization_id=org_id,
            api_key_id=key_record["id"],
            scopes=key_record.get("scopes", [])
        )
        
    # Otherwise treat as Supabase JWT
    try:
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        jwt_user = await verify_jwt(credentials=credentials)
        user_id = jwt_user["user_id"]
        # In this multi-tenant model, default organization_id maps to user_id or resolved org
        org_id = user_id
        org_id_ctx.set(org_id)
        
        # Rate limit by User ID
        rate_limiter.check_rate_limit(f"user:{user_id}")
        
        return AuthContext(
            auth_type="jwt",
            organization_id=org_id,
            user_id=user_id,
            scopes=["*"] # Dashboard users have full scope
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")

def require_scope(scope: str):
    async def scope_checker(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if "*" in ctx.scopes:
            return ctx
        if scope not in ctx.scopes:
            raise InsufficientScopeException(scope)
        return ctx
    return scope_checker
