from fastapi import APIRouter, Depends, Query
from typing import Optional
from app.api.dependencies import get_auth_context, AuthContext
from app.schemas.usage import UsageSummaryResponse, MessageStatsResponse, UsageByEndpointResponse
from app.services.usage_service import usage_service

router = APIRouter(prefix="/v1/usage", tags=["Usage Analytics"])


@router.get("/summary", response_model=UsageSummaryResponse)
async def get_usage_summary(
    period_type: str = Query("day", regex="^(day|week|month)$", description="Aggregation bucket granularity: day, week, month"),
    ctx: AuthContext = Depends(get_auth_context)
):
    """Aggregate API requests, latency metrics, active keys, webhooks, and campaign counts."""
    ctx.require_scope("usage:read")
    return usage_service.get_usage_summary(ctx.organization_id, period_type)


@router.get("/messages", response_model=MessageStatsResponse)
async def get_message_stats(
    ctx: AuthContext = Depends(get_auth_context)
):
    """Message delivery statistics breakdown including sent, delivered, failed, and delivery rate %."""
    ctx.require_scope("usage:read")
    return usage_service.get_message_stats(ctx.organization_id)


@router.get("/endpoints", response_model=UsageByEndpointResponse)
async def get_usage_by_endpoint(
    ctx: AuthContext = Depends(get_auth_context)
):
    """Breakdown of API traffic, average latency, and error rate grouped by endpoint path."""
    ctx.require_scope("usage:read")
    return usage_service.get_usage_by_endpoint(ctx.organization_id)
