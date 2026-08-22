from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.api.dependencies import get_auth_context, AuthContext, require_scope
from app.schemas.webhook import WebhookCreate, WebhookResponse
from app.services.webhook_service import webhook_service

router = APIRouter(prefix="/v1/webhooks", tags=["Webhooks"])

@router.post("", response_model=WebhookResponse)
async def create_webhook(
    req: WebhookCreate,
    ctx: AuthContext = Depends(require_scope("webhooks:write"))
):
    """Register a new customer webhook endpoint."""
    return webhook_service.register_webhook(
        organization_id=ctx.organization_id,
        url=req.url,
        events=req.events
    )

@router.get("", response_model=List[WebhookResponse])
async def list_webhooks(ctx: AuthContext = Depends(require_scope("webhooks:read"))):
    """List all registered webhook endpoints for the organization."""
    return webhook_service.list_webhooks(ctx.organization_id)

@router.delete("/{webhook_id}")
async def delete_webhook(
    webhook_id: str,
    ctx: AuthContext = Depends(require_scope("webhooks:write"))
):
    """Delete a registered webhook endpoint."""
    success = webhook_service.delete_webhook(ctx.organization_id, webhook_id)
    if not success:
        raise HTTPException(status_code=404, detail="Webhook not found.")
    return {"success": True, "message": f"Webhook {webhook_id} deleted."}
