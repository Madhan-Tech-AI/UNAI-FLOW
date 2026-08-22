from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta
from app.database.supabase import get_supabase_client
from app.core.security import generate_api_key, hash_api_key
from app.core.exceptions import InvalidApiKeyException, InsufficientScopeException

class ApiKeyService:
    def __init__(self):
        self.sb = get_supabase_client()

    def create_key(
        self,
        organization_id: str,
        name: str,
        scopes: List[str],
        expires_in_days: Optional[int] = None,
        environment: str = "live"
    ) -> Tuple[Dict[str, Any], str]:
        raw_key, prefix, key_hash = generate_api_key(environment)
        
        expires_at = None
        if expires_in_days:
            expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat()
            
        record = {
            "organization_id": organization_id,
            "name": name,
            "prefix": prefix,
            "key_hash": key_hash,
            "scopes": scopes,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        res = self.sb.table("api_keys").insert(record).execute()
        if not res.data:
            raise Exception("Failed to insert API key into Supabase.")
            
        return res.data[0], raw_key

    def list_keys(self, organization_id: str) -> List[Dict[str, Any]]:
        res = self.sb.table("api_keys").select(
            "id, organization_id, name, prefix, scopes, last_used_at, expires_at, created_at"
        ).eq("organization_id", organization_id).is_("revoked_at", "null").execute()
        return res.data or []

    def revoke_key(self, organization_id: str, key_id: str) -> bool:
        res = self.sb.table("api_keys").update({
            "revoked_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", key_id).eq("organization_id", organization_id).execute()
        return bool(res.data)

    def authenticate_raw_key(self, raw_key: str, required_scope: Optional[str] = None) -> Dict[str, Any]:
        key_hash = hash_api_key(raw_key)
        res = self.sb.table("api_keys").select("*").eq("key_hash", key_hash).is_("revoked_at", "null").execute()
        
        if not res.data:
            raise InvalidApiKeyException("Invalid or revoked API key.")
            
        key_record = res.data[0]
        
        # Check expiration
        if key_record.get("expires_at"):
            exp = datetime.fromisoformat(key_record["expires_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > exp:
                raise InvalidApiKeyException("API key has expired.")
                
        # Check scope
        scopes = key_record.get("scopes") or []
        if required_scope and required_scope not in scopes and "*" not in scopes:
            raise InsufficientScopeException(required_scope)
            
        # Update last_used_at asynchronously / non-blocking
        try:
            self.sb.table("api_keys").update({
                "last_used_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", key_record["id"]).execute()
        except Exception:
            pass
            
        return key_record

api_key_service = ApiKeyService()
