from fastapi import APIRouter
from app.database.supabase import get_supabase_client
from app.core.config import settings
import httpx

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

@router.get("/debug/wca")
async def debug_wca():
    """Debug endpoint to check WCA service connectivity from the backend."""
    wca_url = settings.wca_api_url
    results = {
        "wca_url_configured": wca_url,
        "wca_api_key_set": bool(getattr(settings, "wca_api_key", "")),
    }
    
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # Test v1 connect
            r = await client.post(f"{wca_url}/v1/whatsapp/connect", json={"connection_id": "debug_test"})
            results["v1_connect"] = {"status": r.status_code, "body": r.text[:300]}
            
            # Test v1 status  
            r2 = await client.get(f"{wca_url}/v1/whatsapp/debug_test/status")
            results["v1_status"] = {"status": r2.status_code, "body": r2.text[:300]}
    except Exception as e:
        results["error"] = str(e)
    
    return results

