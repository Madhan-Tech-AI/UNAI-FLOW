from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
import time
import secrets
from app.database.supabase import get_supabase_client
from app.core.security import generate_client_id, generate_api_key, hash_api_key
from app.core.exceptions import (
    GatewayException,
    ApplicationNotFoundException,
    ApplicationSuspendedException,
)
from app.core.logging import logger


class ApplicationService:
    """
    Manages the Application / Integration lifecycle.
    An Application is the central entity that owns credentials (API keys),
    webhooks, and provides application-level isolation within an organization.
    """

    def __init__(self):
        self.sb = get_supabase_client()
        # In-memory idempotency cache: { "org_id:idempotency_key": (application_dict, raw_api_key, timestamp) }
        self._idempotency_cache: Dict[str, Tuple[Dict[str, Any], str, float]] = {}

    def ensure_organization(self, organization_id: str, name: Optional[str] = None) -> None:
        """
        Ensures that an organization record exists for the given organization_id.
        In UNAI FLOW, dashboard users have organization_id = auth.users.id.
        Auto-provisions the organization row if not already present to prevent
        foreign key constraint violations across child tables.
        """
        if not organization_id:
            return
        try:
            res = self.sb.table("organizations").select("id").eq("id", organization_id).limit(1).execute()
            if not res.data:
                self.sb.table("organizations").upsert({
                    "id": organization_id,
                    "name": name or "Default Organization"
                }).execute()
                logger.info(f"Auto-provisioned organization record for org_id: {organization_id}")
        except Exception as e:
            logger.warning(f"Note on ensuring organization record ({organization_id}): {e}")

    def create_application(
        self,
        organization_id: str,
        name: str,
        description: Optional[str] = None,
        environment: str = "live",
        scopes: Optional[List[str]] = None,
        default_instance_id: Optional[str] = None,
        rate_limit_override: Optional[int] = None,
        idempotency_key: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], str]:
        """
        Creates a new Application with auto-generated credentials in an atomic manner.

        Returns:
            Tuple of (application_record, raw_api_key)
            The raw_api_key is shown ONCE and never stored.
        """
        # 1. Check idempotency cache (120-second window)
        now_ts = time.time()
        if idempotency_key:
            cache_key = f"{organization_id}:{idempotency_key}"
            if cache_key in self._idempotency_cache:
                cached_app, cached_key, cached_time = self._idempotency_cache[cache_key]
                if now_ts - cached_time < 120:
                    logger.info(f"Returning cached application response for idempotency key: {idempotency_key}")
                    return cached_app, cached_key

        # 2. Guarantee organization exists in database
        self.ensure_organization(organization_id)

        if scopes is None:
            scopes = [
                "instances:read", "channels:read", "messages:send",
                "campaigns:read", "campaigns:write", "usage:read"
            ]

        # Generate application identity & secrets
        client_id = generate_client_id()
        webhook_secret = f"whsec_{secrets.token_hex(16)}"

        # Prepare the application record
        app_record = {
            "organization_id": organization_id,
            "client_id": client_id,
            "name": name.strip(),
            "description": description.strip() if description else None,
            "environment": environment,
            "status": "active",
            "default_instance_id": default_instance_id,
            "scopes": scopes,
            "webhook_secret": webhook_secret,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        application = None
        raw_key = None

        # 3. Transaction-safe execution with rollback on credential failure
        try:
            res = self.sb.table("applications").insert(app_record).execute()
            if not res.data:
                raise GatewayException(
                    code="APPLICATION_CREATION_FAILED",
                    message="Failed to insert application into database.",
                    status_code=500
                )
            application = res.data[0]

            # Generate first API key
            raw_key, prefix, key_hash = generate_api_key(environment)
            key_record = {
                "organization_id": organization_id,
                "application_id": application["id"],
                "name": f"{name} — API Key",
                "description": f"Auto-generated key for application '{name}'",
                "prefix": prefix,
                "key_hash": key_hash,
                "scopes": scopes,
                "environment": environment,
                "rate_limit_override": rate_limit_override,
                "expires_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

            key_res = self.sb.table("api_keys").insert(key_record).execute()
            if not key_res.data:
                raise GatewayException(
                    code="APPLICATION_KEY_CREATION_FAILED",
                    message="Failed to create API key for the new application.",
                    status_code=500
                )

            application["_api_key_prefix"] = prefix
            application["_api_key_count"] = 1
            application["_webhook_count"] = 0

            # Store in idempotency cache
            if idempotency_key:
                self._idempotency_cache[f"{organization_id}:{idempotency_key}"] = (application, raw_key, now_ts)

            logger.info(f"Successfully created application {application['id']} for org {organization_id}")
            return application, raw_key

        except Exception as e:
            # ROLLBACK: Do not leave an orphan application if credential creation fails
            if application and "id" in application:
                try:
                    self.sb.table("applications").delete().eq("id", application["id"]).execute()
                    logger.warning(f"Rolled back orphan application {application['id']} due to error: {e}")
                except Exception as rollback_err:
                    logger.error(f"Failed to rollback application {application['id']}: {rollback_err}")

            if isinstance(e, GatewayException):
                raise e
            logger.error(f"Unhandled error creating application: {e}", exc_info=True)
            raise GatewayException(
                code="APPLICATION_CREATION_FAILED",
                message=f"Unable to create application. Internal error: {str(e)}",
                status_code=500
            )

    def list_applications(self, organization_id: str) -> List[Dict[str, Any]]:
        """Lists all applications for an organization with key/webhook counts."""
        res = (
            self.sb.table("applications")
            .select("*")
            .eq("organization_id", organization_id)
            .neq("status", "revoked")
            .order("created_at", desc=True)
            .execute()
        )
        applications = res.data or []

        # Enrich with counts
        for app in applications:
            app_id = app["id"]

            # Count active API keys
            key_res = (
                self.sb.table("api_keys")
                .select("id", count="exact")
                .eq("application_id", app_id)
                .is_("revoked_at", "null")
                .execute()
            )
            app["api_key_count"] = key_res.count if key_res.count is not None else 0

            # Count webhooks
            wh_res = (
                self.sb.table("webhooks")
                .select("id", count="exact")
                .eq("application_id", app_id)
                .execute()
            )
            app["webhook_count"] = wh_res.count if wh_res.count is not None else 0

        return applications

    def get_application(self, organization_id: str, app_id: str) -> Dict[str, Any]:
        """Gets a single application with enriched metadata."""
        res = (
            self.sb.table("applications")
            .select("*")
            .eq("id", app_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        if not res.data:
            raise ApplicationNotFoundException(app_id)

        application = res.data[0]

        # Count active API keys
        key_res = (
            self.sb.table("api_keys")
            .select("id, prefix", count="exact")
            .eq("application_id", app_id)
            .is_("revoked_at", "null")
            .execute()
        )
        application["api_key_count"] = key_res.count if key_res.count is not None else 0
        if key_res.data:
            application["api_key_prefix"] = key_res.data[0].get("prefix")

        # Count webhooks
        wh_res = (
            self.sb.table("webhooks")
            .select("id", count="exact")
            .eq("application_id", app_id)
            .execute()
        )
        application["webhook_count"] = wh_res.count if wh_res.count is not None else 0

        return application

    def update_application(
        self,
        organization_id: str,
        app_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        default_instance_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Updates application metadata."""
        update_data: Dict[str, Any] = {
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        if name is not None:
            update_data["name"] = name
        if description is not None:
            update_data["description"] = description
        if default_instance_id is not None:
            update_data["default_instance_id"] = default_instance_id
        if status is not None:
            if status not in ("active", "suspended", "revoked"):
                raise ValueError(f"Invalid status: {status}")
            update_data["status"] = status

        res = (
            self.sb.table("applications")
            .update(update_data)
            .eq("id", app_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        if not res.data:
            raise ApplicationNotFoundException(app_id)

        return res.data[0]

    def suspend_application(self, organization_id: str, app_id: str) -> Dict[str, Any]:
        """Suspends an application and revokes all its API keys."""
        app = self.update_application(organization_id, app_id, status="suspended")

        # Revoke all API keys belonging to this application
        self.sb.table("api_keys").update({
            "revoked_at": datetime.now(timezone.utc).isoformat()
        }).eq("application_id", app_id).is_("revoked_at", "null").execute()

        logger.info(f"Application {app_id} suspended — all API keys revoked")
        return app

    def delete_application(self, organization_id: str, app_id: str) -> bool:
        """Soft-deletes an application by setting status to 'revoked'."""
        self.suspend_application(organization_id, app_id)
        self.update_application(organization_id, app_id, status="revoked")
        return True

    def get_credentials(self, organization_id: str, app_id: str) -> Dict[str, Any]:
        """Returns displayable credentials for an application (no raw secrets)."""
        app = self.get_application(organization_id, app_id)

        # Get the latest active key prefix
        key_res = (
            self.sb.table("api_keys")
            .select("prefix")
            .eq("application_id", app_id)
            .is_("revoked_at", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        api_key_prefix = key_res.data[0]["prefix"] if key_res.data else None

        return {
            "client_id": app["client_id"],
            "api_key_prefix": api_key_prefix,
            "webhook_secret": app.get("webhook_secret"),
            "environment": app["environment"],
        }

    def regenerate_api_key(
        self,
        organization_id: str,
        app_id: str,
    ) -> Tuple[Dict[str, Any], str]:
        """Revokes all existing keys for this application and issues a new one."""
        app = self.get_application(organization_id, app_id)

        if app["status"] != "active":
            raise ApplicationSuspendedException(app_id)

        # Revoke all existing keys
        self.sb.table("api_keys").update({
            "revoked_at": datetime.now(timezone.utc).isoformat()
        }).eq("application_id", app_id).is_("revoked_at", "null").execute()

        # Generate new key
        environment = app.get("environment", "live")
        scopes = app.get("scopes", [])
        raw_key, prefix, key_hash = generate_api_key(environment)

        key_record = {
            "organization_id": organization_id,
            "application_id": app_id,
            "name": f"{app['name']} — API Key (Regenerated)",
            "description": f"Regenerated key for application '{app['name']}'",
            "prefix": prefix,
            "key_hash": key_hash,
            "scopes": scopes,
            "environment": environment,
            "rate_limit_override": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        key_res = self.sb.table("api_keys").insert(key_record).execute()
        if not key_res.data:
            raise GatewayException(
                code="KEY_REGENERATION_FAILED",
                message="Failed to create replacement API key.",
                status_code=500
            )

        return key_res.data[0], raw_key

    def check_application_status(self, application_id: str) -> Dict[str, Any]:
        """
        Checks if an application is active. Used during authentication.
        Raises ApplicationSuspendedException if not active.
        """
        res = (
            self.sb.table("applications")
            .select("id, status, organization_id, client_id, default_instance_id, scopes")
            .eq("id", application_id)
            .execute()
        )
        if not res.data:
            raise ApplicationNotFoundException(application_id)

        app = res.data[0]
        if app["status"] != "active":
            raise ApplicationSuspendedException(application_id)

        return app


application_service = ApplicationService()
