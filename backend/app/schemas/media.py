from pydantic import BaseModel
from typing import Optional

class MediaUploadResponse(BaseModel):
    media_id: str
    url: str
    mime_type: str
    size_bytes: int
    filename: Optional[str] = None
