from fastapi import APIRouter
from datetime import datetime, timezone
from app.database.supabase import get_supabase_client
from app.core.config import settings

router = APIRouter(prefix="/v1/health", tags=["Health & Observability"])

@router.get("")
async def get_gateway_health():
    """Health check and live metrics for the WhatsApp Channels Gateway."""
    sb = get_supabase_client()
    db_status = "healthy"
    
    try:
        sb.table("whatsapp_instances").select("id", count="exact").limit(1).execute()
    except Exception:
        db_status = "degraded"
        
    return {
        "status": "healthy" if db_status == "healthy" else "degraded",
        "service": "UNAI Flow WhatsApp Channels API Gateway",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_status,
        "wca_engine_url": settings.wca_api_url
    }
