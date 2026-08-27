from pydantic import BaseModel, HttpUrl
from typing import List, Optional

class AutomationCreate(BaseModel):
    campaign_name: Optional[str] = None
    raw_content: str
    media_url: Optional[str] = None
    tone: str = "professional"
    cta_link: Optional[str] = None
    target_platforms: List[str]
    whatsapp_channel_id: Optional[str] = None
    schedule_type: str = "now"
    scheduled_at: Optional[str] = None

class GenerateVariantsRequest(BaseModel):
    pass # In a real implementation this could have overrides, but we use the automation ID

class VariantResponse(BaseModel):
    platform: str
    generated_text: str
    char_count: int
    hashtags: List[str]
