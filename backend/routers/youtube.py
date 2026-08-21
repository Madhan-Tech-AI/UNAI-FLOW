from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, Optional
from middleware.auth import verify_jwt
from services.youtube_service import YouTubeService
from lib.supabase_client import supabase

router = APIRouter(prefix="/v1/youtube", tags=["YouTube Automation"])

@router.post("/extract")
async def extract_youtube_info(body: dict, user: Dict[str, Any] = Depends(verify_jwt)):
    url = body.get("url", "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="YouTube URL is required")

    try:
        metadata = await YouTubeService.fetch_video_metadata(url)
        return {"success": True, "metadata": metadata}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch YouTube metadata: {str(e)}")


