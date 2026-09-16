from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta
from app.database.supabase import get_supabase_client
from app.core.security import generate_api_key, hash_api_key
from app.core.exceptions import (
    InvalidApiKeyException,
    InsufficientScopeException,
    ApplicationSuspendedException,
    ApplicationNotFoundException,
)
from app.core.logging import logger


class ApiKeyService:
    def __init__(self):
        self.sb = get_supabase_client()

    def create_key(
        self,
        organization_id: str,
        name: str,
        scopes: List[str],
        expires_in_days: Optional[int] = None,
        environment: str = "live",
        rate_limit_override: Optional[int] = None,
        description: Optional[str] = None,
        application_id: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], str]:
        raw_key, prefix, key_hash = generate_api_key(environment)

        expires_at = None
        if expires_in_days:
            expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat()

        record = {
            "organization_id": organization_id,
            "name": name,
            "description": description,
            "prefix": prefix,
            "key_hash": key_hash,
            "scopes": scopes,
            "environment": environment,
            "rate_limit_override": rate_limit_override,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        if application_id:
            record["application_id"] = application_id

        res = self.sb.table("api_keys").insert(record).execute()
        if not res.data:
            raise Exception("Failed to insert API key into Supabase.")

        return res.data[0], raw_key

    def list_keys(self, organization_id: str, application_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = (
            self.sb.table("api_keys")
            .select("id, organization_id, application_id, name, description, prefix, scopes, environment, rate_limit_override, last_used_at, expires_at, created_at")
            .eq("organization_id", organization_id)
            .is_("revoked_at", "null")
        )
        if application_id:
            query = query.eq("application_id", application_id)
        res = query.order("created_at", desc=True).execute()
        return res.data or []

    def revoke_key(self, organization_id: str, key_id: str) -> bool:
        res = self.sb.table("api_keys").update({
            "revoked_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", key_id).eq("organization_id", organization_id).execute()
        return bool(res.data)

    def rotate_key(
        self,
        organization_id: str,
        key_id: str,
        expires_in_days: Optional[int] = None
    ) -> Tuple[Dict[str, Any], str]:
        """Revokes the existing key and issues a replacement with the same scopes, environment, and name."""
        res = self.sb.table("api_keys").select("*").eq("id", key_id).eq("organization_id", organization_id).execute()
        if not res.data:
            raise ValueError("API key not found.")

        old_key = res.data[0]

        # Revoke old key
        self.revoke_key(organization_id, key_id)

        # Create new key with same configuration (preserve application_id)
        new_name = f"{old_key.get('name', 'Key')} (Rotated)"
        return self.create_key(
            organization_id=organization_id,
            name=new_name,
            scopes=old_key.get("scopes", []),
            expires_in_days=expires_in_days,
            environment=old_key.get("environment", "live"),
            rate_limit_override=old_key.get("rate_limit_override"),
            description=old_key.get("description"),
            application_id=old_key.get("application_id"),
        )

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
            # Expand scope aliases: campaigns:write → campaigns:create + campaigns:launch + campaigns:cancel
            alias_map = {
                "campaigns:write": ["campaigns:create", "campaigns:launch", "campaigns:cancel"],
            }
            expanded = set(scopes)
            for scope in list(expanded):
                if scope in alias_map:
                    expanded.update(alias_map[scope])
            if required_scope not in expanded:
                raise InsufficientScopeException(required_scope)

        # If this key belongs to an application, check that the application is active
        application_id = key_record.get("application_id")
        if application_id:
            try:
                app_res = (
                    self.sb.table("applications")
                    .select("id, status, default_instance_id")
                    .eq("id", application_id)
                    .execute()
                )
                if app_res.data:
                    app_status = app_res.data[0].get("status")
                    if app_status != "active":
                        raise ApplicationSuspendedException(application_id)
                    # Attach application metadata to key record for downstream use
                    key_record["_application"] = app_res.data[0]
            except (ApplicationSuspendedException, ApplicationNotFoundException):
                raise
            except Exception as e:
                logger.warning(f"Failed to check application status for {application_id}: {e}")

        # Update last_used_at asynchronously / non-blocking
        try:
            self.sb.table("api_keys").update({
                "last_used_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", key_record["id"]).execute()
        except Exception:
            pass

        return key_record


api_key_service = ApiKeyService()
