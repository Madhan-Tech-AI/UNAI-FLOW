"""
ConnectionManager — orchestrates WhatsApp connection lifecycle.

CRITICAL FIX: Previously swallowed all gateway errors with `except Exception: pass`,
causing the session to appear stuck at INITIALIZING forever. Now properly propagates
gateway failures and logs every boundary with correlation IDs.
"""
from typing import Dict, Any, Optional
from .session_manager import SessionManager
from .channel_manager import ChannelManager
from .provider import WhatsAppProvider
from .states import SessionStatus, is_valid_transition
import traceback
import asyncio
import logging
import uuid
import httpx

logger = logging.getLogger(__name__)


class ConnectionManager:
    """
    Orchestrates the connection workflow between the frontend, Supabase, and the WhatsAppProvider.
    
    Flow:
    1. Resolve gateway (local → cloud fallback)
    2. Health check gateway
    3. Create Supabase session (only after gateway is confirmed reachable)
    4. Create gateway session
    5. Poll for QR from gateway
    6. Return status + QR to frontend
    """

    def __init__(self, provider: WhatsAppProvider):
        self.provider = provider
        self.session_manager = SessionManager()
        self.channel_manager = ChannelManager(provider=provider)

    async def start_connection(
        self, user_id: str, session_identifier: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Initiate a new WhatsApp connection. Returns immediately with session status.
        The frontend then polls /status for updates.
        """
        # Generate correlation IDs
        request_id = f"req_{uuid.uuid4().hex[:12]}"
        
        logger.info(
            f"[WA] SESSION_CREATE_START request_id={request_id} "
            f"user_id={user_id[:8]}... session_id={session_identifier or 'new'}"
        )

        # 1. Check for existing active/connected sessions
        active_states = [
            SessionStatus.INITIALIZING.value,
            SessionStatus.WAITING_FOR_SCAN.value,
            SessionStatus.PAIRING.value,
            SessionStatus.AUTHENTICATED.value,
            SessionStatus.SYNCING.value,
        ]
        existing_sessions = self.session_manager.get_sessions_for_user(user_id)

        target_session = None
        if session_identifier:
            target_session = next(
                (s for s in existing_sessions if s["session_identifier"] == session_identifier),
                None,
            )

        # Check existing sessions — but VERIFY with gateway first
        if not target_session:
            for s in existing_sessions:
                if s["status"] in [SessionStatus.CONNECTED.value, SessionStatus.READY.value] + active_states:
                    # Verify this session still exists on the gateway
                    try:
                        gw_status = await self.provider.get_full_status(s["session_identifier"])
                        gw_state = gw_status.get("status", "DISCONNECTED")
                        if gw_state == "QR_READY":
                            gw_state = SessionStatus.WAITING_FOR_SCAN.value

                        if gw_state in ["DISCONNECTED", "ERROR"]:
                            # If the session is already CONNECTED in DB, do NOT discard it.
                            # Instead, trigger gateway to restore the session from its saved credentials.
                            if s["status"] in [SessionStatus.CONNECTED.value, SessionStatus.READY.value]:
                                logger.info(
                                    f"[WA] SESSION_RESTORE_TRIGGER request_id={request_id} "
                                    f"session_id={s['session_identifier']} db_status={s['status']} "
                                    f"— waking up gateway session from vault"
                                )
                                try:
                                    await self.provider.connect(s["session_identifier"])
                                except Exception as conn_err:
                                    logger.warning(f"[WA] Gateway wake up note: {conn_err}")

                                return {
                                    "success": True,
                                    "status": SessionStatus.CONNECTED.value,
                                    "session_identifier": s["session_identifier"],
                                }

                            logger.warning(
                                f"[WA] SESSION_STALE request_id={request_id} "
                                f"session_id={s['session_identifier']} "
                                f"db_status={s['status']} gateway_status={gw_state} "
                                f"— gateway lost this session, will create fresh"
                            )
                            self.session_manager.update_session_status(
                                s["id"], SessionStatus.DISCONNECTED.value
                            )
                            continue

                        # Gateway confirms session is alive
                        logger.info(
                            f"[WA] SESSION_EXISTING_VERIFIED request_id={request_id} "
                            f"session_id={s['session_identifier']} gateway_status={gw_state}"
                        )
                        return {
                            "success": True,
                            "status": gw_state,
                            "session_identifier": s["session_identifier"],
                        }
                    except Exception as e:
                        logger.warning(
                            f"[WA] SESSION_VERIFY_FAILED request_id={request_id} "
                            f"session_id={s['session_identifier']} error={e}"
                        )
                        if s["status"] in [SessionStatus.CONNECTED.value, SessionStatus.READY.value]:
                            return {
                                "success": True,
                                "status": SessionStatus.CONNECTED.value,
                                "session_identifier": s["session_identifier"],
                            }
                        self.session_manager.update_session_status(
                            s["id"], SessionStatus.DISCONNECTED.value
                        )
                        continue

        # 2. Generate session identifier if needed
        if not session_identifier:
            session_identifier = f"sess_{uuid.uuid4().hex}"

        # 3. GATEWAY HEALTH CHECK — verify gateway is reachable BEFORE creating DB session
        logger.info(f"[WA] GATEWAY_HEALTH_CHECK request_id={request_id} session_id={session_identifier}")

        gateway_health = await self.provider.health_check()

        if not gateway_health.get("ok"):
            error_msg = gateway_health.get("error", "Gateway unreachable")
            logger.error(
                f"[WA] GATEWAY_UNAVAILABLE request_id={request_id} "
                f"session_id={session_identifier} error={error_msg}"
            )
            return {
                "success": False,
                "status": "ERROR",
                "code": "WHATSAPP_GATEWAY_UNAVAILABLE",
                "error": f"WhatsApp gateway is currently unavailable: {error_msg}",
                "retryable": True,
            }

        gateway_url = gateway_health.get("gateway_url")
        logger.info(
            f"[WA] GATEWAY_RESOLVED request_id={request_id} "
            f"session_id={session_identifier} gateway_url={gateway_url} "
            f"gateway_type={'LOCAL' if '127.0.0.1' in gateway_url or 'localhost' in gateway_url else 'PRODUCTION'}"
        )

        # 4. Create session in DB as INITIALIZING (only after gateway is confirmed healthy)
        logger.info(f"[WA] SESSION_CREATE request_id={request_id} session_id={session_identifier}")
        session = self.session_manager.create_or_update_session(
            user_id, session_identifier, "whatsapp_web", SessionStatus.INITIALIZING.value
        )

        try:
            # 5. Ask provider to create session on gateway with exponential backoff
            delays = [2, 4, 8, 15, 30, 45]  # Up to ~104s total for Render cold starts
            max_attempts = len(delays) + 1

            for attempt in range(max_attempts):
                try:
                    logger.info(
                        f"[WA] GATEWAY_SESSION_CREATE request_id={request_id} "
                        f"session_id={session_identifier} attempt={attempt+1}/{max_attempts}"
                    )
                    result = await self.provider.connect(session_identifier)
                    logger.info(
                        f"[WA] GATEWAY_SESSION_CREATED request_id={request_id} "
                        f"session_id={session_identifier} status={result.get('status')}"
                    )
                    break
                except httpx.HTTPStatusError as e:
                    if e.response.status_code in [429, 502, 503, 504] and attempt < max_attempts - 1:
                        retry_after = e.response.headers.get("Retry-After")
                        sleep_time = (
                            int(retry_after)
                            if retry_after and retry_after.isdigit()
                            else delays[min(attempt, len(delays) - 1)]
                        )
                        logger.warning(
                            f"[WA] GATEWAY_SESSION_CREATE_RETRY request_id={request_id} "
                            f"session_id={session_identifier} http={e.response.status_code} "
                            f"retry_in={sleep_time}s attempt={attempt+1}/{max_attempts}"
                        )
                        await asyncio.sleep(sleep_time)
                        continue
                    raise
                except (httpx.ConnectError, httpx.ReadTimeout) as e:
                    if attempt < max_attempts - 1:
                        sleep_time = delays[min(attempt, len(delays) - 1)]
                        logger.warning(
                            f"[WA] GATEWAY_SESSION_CREATE_RETRY request_id={request_id} "
                            f"session_id={session_identifier} error={type(e).__name__} "
                            f"retry_in={sleep_time}s attempt={attempt+1}/{max_attempts}"
                        )
                        await asyncio.sleep(sleep_time)
                        continue
                    raise

            # 6. Return immediately so frontend can start polling
            logger.info(
                f"[WA] SESSION_CREATE_COMPLETE request_id={request_id} "
                f"session_id={session_identifier} status=INITIALIZING"
            )
            return {
                "success": True,
                "status": SessionStatus.INITIALIZING.value,
                "session_identifier": session_identifier,
                "gateway_url": gateway_url,
            }

        except Exception as e:
            tb = traceback.format_exc()
            logger.error(
                f"[WA] SESSION_CREATE_FAILED request_id={request_id} "
                f"session_id={session_identifier} error={repr(e)}"
            )
            self.session_manager.update_session_status(session["id"], SessionStatus.ERROR.value)
            return {
                "success": False,
                "status": "ERROR",
                "code": "WHATSAPP_SESSION_CREATE_FAILED",
                "error": str(e),
                "retryable": True,
            }

    async def check_status(
        self, user_id: str, session_identifier: str
    ) -> Dict[str, Any]:
        """
        Check session status from both Supabase and the gateway.
        
        CRITICAL FIX: Previously had `except Exception: pass` which silently 
        swallowed gateway errors, leaving the session stuck at INITIALIZING.
        Now properly surfaces gateway errors.
        """
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session:
            return {"success": False, "error": "Session not found"}

        # Track gateway reachability separately
        gateway_reachable = False
        gateway_error = None
        full_status: Dict[str, Any] = {}

        # Ask provider for real status
        try:
            full_status = await self.provider.get_full_status(session_identifier)
            gateway_reachable = True
            provider_status_str = full_status.get("status", session["status"])

            # Map WCA QR_READY to our frontend's WAITING_FOR_SCAN
            if provider_status_str == "QR_READY":
                provider_status_str = SessionStatus.WAITING_FOR_SCAN.value

            if provider_status_str != session["status"]:
                logger.info(
                    f"[WA] SESSION_STATUS_CHANGED session_id={session_identifier} "
                    f"from={session['status']} to={provider_status_str}"
                )
                if provider_status_str in [SessionStatus.CONNECTED.value, SessionStatus.READY.value]:
                    user_info = full_status.get("userInfo") or full_status.get("whatsapp", {}).get("userInfo", {})
                    phone = user_info.get("phone")
                    name = user_info.get("name")
                    profile_picture_url = user_info.get("profilePictureUrl")
                    logger.info(
                        f"[WA] SESSION_AUTHENTICATED session_id={session_identifier} "
                        f"phone={'***' + phone[-4:] if phone and len(phone) > 4 else 'unknown'} "
                        f"has_profile_pic={bool(profile_picture_url)}"
                    )
                    self.session_manager.update_session_connection_details(
                        session["id"], phone or "", profile_picture_url
                    )
                    # Also link in platform_connections table
                    try:
                        supabase_client = self.session_manager.sb
                        supabase_client.table("platform_connections").upsert({
                            "user_id": user_id,
                            "platform": "whatsapp",
                            "platform_account_name": name or (f"+{phone}" if phone else "WhatsApp Account"),
                            "platform_account_id": session_identifier,
                            "status": "active",
                        }, on_conflict="user_id,platform").execute()
                    except Exception as pc_err:
                        logger.warning(f"[WA] PLATFORM_CONNECTIONS_UPSERT_NOTE error={pc_err}")

                    # Auto-sync channels on successful connection
                    try:
                        logger.info(f"[WA] AUTO_SYNC_CHANNELS session_id={session_identifier}")
                        asyncio.create_task(self._auto_sync_channels(user_id, session_identifier))
                    except Exception as sync_err:
                        logger.warning(f"[WA] AUTO_SYNC_CHANNELS_FAILED error={sync_err}")
                else:
                    # If session was previously CONNECTED in DB, do NOT demote to DISCONNECTED!
                    # Maintain the session until the user explicitly clicks the disconnect button.
                    if session["status"] in [SessionStatus.CONNECTED.value, SessionStatus.READY.value] and provider_status_str in ["DISCONNECTED", "INITIALIZING"]:
                        logger.info(
                            f"[WA] SESSION_MAINTAIN_CONNECTED session_id={session_identifier} "
                            f"db_status={session['status']} gateway_status={provider_status_str} "
                            f"— maintaining connected state and prompting gateway restore"
                        )
                        try:
                            await self.provider.connect(session_identifier)
                        except Exception as conn_err:
                            logger.warning(f"[WA] Provider connect re-trigger note: {conn_err}")
                        provider_status_str = session["status"]
                    else:
                        self.session_manager.update_session_status(
                            session["id"], provider_status_str
                        )
                        session["status"] = provider_status_str

        except httpx.ConnectError as e:
            gateway_error = f"Gateway unreachable: {type(e).__name__}"
            logger.warning(
                f"[WA] STATUS_CHECK_GATEWAY_UNREACHABLE session_id={session_identifier} "
                f"error={gateway_error}"
            )
        except httpx.ReadTimeout as e:
            gateway_error = f"Gateway timeout: {type(e).__name__}"
            logger.warning(
                f"[WA] STATUS_CHECK_GATEWAY_TIMEOUT session_id={session_identifier} "
                f"error={gateway_error}"
            )
        except Exception as e:
            gateway_error = f"Gateway error: {type(e).__name__}: {e}"
            logger.warning(
                f"[WA] STATUS_CHECK_GATEWAY_ERROR session_id={session_identifier} "
                f"error={gateway_error}"
            )

        result: Dict[str, Any] = {
            "success": True,
            "status": session["status"],
            "session": session,
            "gateway_reachable": gateway_reachable,
        }

        if gateway_error:
            result["gateway_error"] = gateway_error

        # If QR is ready or we are waiting for scan, fetch the pairing data
        if full_status.get("hasQR") or session["status"] in [SessionStatus.WAITING_FOR_SCAN.value, "QR_READY"]:
            try:
                pairing_data = await self.provider.get_pairing_data(session_identifier)
                if pairing_data.get("type") == "qr":
                    result["pairing"] = pairing_data.get("data")
                    result["status"] = SessionStatus.WAITING_FOR_SCAN.value
                    session["status"] = SessionStatus.WAITING_FOR_SCAN.value
                    self.session_manager.update_session_status(session["id"], SessionStatus.WAITING_FOR_SCAN.value)
                    logger.info(
                        f"[WA] QR_DELIVERED session_id={session_identifier} "
                        f"has_data={bool(pairing_data.get('data'))}"
                    )
            except Exception as e:
                logger.error(
                    f"[WA] QR_DELIVERY_FAILED session_id={session_identifier} "
                    f"error={type(e).__name__}: {e}"
                )
                result["qr_error"] = str(e)

        return result

    async def disconnect(self, user_id: str, session_identifier: str) -> Dict[str, Any]:
        """Disconnect a WhatsApp session."""
        logger.info(f"[WA] DISCONNECT_START session_id={session_identifier}")
        
        session = self.session_manager.get_session(user_id, session_identifier)
        if not session:
            return {"success": False, "error": "Session not found"}

        # Try to disconnect on gateway
        try:
            await self.provider.disconnect(session_identifier)
        except Exception as e:
            logger.warning(f"[WA] DISCONNECT_GATEWAY_ERROR session_id={session_identifier} error={e}")

        # Update DB session
        self.session_manager.update_session_status(session["id"], SessionStatus.DISCONNECTED.value)
        
        # Remove from platform_connections
        try:
            supabase_client = self.session_manager.sb
            supabase_client.table("platform_connections").delete().eq("user_id", user_id).eq("platform", "whatsapp").execute()
        except Exception as pc_del_err:
            logger.warning(f"[WA] PLATFORM_CONNECTIONS_DELETE_NOTE error={pc_del_err}")

        # Clean up associated channels
        try:
            self.channel_manager.delete_user_channels(user_id)
        except Exception as ch_del_err:
            logger.warning(f"[WA] CHANNELS_DELETE_NOTE error={ch_del_err}")

        logger.info(f"[WA] DISCONNECT_COMPLETE session_id={session_identifier}")

        return {"success": True, "status": SessionStatus.DISCONNECTED.value}

    async def get_gateway_health(self) -> Dict[str, Any]:
        """Public method for the health endpoint."""
        return await self.provider.health_check()

    async def _auto_sync_channels(self, user_id: str, session_identifier: str):
        """Background task: sync channels after successful connection."""
        try:
            await asyncio.sleep(3)  # Small delay to let session fully stabilize
            result = await self.channel_manager.sync_channels(user_id, session_identifier)
            if result.get("success"):
                logger.info(
                    f"[WA] AUTO_SYNC_CHANNELS_COMPLETE session_id={session_identifier} "
                    f"channels={len(result.get('channels', []))}"
                )
            else:
                logger.warning(
                    f"[WA] AUTO_SYNC_CHANNELS_PARTIAL session_id={session_identifier} "
                    f"error={result.get('error')}"
                )
        except Exception as e:
            logger.error(f"[WA] AUTO_SYNC_CHANNELS_ERROR session_id={session_identifier} error={e}")

