from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class PublishJobResponse(BaseModel):
    id: str
    post_id: Optional[str] = None
    destination_id: Optional[str] = None
    status: str
    attempts: int
    max_attempts: int
    error: Optional[str] = None
    provider_message_id: Optional[str] = None
    idempotency_key: Optional[str] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
