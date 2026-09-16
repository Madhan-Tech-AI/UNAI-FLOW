import uuid
import base64
from typing import Dict, Any, Optional
from fastapi import Header, HTTPException, Depends
from fastapi.security import HTTPAuthorizationCredentials
from app.core.exceptions import InvalidApiKeyException, InsufficientScopeException, RateLimitedException
from app.services.api_key_service import api_key_service
from app.services.application_service import application_service
from app.core.rate_limiter import rate_limiter
from app.core.logging import request_id_ctx, org_id_ctx, app_id_ctx
from middleware.auth import verify_jwt


class AuthContext:
    def __init__(
        self,
        auth_type: str,  # "jwt", "api_key", or "client_credentials"
        organization_id: str,
        user_id: Optional[str] = None,
        api_key_id: Optional[str] = None,
        application_id: Optional[str] = None,
        whatsapp_number: Optional[str] = None,
        scopes: Optional[list] = None,
        environment: str = "live"
    ):
        self.auth_type = auth_type
        self.organization_id = organization_id
        self.user_id = user_id or organization_id
        self.api_key_id = api_key_id
        self.application_id = application_id
        self.whatsapp_number = whatsapp_number
        self.scopes = scopes or ["*"]
        self.environment = environment

    def require_scope(self, required_scope: str):
        if "*" in self.scopes:
            return
        # Expand scope aliases
        alias_map = {
            "campaigns:write": ["campaigns:create", "campaigns:launch", "campaigns:cancel"],
        }
        expanded = set(self.scopes)
        for scope in list(expanded):
            if scope in alias_map:
                expanded.update(alias_map[scope])
        if required_scope not in expanded:
            raise InsufficientScopeException(required_scope)


async def get_auth_context(
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None),
    x_client_id: Optional[str] = Header(None),
    x_client_secret: Optional[str] = Header(None),
    x_request_id: Optional[str] = Header(None)
) -> AuthContext:
    """
    Unified authentication dependency supporting:
    1. Authorization: Bearer wa_live_... / wa_test_... (API Keys)
    2. Authorization: Basic <base64(client_id:client_secret)> (Client Credentials)
    3. X-Client-ID & X-Client-Secret headers (CRM Client Credentials)
    4. Authorization: Bearer <supabase_jwt> (Dashboard user session)
    5. X-API-Key: wa_live_... / wa_test_... (Direct header)
    """
    req_id = x_request_id or f"req_{uuid.uuid4().hex[:12]}"
    request_id_ctx.set(req_id)

    # 1. Check for explicit Client Credentials headers
    if x_client_id and x_client_secret:
        app = application_service.verify_client_credentials(x_client_id.strip(), x_client_secret.strip())
        rate_limiter.check_rate_limit(f"app:{app['id'][:12]}")
        org_id = app["organization_id"]
        org_id_ctx.set(org_id)
        app_id_ctx.set(app["id"])
        return AuthContext(
            auth_type="client_credentials",
            organization_id=org_id,
            application_id=app["id"],
            whatsapp_number=app.get("whatsapp_number"),
            scopes=app.get("scopes", ["*"]),
            environment=app.get("environment", "live")
        )

    # 2. Check for Basic Auth (Client Credentials)
    if authorization and authorization.startswith("Basic "):
        try:
            raw_b64 = authorization[6:].strip()
            decoded = base64.b64decode(raw_b64).decode("utf-8")
            if ":" in decoded:
                c_id, c_sec = decoded.split(":", 1)
                app = application_service.verify_client_credentials(c_id.strip(), c_sec.strip())
                rate_limiter.check_rate_limit(f"app:{app['id'][:12]}")
                org_id = app["organization_id"]
                org_id_ctx.set(org_id)
                app_id_ctx.set(app["id"])
                return AuthContext(
                    auth_type="client_credentials",
                    organization_id=org_id,
                    application_id=app["id"],
                    whatsapp_number=app.get("whatsapp_number"),
                    scopes=app.get("scopes", ["*"]),
                    environment=app.get("environment", "live")
                )
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid Basic authentication credentials.")

    # 3. Extract Bearer token or X-API-Key
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
    elif x_api_key:
        token = x_api_key.strip()

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Provide Bearer token, X-API-Key, or X-Client-ID & X-Client-Secret."
        )

    # 4. Check if this is a first-party API key
    if token.startswith("wa_live_") or token.startswith("wa_test_"):
        key_record = api_key_service.authenticate_raw_key(token)

        # Rate limit by API key with possible override
        rate_override = key_record.get("rate_limit_override")
        rate_limiter.check_rate_limit(f"apikey:{token[:12]}", limit=rate_override)

        org_id = key_record["organization_id"]
        org_id_ctx.set(org_id)

        # Extract application_id if this key belongs to an application
        application_id = key_record.get("application_id")
        whatsapp_number = None
        if application_id:
            app_id_ctx.set(application_id)
            application_service.record_usage(application_id)
            try:
                app_data = application_service.check_application_status(application_id)
                whatsapp_number = app_data.get("whatsapp_number")
            except Exception:
                pass

        return AuthContext(
            auth_type="api_key",
            organization_id=org_id,
            api_key_id=key_record["id"],
            application_id=application_id,
            whatsapp_number=whatsapp_number,
            scopes=key_record.get("scopes", []),
            environment=key_record.get("environment", "live")
        )

    # 5. Otherwise treat as Supabase JWT
    try:
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        jwt_user = await verify_jwt(credentials=credentials)
        user_id = jwt_user["user_id"]
        org_id = user_id
        org_id_ctx.set(org_id)

        # Rate limit by User ID
        rate_limiter.check_rate_limit(f"user:{user_id}")

        # Ensure organization record exists for this user in public.organizations
        try:
            application_service.ensure_organization(org_id)
        except Exception:
            pass

        return AuthContext(
            auth_type="jwt",
            organization_id=org_id,
            user_id=user_id,
            scopes=["*"],  # Dashboard users have full scope
            environment="live"
        )
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {str(e)}")


def require_scope(scope: str):
    async def scope_checker(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
        ctx.require_scope(scope)
        return ctx
    return scope_checker
