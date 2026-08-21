from fastapi import APIRouter
from app.database.supabase import get_supabase_client

router = APIRouter(tags=["Health"])

@router.get("/health")
async def health_check():
    db_status = "disconnected"
    try:
        sb = get_supabase_client()
        # lightweight query to check db
        res = sb.table('profiles').select('id').limit(1).execute()
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
        
    return {
        "status": "ok",
        "database": db_status,
        "whatsapp_provider": "available",
        "whatsapp_session": "unknown"
    }
