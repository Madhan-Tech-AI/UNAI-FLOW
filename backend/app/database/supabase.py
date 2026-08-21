from supabase import create_client, Client
from app.core.config import settings

def get_supabase_client() -> Client:
    key = settings.supabase_service_role_key or settings.supabase_anon_key
    if not settings.supabase_url or not key:
        raise ValueError("Supabase credentials not configured in environment.")
    return create_client(settings.supabase_url, key)

def get_supabase_service_client() -> Client:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ValueError("Supabase service role credentials not configured in environment.")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
