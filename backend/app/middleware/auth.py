from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Dict, Any

security = HTTPBearer()


async def verify_jwt(credentials: HTTPAuthorizationCredentials = Security(security)) -> Dict[str, Any]:
    token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Invalid authentication credentials")

    try:
        from lib.supabase_client import supabase
    except ImportError:
        try:
            from app.lib.supabase_client import supabase
        except ImportError:
            from backend.lib.supabase_client import supabase

    response = supabase.auth.get_user(token)
    if not response or not response.user:
        raise HTTPException(status_code=401, detail="Invalid token or expired")

    return {"user_id": response.user.id, "email": response.user.email}
