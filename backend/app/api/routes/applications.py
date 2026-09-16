from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from app.api.dependencies import AuthContext, get_auth_context
from app.services.application_service import application_service
from app.schemas.application import (
    ApplicationCreate,
    ApplicationUpdate,
    ApplicationResponse,
    ApplicationCreatedResponse,
    ApplicationCredentials,
)

router = APIRouter(prefix="/v1/applications", tags=["Applications"])


@router.post("", response_model=ApplicationCreatedResponse)
async def create_application(
    body: ApplicationCreate,
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Create a new Application / Integration.

    Generates:
    - A unique client_id (non-secret identifier)
    - An API key (shown ONCE — must be copied immediately)
    - A webhook signing secret

    The raw API key is returned in this response and will NEVER be shown again.
    """
    application, raw_api_key = application_service.create_application(
        organization_id=ctx.organization_id,
        name=body.name,
        description=body.description,
        environment=body.environment,
        scopes=body.scopes,
        default_instance_id=body.default_instance_id,
        rate_limit_override=body.rate_limit_override,
    )

    return ApplicationCreatedResponse(
        id=application["id"],
        organization_id=application["organization_id"],
        client_id=application["client_id"],
        name=application["name"],
        description=application.get("description"),
        environment=application["environment"],
        status=application["status"],
        default_instance_id=application.get("default_instance_id"),
        scopes=application.get("scopes", []),
        api_key_count=application.get("_api_key_count", 1),
        webhook_count=application.get("_webhook_count", 0),
        created_at=application.get("created_at"),
        updated_at=application.get("updated_at"),
        raw_api_key=raw_api_key,
        api_key_prefix=application.get("_api_key_prefix", ""),
        webhook_secret=application.get("webhook_secret", ""),
    )


@router.get("")
async def list_applications(
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all applications/integrations for the current organization."""
    applications = application_service.list_applications(ctx.organization_id)
    return applications


@router.get("/{app_id}")
async def get_application(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get a single application with enriched metadata (key count, webhook count)."""
    return application_service.get_application(ctx.organization_id, app_id)


@router.patch("/{app_id}")
async def update_application(
    app_id: str,
    body: ApplicationUpdate,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update application metadata (name, description, default instance, status)."""
    return application_service.update_application(
        organization_id=ctx.organization_id,
        app_id=app_id,
        name=body.name,
        description=body.description,
        default_instance_id=body.default_instance_id,
        status=body.status,
    )


@router.delete("/{app_id}")
async def delete_application(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Soft-delete an application: suspends it and revokes all its API keys.
    The application record is preserved with status 'revoked'.
    """
    application_service.delete_application(ctx.organization_id, app_id)
    return {"success": True, "message": "Application revoked and all credentials invalidated."}


@router.post("/{app_id}/regenerate-key")
async def regenerate_api_key(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Revokes all existing API keys for this application and issues a new one.
    The new raw API key is returned and will NEVER be shown again.
    """
    key_record, raw_key = application_service.regenerate_api_key(
        ctx.organization_id, app_id
    )
    return {
        "success": True,
        "raw_key": raw_key,
        "prefix": key_record.get("prefix"),
        "name": key_record.get("name"),
        "message": "All previous keys have been revoked. Copy this new key — it will not be shown again.",
    }


@router.get("/{app_id}/credentials")
async def get_application_credentials(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Returns displayable credentials (client_id, key prefix, webhook secret). No raw secrets."""
    return application_service.get_credentials(ctx.organization_id, app_id)


@router.get("/{app_id}/usage")
async def get_application_usage(
    app_id: str,
    period_type: str = "day",
    ctx: AuthContext = Depends(get_auth_context),
):
    """Returns usage analytics scoped to this specific application."""
    from app.services.usage_service import usage_service
    return usage_service.get_usage_summary(
        organization_id=ctx.organization_id,
        period_type=period_type,
        application_id=app_id,
    )
