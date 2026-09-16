from fastapi import APIRouter, Depends, HTTPException, Header, Request
from typing import Optional, List
from app.api.dependencies import AuthContext, get_auth_context
from app.services.application_service import application_service
from app.core.exceptions import GatewayException
from app.core.logging import logger
from app.schemas.application import (
    ApplicationCreate,
    ApplicationUpdate,
    ApplicationResponse,
    ApplicationCreatedResponse,
    ApplicationCredentials,
    ApplicationTestConnectionResponse,
)

router = APIRouter(prefix="/v1/applications", tags=["Applications"])


@router.post("", response_model=ApplicationCreatedResponse)
async def create_application(
    body: ApplicationCreate,
    ctx: AuthContext = Depends(get_auth_context),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
):
    """
    Create a new Application / Integration.

    Generates:
    - A unique client_id (non-secret identifier)
    - An API key (shown ONCE — must be copied immediately)
    - A Client Secret (shown ONCE — must be copied immediately)
    - An OAuth Client ID & Secret
    - A webhook signing secret
    """
    effective_idempotency_key = idempotency_key or body.idempotency_key

    created_tuple = application_service.create_application(
        organization_id=ctx.organization_id,
        name=body.name,
        description=body.description,
        environment=body.environment,
        scopes=body.scopes,
        default_instance_id=body.default_instance_id,
        whatsapp_number=body.whatsapp_number,
        whatsapp_session_id=body.whatsapp_session_id,
        rate_limit_override=body.rate_limit_override,
        idempotency_key=effective_idempotency_key,
    )

    if len(created_tuple) == 4:
        application, raw_api_key, raw_client_secret, raw_oauth_secret = created_tuple
    else:
        application, raw_api_key = created_tuple[0], created_tuple[1]
        raw_client_secret = application.get("client_secret", "unai_sec_generated")
        raw_oauth_secret = application.get("oauth_client_secret")

    return ApplicationCreatedResponse(
        id=application["id"],
        organization_id=application["organization_id"],
        client_id=application["client_id"],
        name=application["name"],
        description=application.get("description"),
        environment=application["environment"],
        status=application["status"],
        default_instance_id=application.get("default_instance_id"),
        whatsapp_number=application.get("whatsapp_number"),
        whatsapp_session_id=application.get("whatsapp_session_id"),
        client_secret_preview=application.get("client_secret_preview"),
        oauth_client_id=application.get("oauth_client_id"),
        scopes=application.get("scopes", []),
        api_key_count=application.get("_api_key_count", 1),
        webhook_count=application.get("_webhook_count", 0),
        created_at=application.get("created_at"),
        updated_at=application.get("updated_at"),
        raw_api_key=raw_api_key,
        api_key_prefix=application.get("_api_key_prefix", ""),
        client_secret=raw_client_secret,
        oauth_client_secret=raw_oauth_secret,
        webhook_secret=application.get("webhook_secret", ""),
    )


@router.get("", response_model=list[ApplicationResponse])
async def list_applications(
    request: Request,
    ctx: AuthContext = Depends(get_auth_context),
):
    """List all applications/integrations for the current organization."""
    from starlette.concurrency import run_in_threadpool
    from datetime import datetime, timezone

    req_id = request.headers.get("x-request-id", "")
    origin = request.headers.get("origin", "")
    auth_present = bool(request.headers.get("authorization"))

    logger.info(f"[STAGE: REQUEST RECEIVED] req_id={req_id} method=GET path=/v1/applications origin={origin} auth_present={auth_present} ts={datetime.now(timezone.utc).isoformat()}")
    logger.info(f"[STAGE: AUTH SUCCESS] user_id={ctx.user_id} auth_type={ctx.auth_type}")
    logger.info(f"[STAGE: ORG RESOLVED] organization_id={ctx.organization_id}")

    try:
        applications = await run_in_threadpool(
            application_service.list_applications, ctx.organization_id
        )
        logger.info(f"[STAGE: REQUEST COMPLETED] Returning {len(applications)} applications for org {ctx.organization_id}")
        return applications
    except GatewayException:
        raise
    except Exception as e:
        logger.error(f"[STAGE: REQUEST FAILED] list_applications failed for org {ctx.organization_id}: {e}", exc_info=True)
        raise GatewayException(
            code="SERVICE_UNAVAILABLE",
            message="Applications service temporarily unavailable. Please retry shortly.",
            status_code=503
        )


@router.get("/{app_id}", response_model=ApplicationResponse)
async def get_application(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Get a single application with enriched metadata (key count, webhook count)."""
    return application_service.get_application(ctx.organization_id, app_id)


@router.patch("/{app_id}", response_model=ApplicationResponse)
async def update_application(
    app_id: str,
    body: ApplicationUpdate,
    ctx: AuthContext = Depends(get_auth_context),
):
    """Update application metadata (name, description, default instance, WhatsApp number, status)."""
    return application_service.update_application(
        organization_id=ctx.organization_id,
        application_id=app_id,
        name=body.name,
        description=body.description,
        default_instance_id=body.default_instance_id,
        whatsapp_number=body.whatsapp_number,
        whatsapp_session_id=body.whatsapp_session_id,
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


@router.post("/{app_id}/regenerate-secret")
async def regenerate_client_secret(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Rotates the Client Secret for an application.
    Returns the new raw Client Secret once. All previous secrets become invalid.
    """
    raw_secret = application_service.regenerate_client_secret(ctx.organization_id, app_id)
    return {
        "success": True,
        "client_secret": raw_secret,
        "preview": f"unai_sec_••••••••••••{raw_secret[-4:]}",
        "message": "Client Secret rotated successfully. Copy this secret now — it will NEVER be displayed again."
    }


@router.post("/{app_id}/test-connection", response_model=ApplicationTestConnectionResponse)
async def test_application_connection(
    app_id: str,
    ctx: AuthContext = Depends(get_auth_context),
):
    """
    Executes live diagnostics on an application for the Developer Console UI.
    Verifies application status, API credentials, and WhatsApp mobile connection.
    """
    return application_service.test_application_connection(ctx.organization_id, app_id)


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
