from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, Optional
from middleware.auth import verify_jwt
from services.youtube_service import YouTubeService
from services.session_manager import SessionManager
from services.publish_queue import PublishQueue
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

@router.post("/automate")
async def create_youtube_automation(body: dict, user: Dict[str, Any] = Depends(verify_jwt)):
    user_id = user["user_id"]
    url = body.get("url", "").strip()
    custom_instructions = body.get("instructions")
    auto_publish = body.get("auto_publish", False)

    if not url:
        raise HTTPException(status_code=400, detail="YouTube URL is required")

    try:
        # 1. Fetch metadata
        metadata = await YouTubeService.fetch_video_metadata(url)

        # 2. Generate WhatsApp optimized content
        whatsapp_text = await YouTubeService.generate_whatsapp_content(metadata, custom_instructions)

        # 3. Create Automation Record
        campaign_name = f"YouTube: {metadata.get('title', 'Video Broadcast')[:40]}"
        automation_res = supabase.table("automations").insert({
            "user_id": user_id,
            "campaign_name": campaign_name,
            "raw_content": whatsapp_text,
            "media_url": metadata.get("thumbnail_url"),
            "target_platforms": ["whatsapp"],
            "status": "approved" if auto_publish else "draft",
            "schedule_type": "now"
        }).execute()

        automation = automation_res.data[0] if automation_res.data else {}
        automation_id = automation.get("id")

        # 4. Insert content variant
        if automation_id:
            supabase.table("content_variants").insert({
                "automation_id": automation_id,
                "platform": "whatsapp",
                "generated_text": whatsapp_text,
                "char_count": len(whatsapp_text)
            }).execute()

        # 5. If auto_publish is True and user has selected WhatsApp channel, publish immediately
        publish_result = None
        if auto_publish and automation_id:
            conn_id = SessionManager.get_or_create_connection_id(user_id)
            selected_ch = SessionManager.get_selected_channel(conn_id)
            if selected_ch:
                channel_id = selected_ch["channel_id"]
                publish_result = await PublishQueue.enqueue_and_publish(
                    user_id=user_id,
                    connection_id=conn_id,
                    channel_id=channel_id,
                    content=whatsapp_text,
                    media_url=metadata.get("thumbnail_url"),
                    automation_id=automation_id
                )

        return {
            "success": True,
            "automation_id": automation_id,
            "metadata": metadata,
            "whatsapp_content": whatsapp_text,
            "published": bool(publish_result),
            "publish_result": publish_result
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"YouTube automation failed: {str(e)}")
