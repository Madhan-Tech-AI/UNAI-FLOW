from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime


class UsagePeriodStats(BaseModel):
    """Usage statistics for a single period bucket."""
    period: str = Field(..., description="Period label, e.g. '2026-09-12' or '2026-W37'")
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    avg_latency_ms: Optional[float] = None


class UsageSummaryResponse(BaseModel):
    """Aggregate API usage summary."""
    organization_id: str
    period_type: str = Field(default="day", description="Aggregation granularity: day, week, month")
    total_requests: int = 0
    total_messages_sent: int = 0
    total_messages_failed: int = 0
    total_campaigns: int = 0
    active_api_keys: int = 0
    active_webhooks: int = 0
    periods: List[UsagePeriodStats] = []


class MessageStatsResponse(BaseModel):
    """Message delivery statistics breakdown."""
    organization_id: str
    total_sent: int = 0
    total_delivered: int = 0
    total_failed: int = 0
    delivery_rate: float = Field(default=0.0, description="Percentage of successfully delivered messages")
    by_type: Dict[str, int] = Field(default_factory=dict, description="Counts by message type (text, image, etc.)")
    by_status: Dict[str, int] = Field(default_factory=dict, description="Counts by status")


class EndpointUsageStats(BaseModel):
    """Usage breakdown by API endpoint."""
    path: str
    method: str
    total_requests: int = 0
    avg_latency_ms: Optional[float] = None
    error_rate: float = 0.0


class UsageByEndpointResponse(BaseModel):
    """Usage breakdown grouped by endpoint."""
    organization_id: str
    endpoints: List[EndpointUsageStats] = []
