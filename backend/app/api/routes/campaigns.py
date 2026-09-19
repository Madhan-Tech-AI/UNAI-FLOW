from fastapi import APIRouter, Depends, HTTPException, Query, Header
from typing import Optional
from app.api.dependencies import get_auth_context, AuthContext
from app.schemas.campaign import (
    CampaignCreate,
    CampaignResponse,
    CampaignLaunchResponse,
    CampaignListResponse,
    CampaignRecipientsListResponse
)
from app.services.campaign_service import campaign_service

router = APIRouter(prefix="/v1/campaigns", tags=["Bulk Messaging Campaigns"])


def require_dashboard_user(ctx: AuthContext = Depends(get_auth_context)) -> AuthContext:
    """
    Guards bulk messaging campaign endpoints: only internal UNAI FLOW dashboard sessions
    (JWT authenticated) are permitted. External developer API access is strictly disabled.
    """
    if ctx.auth_type != "jwt":
        raise HTTPException(
            status_code=403,
            detail="Bulk messaging campaigns can only be created and managed directly from the UNAI FLOW Web Dashboard. Developer API access for bulk messaging is disabled."
        )
    return ctx


@router.post("", response_model=CampaignResponse)
async def create_campaign(
    body: CampaignCreate,
    ctx: AuthContext = Depends(require_dashboard_user),
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key")
):
    """
    Create a WhatsApp bulk messaging campaign in 'draft' status.
    Accepts message payload and up to 10,000 recipient JIDs.
    """
    ctx.require_scope("campaigns:write")
    try:
        campaign = campaign_service.create_campaign(
            organization_id=ctx.organization_id,
            data=body,
            api_key_id=ctx.api_key_id,
            application_id=ctx.application_id,
            idempotency_key=idempotency_key
        )
        return campaign
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{campaign_id}/launch", response_model=CampaignLaunchResponse)
async def launch_campaign(
    campaign_id: str,
    ctx: AuthContext = Depends(require_dashboard_user)
):
    """
    Launch a draft or cancelled campaign. Queues all pending recipients
    and wakes the background dispatch worker.
    """
    try:
        camp = campaign_service.launch_campaign(ctx.organization_id, campaign_id)
        return CampaignLaunchResponse(
            id=camp["id"],
            status=camp["status"],
            total_recipients=camp["total_recipients"],
            queued_count=camp.get("queued_count", camp["total_recipients"]),
            message="Campaign launched and queued for processing"
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("", response_model=CampaignListResponse)
async def list_campaigns(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: Optional[str] = Query(None, description="Filter by status: draft, queued, sending, completed, failed, cancelled"),
    ctx: AuthContext = Depends(require_dashboard_user)
):
    """List all campaigns for the authenticated organization with pagination."""
    return campaign_service.list_campaigns(
        organization_id=ctx.organization_id,
        page=page,
        page_size=page_size,
        status=status
    )


@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(
    campaign_id: str,
    ctx: AuthContext = Depends(require_dashboard_user)
):
    """Get full details and real-time delivery statistics for a specific campaign."""
    try:
        return campaign_service.get_campaign(ctx.organization_id, campaign_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{campaign_id}/recipients", response_model=CampaignRecipientsListResponse)
async def get_campaign_recipients(
    campaign_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None, description="Filter by recipient status: pending, queued, sending, sent, delivered, failed"),
    ctx: AuthContext = Depends(require_dashboard_user)
):
    """Get per-recipient delivery statuses and errors for a specific campaign."""
    try:
        return campaign_service.get_campaign_recipients(
            organization_id=ctx.organization_id,
            campaign_id=campaign_id,
            page=page,
            page_size=page_size,
            status=status
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{campaign_id}/cancel", response_model=CampaignResponse)
async def cancel_campaign(
    campaign_id: str,
    ctx: AuthContext = Depends(require_dashboard_user)
):
    """Cancel a queued or actively sending campaign. Halts remaining dispatches."""
    try:
        return campaign_service.cancel_campaign(ctx.organization_id, campaign_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
