from fastapi import Depends, HTTPException, status, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings
from app.database.supabase import get_supabase_client
import uuid

security = HTTPBearer()

def verify_api_key(credentials: HTTPAuthorizationCredentials = Security(security)):
    """
    Validates either the static MY_APPLICATION_API_KEY OR a valid Supabase JWT token.
    This enables both server-to-server and frontend-to-backend authentication.
    """
    token = credentials.credentials
    
    # 1. Check if it's the global app API key (for server-to-server)
    if settings.app_api_key and token == settings.app_api_key:
        return {"user_id": None, "auth_type": "api_key"}
        
    # 2. Check if it's a valid Supabase JWT token (for existing frontend)
    try:
        supabase = get_supabase_client()
        # Setting the session manually with just access token validates it
        # Actually in Supabase py v2, we use get_user
        res = supabase.auth.get_user(token)
        if res and res.user:
            return {"user_id": res.user.id, "auth_type": "jwt", "token": token}
    except Exception as e:
        pass
        
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

def get_current_user_id(auth_data: dict = Depends(verify_api_key)) -> str:
    """
    Returns the user_id. If authenticated via API Key, raises error if user_id is required
    but not supplied, or returns a generic system user_id if needed.
    """
    if auth_data["auth_type"] == "jwt":
        return auth_data["user_id"]
    else:
        # If using server-to-server API key, you might pass user_id in headers/body,
        # but for simplicity we assume the JWT is required for user-specific actions.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User specific action requires JWT authentication"
        )
