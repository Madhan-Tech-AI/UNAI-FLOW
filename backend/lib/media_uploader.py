import base64
import uuid
from lib.supabase_client import supabase

def get_public_media_url(media_url: str) -> str:
    """
    Converts base64 data URI (data:image/... or data:video/...) to a public HTTP URL
    by uploading the binary file to Supabase Storage bucket 'media'.
    If media_url is already a public HTTP URL, returns it as is.
    """
    if not media_url:
        return media_url
        
    if media_url.startswith("http://") or media_url.startswith("https://"):
        return media_url
        
    if media_url.startswith("data:"):
        try:
            header, encoded = media_url.split(",", 1)
            mime_type = header.split(";")[0].split(":")[1]
            ext = mime_type.split("/")[1]
            if ext == "quicktime":
                ext = "mov"
            elif ext == "jpeg":
                ext = "jpg"
                
            file_bytes = base64.b64decode(encoded)
            filename = f"media_{uuid.uuid4().hex[:12]}.{ext}"
            
            bucket_name = "media"
            
            # Ensure bucket exists
            try:
                supabase.storage.get_bucket(bucket_name)
            except Exception:
                try:
                    supabase.storage.create_bucket(bucket_name, options={"public": True})
                except Exception as b_err:
                    print(f"Bucket create note: {b_err}")
            
            # Upload file
            supabase.storage.from_(bucket_name).upload(
                path=filename,
                file=file_bytes,
                file_options={"content-type": mime_type, "upsert": "true"}
            )
            
            public_url = supabase.storage.from_(bucket_name).get_public_url(filename)
            return public_url
        except Exception as e:
            print(f"Media upload error: {e}")
            # If upload fails, return original media_url
            return media_url

    return media_url
