from fastapi import APIRouter, Request, HTTPException
from typing import Dict, Any
from app.database.supabase import get_supabase_client

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

@router.post("/whatsapp")
async def whatsapp_webhook(request: Request):
    """
    Ingests raw webhook events from the WhatsApp provider.
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")
        
    sb = get_supabase_client()
    
    # Store event for async processing
    sb.table("webhook_events").insert({
        "event_type": payload.get("event", "unknown"),
        "payload": payload
    }).execute()
    
    # Return 200 immediately to acknowledge receipt
    return {"received": True}
