from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import httpx
import jwt
from typing import Dict, Any

security = HTTPBearer()

async def verify_jwt(credentials: HTTPAuthorizationCredentials = Security(security)) -> Dict[str, Any]:
    token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    
    # In a real production system, you should fetch the Supabase project's JWKS
    # For now, as Supabase Auth provides a way to verify tokens via `supabase.auth.get_user(token)`
    # We will use that for deterministic validation without worrying about JWT keys here.
    from lib.supabase_client import supabase
    
    response = supabase.auth.get_user(token)
    if not response or not response.user:
        raise HTTPException(status_code=401, detail="Invalid token or expired")
    
    return {"user_id": response.user.id, "email": response.user.email}
