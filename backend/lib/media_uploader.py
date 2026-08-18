import base64
import uuid
import io
from lib.supabase_client import supabase

def get_public_media_url(media_url: str) -> str:
    """
    Converts base64 data URI (data:image/... or data:video/...) to a public HTTP URL
    by uploading the binary file to Supabase Storage bucket 'media'.
    Automatically converts PNG/WebP images with transparency to standard RGB JPEG
    so that Instagram Graph API's image parser never fails.
    """
    if not media_url:
        return media_url
        
    if media_url.startswith("http://") or media_url.startswith("https://"):
        return media_url
        
    if media_url.startswith("data:"):
        try:
            header, encoded = media_url.split(",", 1)
            mime_type = header.split(";")[0].split(":")[1]
            file_bytes = base64.b64decode(encoded)
            
            is_video = mime_type.startswith("video/")
            
            if is_video:
                ext = mime_type.split("/")[1]
                if ext == "quicktime":
                    ext = "mov"
            else:
                # Convert all images (PNG, WebP, etc.) to standard RGB JPEG for Instagram & Facebook
                try:
                    from PIL import Image
                    img = Image.open(io.BytesIO(file_bytes))
                    if img.mode in ("RGBA", "LA", "P"):
                        # Create white background for transparent images
                        rgb_img = Image.new("RGB", img.size, (255, 255, 255))
                        if img.mode == "P":
                            img = img.convert("RGBA")
                        rgb_img.paste(img, mask=img.split()[3] if len(img.split()) == 4 else None)
                        img = rgb_img
                    elif img.mode != "RGB":
                        img = img.convert("RGB")
                        
                    output_io = io.BytesIO()
                    img.save(output_io, format="JPEG", quality=95, optimize=True)
                    file_bytes = output_io.getvalue()
                    mime_type = "image/jpeg"
                    ext = "jpg"
                except Exception as pil_err:
                    print(f"PIL conversion note: {pil_err}")
                    ext = "jpg"
                    mime_type = "image/jpeg"
                    
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
            return media_url

    return media_url
