import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def ensure_storage_buckets():
    """Ensure all required Supabase Storage buckets exist and are public."""
    required_buckets = ["media", "whatsapp-profiles", "whatsapp-media"]
    for bucket in required_buckets:
        try:
            supabase.storage.get_bucket(bucket)
        except Exception:
            try:
                supabase.storage.create_bucket(bucket, options={"public": True})
                print(f"[STORAGE] Created public bucket: {bucket}")
            except Exception as e:
                # May fail if bucket already exists or permissions
                pass

