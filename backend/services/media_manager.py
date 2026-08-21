import base64
import uuid
import io
import httpx
from typing import Optional, Dict, Any, Tuple
from lib.supabase_client import supabase

class MediaManager:
    """
    Dedicated media manager for UNAI Flow WhatsApp Gateway.
    Validates, uploads, and serves media files with CDN URLs and size checks.
    """

    MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB
    MAX_VIDEO_SIZE_BYTES = 16 * 1024 * 1024  # 16MB WhatsApp Limit

    @staticmethod
    def get_public_url(media_url: Optional[str]) -> Optional[str]:
        """Ensures any media (base64 data URI, storage path, or public URL) is a public HTTP URL."""
        if not media_url:
            return None

        if media_url.startswith("http://") or media_url.startswith("https://"):
            return media_url

        if media_url.startswith("data:"):
            return MediaManager.upload_base64(media_url)

        # Assume Supabase storage path
        try:
            return supabase.storage.from_("media").get_public_url(media_url)
        except Exception:
            return media_url

    @staticmethod
    def upload_base64(base64_data: str) -> str:
        """Converts base64 data URI to a publicly hosted Supabase Storage asset."""
        try:
            header, encoded = base64_data.split(",", 1)
            mime_type = header.split(";")[0].split(":")[1]
            file_bytes = base64.b64decode(encoded)

            is_video = mime_type.startswith("video/")
            if is_video and len(file_bytes) > MediaManager.MAX_VIDEO_SIZE_BYTES:
                raise ValueError(f"Video size ({len(file_bytes)/(1024*1024):.1f}MB) exceeds WhatsApp 16MB limit.")
            elif not is_video and len(file_bytes) > MediaManager.MAX_IMAGE_SIZE_BYTES:
                raise ValueError(f"Image size ({len(file_bytes)/(1024*1024):.1f}MB) exceeds WhatsApp 10MB limit.")

            ext = mime_type.split("/")[1]
            if ext == "quicktime":
                ext = "mov"
            elif ext == "jpeg":
                ext = "jpg"

            filename = f"wa_{uuid.uuid4().hex[:12]}.{ext}"
            bucket_name = "media"

            # Ensure bucket exists
            try:
                supabase.storage.get_bucket(bucket_name)
            except Exception:
                try:
                    supabase.storage.create_bucket(bucket_name, options={"public": True})
                except Exception:
                    pass

            supabase.storage.from_(bucket_name).upload(
                path=filename,
                file=file_bytes,
                file_options={"content-type": mime_type, "upsert": "true"}
            )

            return supabase.storage.from_(bucket_name).get_public_url(filename)
        except Exception as e:
            print(f"MediaManager upload error: {e}")
            raise e

    @staticmethod
    async def validate_media_url(url: str) -> Tuple[bool, str, int]:
        """Validates that a public URL is reachable and within WhatsApp size limits."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.head(url)
                if resp.status_code != 200:
                    resp = await client.get(url, headers={"Range": "bytes=0-1000"})

                content_type = resp.headers.get("content-type", "")
                content_length = int(resp.headers.get("content-length", 0))

                if content_length > MediaManager.MAX_VIDEO_SIZE_BYTES:
                    return False, f"File exceeds 16MB limit ({content_length/(1024*1024):.1f}MB)", content_length

                return True, content_type, content_length
        except Exception as e:
            return False, str(e), 0
