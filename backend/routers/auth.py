from fastapi import APIRouter, Depends
from typing import Dict, Any
from middleware.auth import verify_jwt

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/callback")
async def auth_callback(user: Dict[str, Any] = Depends(verify_jwt)):
    # Profile creation is handled by Supabase trigger, so we just return success
    return {"status": "success", "user_id": user["user_id"]}
