from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from app.api.dependencies import get_auth_context, AuthContext, require_scope
from app.schemas.media import MediaUploadResponse
from app.services.media_service import media_service

router = APIRouter(prefix="/v1/media", tags=["Media"])

@router.post("", response_model=MediaUploadResponse)
async def upload_media(
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_scope("media:write"))
):
    """Upload media file to Supabase Storage and receive public media URL."""
    try:
        content = await file.read()
        return await media_service.upload_media(
            organization_id=ctx.organization_id,
            filename=file.filename or "media_upload.bin",
            content_type=file.content_type or "application/octet-stream",
            file_bytes=content
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
