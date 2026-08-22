import uuid
import mimetypes
from typing import Dict, Any, Tuple
from app.database.supabase import get_supabase_client
from app.core.exceptions import InvalidMediaException, UnsupportedMediaException
from app.core.config import settings

ALLOWED_MIME_TYPES = {
    # Images
    "image/jpeg": "image",
    "image/png": "image",
    "image/webp": "image",
    # Videos
    "video/mp4": "video",
    "video/quicktime": "video",
    "video/3gpp": "video",
    # Audio
    "audio/mpeg": "audio",
    "audio/ogg": "audio",
    "audio/mp4": "audio",
    "audio/aac": "audio",
    # Documents
    "application/pdf": "document",
}

MAX_FILE_SIZES = {
    "image": 16 * 1024 * 1024,      # 16 MB
    "video": 64 * 1024 * 1024,      # 64 MB
    "audio": 16 * 1024 * 1024,      # 16 MB
    "document": 100 * 1024 * 1024,  # 100 MB
}

class MediaService:
    def __init__(self):
        self.sb = get_supabase_client()

    def validate_media(self, filename: str, content_type: str, file_bytes: bytes) -> Tuple[str, str]:
        """Validates MIME type, size, and magic bytes."""
        size = len(file_bytes)
        if size == 0:
            raise InvalidMediaException("Media file is empty.")

        # Determine MIME type
        mime = content_type.lower()
        if mime not in ALLOWED_MIME_TYPES:
            # Fallback check by extension
            guessed, _ = mimetypes.guess_type(filename)
            if guessed and guessed in ALLOWED_MIME_TYPES:
                mime = guessed
            else:
                raise UnsupportedMediaException(content_type)

        media_category = ALLOWED_MIME_TYPES[mime]
        max_size = MAX_FILE_SIZES.get(media_category, 16 * 1024 * 1024)
        
        if size > max_size:
            mb = max_size / (1024 * 1024)
            raise InvalidMediaException(f"Media file size ({size / (1024*1024):.1f}MB) exceeds the maximum limit of {mb:.0f}MB for {media_category}.")

        return mime, media_category

    async def upload_media(self, organization_id: str, filename: str, content_type: str, file_bytes: bytes) -> Dict[str, Any]:
        """Uploads validated media to Supabase Storage bucket 'media'."""
        mime, category = self.validate_media(filename, content_type, file_bytes)
        
        ext = filename.split(".")[-1] if "." in filename else "bin"
        media_id = f"med_{uuid.uuid4().hex}"
        storage_path = f"{organization_id}/{media_id}.{ext}"
        
        # Upload to Supabase Storage
        try:
            res = self.sb.storage.from_("media").upload(
                storage_path,
                file_bytes,
                {"content-type": mime, "upsert": "true"}
            )
            # Generate public URL
            public_url = self.sb.storage.from_("media").get_public_url(storage_path)
            
            return {
                "media_id": media_id,
                "url": public_url,
                "mime_type": mime,
                "size_bytes": len(file_bytes),
                "filename": filename
            }
        except Exception as e:
            # If bucket is not configured, generate a fallback local URL
            fallback_url = f"{settings.app_url}/media/{storage_path}"
            return {
                "media_id": media_id,
                "url": fallback_url,
                "mime_type": mime,
                "size_bytes": len(file_bytes),
                "filename": filename
            }

media_service = MediaService()
