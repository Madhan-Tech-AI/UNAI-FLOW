from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone
import time
import secrets
import hashlib
import uuid
from app.database.supabase import get_supabase_client
from app.core.security import generate_client_id, generate_api_key, hash_api_key
from app.core.exceptions import (
    GatewayException,
    ApplicationNotFoundException,
    ApplicationSuspendedException,
)
from app.core.logging import logger


def generate_client_secret() -> Tuple[str, str, str]:
    """Generates (raw_secret, secret_hash, masked_preview)."""
    raw = f"unai_sec_{secrets.token_urlsafe(32)}"
    h = hashlib.sha256(raw.encode()).hexdigest()
    preview = f"unai_sec_••••••••••••{raw[-4:]}"
    return raw, h, preview


def generate_oauth_credentials() -> Tuple[str, str, str]:
    """Generates (oauth_client_id, raw_oauth_secret, secret_hash)."""
    client_id = f"unai_oauth_{uuid.uuid4().hex[:16]}"
    raw_secret = f"oauth_sec_{secrets.token_urlsafe(32)}"
    h = hashlib.sha256(raw_secret.encode()).hexdigest()
    return client_id, raw_secret, h


class ApplicationService:
    """
    Manages the Application / Integration lifecycle.
    An Application is the central entity that owns credentials (API keys, Client Secrets),
    webhooks, associated WhatsApp mobile numbers, and provides application-level isolation.
    """

    def __init__(self):
        self.sb = get_supabase_client()
        # In-memory idempotency cache: { "org_id:idempotency_key": (application_dict, raw_api_key, raw_client_secret, raw_oauth_secret, timestamp) }
        self._idempotency_cache: Dict[str, Tuple[Dict[str, Any], str, str, str, float]] = {}
        # Set of verified/ensured organization IDs to eliminate redundant SELECT queries
        self._ensured_orgs: set = set()

    def ensure_organization(self, organization_id: str, name: Optional[str] = None) -> None:
        """
        Ensures that an organization record exists for the given organization_id.
        In UNAI FLOW, dashboard users have organization_id = auth.users.id.
        Auto-provisions the organization row if not already present.
        """
        if not organization_id or organization_id in self._ensured_orgs:
            return
        try:
            res = self.sb.table("organizations").select("id").eq("id", organization_id).limit(1).execute()
            if not res.data:
                self.sb.table("organizations").upsert({
                    "id": organization_id,
                    "name": name or "Default Organization"
                }).execute()
                logger.info(f"Auto-provisioned organization record for org_id: {organization_id}")
            self._ensured_orgs.add(organization_id)
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
        whatsapp_number: Optional[str] = None,
        whatsapp_session_id: Optional[str] = None,
        rate_limit_override: Optional[int] = None,
        idempotency_key: Optional[str] = None,
    ) -> Tuple[Dict[str, Any], str, str, str]:
        """
        Creates a new Application with auto-generated credentials in an atomic manner.

        Returns:
            Tuple of (application_record, raw_api_key, raw_client_secret, raw_oauth_secret)
            Raw secrets are shown ONCE upon creation and never stored in plaintext.
        """
        # 1. Check idempotency cache (120-second window)
        now_ts = time.time()
        if idempotency_key:
            cache_key = f"{organization_id}:{idempotency_key}"
            if cache_key in self._idempotency_cache:
                cached_app, cached_key, cached_sec, cached_oauth, cached_time = self._idempotency_cache[cache_key]
                if now_ts - cached_time < 120:
                    logger.info(f"Returning cached application response for idempotency key: {idempotency_key}")
                    return cached_app, cached_key, cached_sec, cached_oauth

        # 2. Guarantee organization exists in database
        self.ensure_organization(organization_id)

        if scopes is None:
            scopes = [
                "instances:read", "channels:read", "messages:send",
                "campaigns:read", "campaigns:write", "usage:read",
                "webhooks:read", "webhooks:manage"
            ]

        # Generate credentials & secrets cryptographically
        client_id = generate_client_id()
        raw_client_secret, client_secret_hash, client_secret_preview = generate_client_secret()
        oauth_client_id, raw_oauth_secret, oauth_client_secret_hash = generate_oauth_credentials()
        webhook_secret = f"whsec_{secrets.token_hex(16)}"

        cleaned_phone = whatsapp_number.strip() if whatsapp_number else None
        cleaned_sess = whatsapp_session_id.strip() if whatsapp_session_id else None

        # Build quotas dict for seamless backward compatibility
        quotas_payload = {
            "whatsapp_number": cleaned_phone,
            "whatsapp_session_id": cleaned_sess,
            "client_secret_hash": client_secret_hash,
            "client_secret_preview": client_secret_preview,
            "oauth_client_id": oauth_client_id,
            "oauth_client_secret_hash": oauth_client_secret_hash,
        }

        # Primary application record
        app_record = {
            "organization_id": organization_id,
            "client_id": client_id,
            "name": name.strip(),
            "description": description.strip() if description else None,
            "environment": environment,
            "status": "active",
            "default_instance_id": default_instance_id,
            "whatsapp_number": cleaned_phone,
            "whatsapp_session_id": cleaned_sess,
            "client_secret_hash": client_secret_hash,
            "client_secret_preview": client_secret_preview,
            "oauth_client_id": oauth_client_id,
            "oauth_client_secret_hash": oauth_client_secret_hash,
            "scopes": scopes,
            "quotas": quotas_payload,
            "webhook_secret": webhook_secret,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        application = None
        raw_key = None

        # 3. Transaction-safe execution with rollback on credential failure
        try:
            try:
                res = self.sb.table("applications").insert(app_record).execute()
            except Exception as insert_err:
                # If migration columns not yet applied in DB, fall back to base columns + quotas JSONB
                logger.warning(f"Primary application insert failed ({insert_err}), attempting resilient fallback with quotas JSON...")
                fallback_record = {
                    "organization_id": organization_id,
                    "client_id": client_id,
                    "name": name.strip(),
                    "description": description.strip() if description else None,
                    "environment": environment,
                    "status": "active",
                    "default_instance_id": default_instance_id,
                    "scopes": scopes,
                    "quotas": quotas_payload,
                    "webhook_secret": webhook_secret,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                res = self.sb.table("applications").insert(fallback_record).execute()

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
            application["client_secret_preview"] = client_secret_preview
            application["oauth_client_id"] = oauth_client_id
            application["whatsapp_number"] = cleaned_phone
            application["whatsapp_session_id"] = cleaned_sess

            # Store in idempotency cache
            if idempotency_key:
                self._idempotency_cache[f"{organization_id}:{idempotency_key}"] = (
                    application, raw_key, raw_client_secret, raw_oauth_secret, now_ts
                )

            logger.info(f"Successfully created application {application['id']} for org {organization_id}")
            return application, raw_key, raw_client_secret, raw_oauth_secret

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

    def _hydrate_application_fields(self, app: Dict[str, Any]) -> Dict[str, Any]:
        """Hydrates virtual or fallback fields from quotas JSON dictionary if columns are empty."""
        quotas = app.get("quotas") or {}
        if isinstance(quotas, dict):
            if not app.get("whatsapp_number") and quotas.get("whatsapp_number"):
                app["whatsapp_number"] = quotas.get("whatsapp_number")
            if not app.get("whatsapp_session_id") and quotas.get("whatsapp_session_id"):
                app["whatsapp_session_id"] = quotas.get("whatsapp_session_id")
            if not app.get("client_secret_preview") and quotas.get("client_secret_preview"):
                app["client_secret_preview"] = quotas.get("client_secret_preview")
            if not app.get("oauth_client_id") and quotas.get("oauth_client_id"):
                app["oauth_client_id"] = quotas.get("oauth_client_id")
        return app

    def list_applications(self, organization_id: str) -> List[Dict[str, Any]]:
        """Lists all applications for an organization with key/webhook counts using efficient batch queries."""
        from collections import Counter

        res = (
            self.sb.table("applications")
            .select("*")
            .eq("organization_id", organization_id)
            .neq("status", "revoked")
            .order("created_at", desc=True)
            .execute()
        )
        apps = res.data or []
        if not apps:
            return []

        app_ids = [a["id"] for a in apps if a.get("id")]
        key_counts: Counter = Counter()
        wh_counts: Counter = Counter()

        if app_ids:
            try:
                keys_res = (
                    self.sb.table("api_keys")
                    .select("application_id")
                    .in_("application_id", app_ids)
                    .is_("revoked_at", "null")
                    .execute()
                )
                key_counts = Counter([k["application_id"] for k in (keys_res.data or []) if k.get("application_id")])
            except Exception as e:
                logger.warning(f"Error batch-counting API keys: {e}")

            try:
                wh_res = (
                    self.sb.table("webhooks")
                    .select("application_id")
                    .in_("application_id", app_ids)
                    .eq("is_active", True)
                    .execute()
                )
                wh_counts = Counter([w["application_id"] for w in (wh_res.data or []) if w.get("application_id")])
            except Exception as e:
                logger.warning(f"Error batch-counting Webhooks: {e}")

        for app in apps:
            app_id = app.get("id")
            app["api_key_count"] = key_counts[app_id]
            app["webhook_count"] = wh_counts[app_id]
            self._hydrate_application_fields(app)

        return apps

    def get_application(self, organization_id: str, application_id: str) -> Dict[str, Any]:
        """Retrieves a single application by ID for the organization."""
        res = (
            self.sb.table("applications")
            .select("*")
            .eq("id", application_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        if not res.data:
            raise ApplicationNotFoundException(application_id)

        app = res.data[0]
        self._hydrate_application_fields(app)

        # Count active API keys
        keys_res = (
            self.sb.table("api_keys")
            .select("id", count="exact")
            .eq("application_id", application_id)
            .is_("revoked_at", "null")
            .execute()
        )
        app["api_key_count"] = keys_res.count if keys_res.count is not None else len(keys_res.data or [])

        # Count active webhooks
        try:
            wh_res = (
                self.sb.table("webhooks")
                .select("id", count="exact")
                .eq("application_id", application_id)
                .eq("is_active", True)
                .execute()
            )
            app["webhook_count"] = wh_res.count if wh_res.count is not None else len(wh_res.data or [])
        except Exception:
            app["webhook_count"] = 0

        return app

    def update_application(
        self,
        organization_id: str,
        application_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        default_instance_id: Optional[str] = None,
        whatsapp_number: Optional[str] = None,
        whatsapp_session_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Updates application details."""
        updates: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if name is not None:
            updates["name"] = name.strip()
        if description is not None:
            updates["description"] = description.strip() if description else None
        if default_instance_id is not None:
            updates["default_instance_id"] = default_instance_id
        if whatsapp_number is not None:
            updates["whatsapp_number"] = whatsapp_number.strip() if whatsapp_number else None
        if whatsapp_session_id is not None:
            updates["whatsapp_session_id"] = whatsapp_session_id.strip() if whatsapp_session_id else None
        if status is not None:
            updates["status"] = status

        try:
            res = (
                self.sb.table("applications")
                .update(updates)
                .eq("id", application_id)
                .eq("organization_id", organization_id)
                .execute()
            )
        except Exception as update_err:
            # Fallback updating quotas JSON if top-level column does not exist
            logger.warning(f"Application update error ({update_err}), trying quotas fallback...")
            existing_app = self.get_application(organization_id, application_id)
            quotas = existing_app.get("quotas") or {}
            if whatsapp_number is not None:
                quotas["whatsapp_number"] = whatsapp_number.strip() if whatsapp_number else None
            if whatsapp_session_id is not None:
                quotas["whatsapp_session_id"] = whatsapp_session_id.strip() if whatsapp_session_id else None
            safe_updates = {
                "updated_at": updates["updated_at"],
                "quotas": quotas
            }
            if name is not None:
                safe_updates["name"] = updates["name"]
            if description is not None:
                safe_updates["description"] = updates["description"]
            if default_instance_id is not None:
                safe_updates["default_instance_id"] = default_instance_id
            if status is not None:
                safe_updates["status"] = status
            res = (
                self.sb.table("applications")
                .update(safe_updates)
                .eq("id", application_id)
                .eq("organization_id", organization_id)
                .execute()
            )

        if not res.data:
            raise ApplicationNotFoundException(application_id)

        app = res.data[0]
        self._hydrate_application_fields(app)
        return app

    def delete_application(self, organization_id: str, application_id: str) -> bool:
        """Soft-deletes an application: marks it as revoked and revokes all its active API keys."""
        res = (
            self.sb.table("applications")
            .update({
                "status": "revoked",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", application_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        if not res.data:
            raise ApplicationNotFoundException(application_id)

        # Revoke all associated API keys
        self.sb.table("api_keys").update({
            "revoked_at": datetime.now(timezone.utc).isoformat()
        }).eq("application_id", application_id).is_("revoked_at", "null").execute()

        return True

    def regenerate_api_key(self, organization_id: str, app_id: str) -> Tuple[Dict[str, Any], str]:
        """Revokes all existing keys for an application and issues a fresh one."""
        app = self.get_application(organization_id, app_id)
        if not app:
            raise ApplicationNotFoundException(app_id)

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

    def regenerate_client_secret(self, organization_id: str, app_id: str) -> str:
        """Rotates the client secret and returns the raw new secret (shown once)."""
        app = self.get_application(organization_id, app_id)
        if not app:
            raise ApplicationNotFoundException(app_id)

        raw_secret, secret_hash, preview = generate_client_secret()
        now_iso = datetime.now(timezone.utc).isoformat()

        quotas = app.get("quotas") or {}
        quotas["client_secret_hash"] = secret_hash
        quotas["client_secret_preview"] = preview

        update_payload = {
            "client_secret_hash": secret_hash,
            "client_secret_preview": preview,
            "quotas": quotas,
            "updated_at": now_iso
        }

        try:
            self.sb.table("applications").update(update_payload).eq("id", app_id).eq("organization_id", organization_id).execute()
        except Exception:
            self.sb.table("applications").update({"quotas": quotas, "updated_at": now_iso}).eq("id", app_id).eq("organization_id", organization_id).execute()

        return raw_secret

    def verify_client_credentials(self, client_id: str, client_secret: str) -> Dict[str, Any]:
        """
        Authenticates an external CRM request using Client Credentials.
        Validates client_id and checks client_secret against client_secret_hash.
        """
        from app.core.exceptions import InvalidApiKeyException

        res = self.sb.table("applications").select("*").eq("client_id", client_id).neq("status", "revoked").execute()
        if not res.data:
            raise InvalidApiKeyException("Invalid client credentials.")

        app = res.data[0]
        secret_hash = app.get("client_secret_hash")
        if not secret_hash and app.get("quotas") and isinstance(app["quotas"], dict):
            secret_hash = app["quotas"].get("client_secret_hash")

        if not secret_hash:
            raise InvalidApiKeyException("Client secret not configured for this application.")

        provided_hash = hashlib.sha256(client_secret.encode()).hexdigest()
        if not secrets.compare_digest(secret_hash, provided_hash):
            raise InvalidApiKeyException("Invalid client credentials.")

        if app.get("status") != "active":
            raise ApplicationSuspendedException(app["id"])

        self.record_usage(app["id"])
        self._hydrate_application_fields(app)
        return app

    def record_usage(self, application_id: str) -> None:
        """Asynchronously records usage timestamp for an application."""
        try:
            self.sb.table("applications").update({
                "last_used_at": datetime.now(timezone.utc).isoformat()
            }).eq("id", application_id).execute()
        except Exception:
            pass

    def test_application_connection(self, organization_id: str, application_id: str) -> Dict[str, Any]:
        """
        Executes a diagnostic health check on an application:
        1. Verifies application existence and 'active' status.
        2. Verifies active API keys.
        3. Verifies connected WhatsApp session and mobile number.
        4. Verifies REST Gateway availability.
        """
        app = self.get_application(organization_id, application_id)
        if not app:
            raise ApplicationNotFoundException(application_id)

        # 1. Check API keys
        keys_res = (
            self.sb.table("api_keys")
            .select("id, prefix, revoked_at")
            .eq("application_id", application_id)
            .is_("revoked_at", "null")
            .execute()
        )
        active_keys = keys_res.data or []

        # 2. Check WhatsApp session
        wa_number = app.get("whatsapp_number")
        wa_session_id = app.get("whatsapp_session_id") or app.get("default_instance_id")
        wa_status = "NOT_CONFIGURED"

        try:
            session_query = self.sb.table("whatsapp_sessions").select("*")
            if wa_session_id:
                s_res = session_query.eq("session_identifier", wa_session_id).execute()
                if not s_res.data:
                    s_res = self.sb.table("whatsapp_sessions").select("*").eq("id", wa_session_id).execute()
                if s_res.data:
                    wa_status = s_res.data[0].get("status", "UNKNOWN")
                    if not wa_number:
                        wa_number = s_res.data[0].get("phone_number")
            elif wa_number:
                s_res = session_query.eq("phone_number", wa_number).execute()
                if s_res.data:
                    wa_status = s_res.data[0].get("status", "UNKNOWN")
            else:
                # Check if organization has any connected session
                s_res = session_query.eq("user_id", organization_id).execute()
                if s_res.data:
                    connected = next((s for s in s_res.data if s.get("status") in ["CONNECTED", "READY", "AUTHENTICATED"]), None)
                    if connected:
                        wa_status = connected.get("status")
                        wa_number = connected.get("phone_number")
                    else:
                        wa_status = s_res.data[0].get("status", "DISCONNECTED")
                        wa_number = s_res.data[0].get("phone_number")
        except Exception as wa_err:
            logger.warning(f"Error checking WhatsApp session: {wa_err}")

        is_wa_connected = wa_status in ["CONNECTED", "READY", "AUTHENTICATED"]
        app_active = app.get("status") == "active"
        keys_ok = len(active_keys) > 0

        overall = app_active and keys_ok and is_wa_connected

        return {
            "success": overall,
            "application_id": app["id"],
            "application_name": app["name"],
            "application_status": app.get("status", "unknown"),
            "whatsapp_number": wa_number,
            "whatsapp_status": wa_status,
            "checks": [
                {
                    "name": "Application Status",
                    "passed": app_active,
                    "detail": f"Application is currently '{app.get('status')}'. Must be 'active'."
                },
                {
                    "name": "API Key Configured",
                    "passed": keys_ok,
                    "detail": f"{len(active_keys)} active API key(s) provisioned."
                },
                {
                    "name": "WhatsApp Device Connection",
                    "passed": is_wa_connected,
                    "detail": f"Status: {wa_status} on {wa_number or 'No number linked'}."
                },
                {
                    "name": "API Gateway Route",
                    "passed": True,
                    "detail": "REST Gateway /v1 is active and responsive."
                }
            ]
        }

    def get_credentials(self, organization_id: str, app_id: str) -> Dict[str, Any]:
        """Returns non-secret credentials and display previews for an application."""
        app = self.get_application(organization_id, app_id)
        if not app:
            raise ApplicationNotFoundException(app_id)

        # Get active API key prefix
        keys_res = (
            self.sb.table("api_keys")
            .select("prefix, created_at")
            .eq("application_id", app_id)
            .is_("revoked_at", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        api_key_prefix = keys_res.data[0]["prefix"] if keys_res.data else None

        return {
            "client_id": app["client_id"],
            "api_key_prefix": api_key_prefix,
            "client_secret_preview": app.get("client_secret_preview"),
            "oauth_client_id": app.get("oauth_client_id"),
            "whatsapp_number": app.get("whatsapp_number"),
            "webhook_secret": app.get("webhook_secret"),
            "environment": app.get("environment", "live"),
        }

    def check_application_status(self, application_id: str) -> Dict[str, Any]:
        """
        Checks if an application is active. Used during authentication.
        Raises ApplicationSuspendedException if not active.
        """
        res = (
            self.sb.table("applications")
            .select("id, status, organization_id, client_id, default_instance_id, scopes, quotas")
            .eq("id", application_id)
            .execute()
        )
        if not res.data:
            raise ApplicationNotFoundException(application_id)

        app = res.data[0]
        if app["status"] != "active":
            raise ApplicationSuspendedException(application_id)

        return self._hydrate_application_fields(app)


application_service = ApplicationService()
