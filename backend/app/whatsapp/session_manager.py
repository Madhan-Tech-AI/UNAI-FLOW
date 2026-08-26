"""
SessionManager — manages WhatsApp sessions in Supabase.

Adds QR tracking fields, status enum enforcement, and structured logging.
"""
from app.database.supabase import get_supabase_client
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import logging

logger = logging.getLogger(__name__)


class SessionManager:
    """
    Manages WhatsApp sessions in Supabase securely.
    """

    def __init__(self):
        self.sb = get_supabase_client()

    def get_session(
        self, user_id: str, session_identifier: str
    ) -> Optional[Dict[str, Any]]:
        res = (
            self.sb.table("whatsapp_sessions")
            .select("*")
            .eq("user_id", user_id)
            .eq("session_identifier", session_identifier)
            .execute()
        )
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None

    def get_sessions_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        res = (
            self.sb.table("whatsapp_sessions")
            .select("*")
            .eq("user_id", user_id)
            .execute()
        )
        return res.data or []

    def create_or_update_session(
        self,
        user_id: str,
        session_identifier: str,
        provider: str = "whatsapp_web",
        status: str = "CREATING",
    ) -> Dict[str, Any]:
        existing = self.get_session(user_id, session_identifier)
        if existing:
            logger.info(
                f"[WA] DB_SESSION_UPDATE session_id={session_identifier} "
                f"from={existing.get('status')} to={status}"
            )
            res = (
                self.sb.table("whatsapp_sessions")
                .update(
                    {
                        "status": status,
                        "provider": provider,
                        "updated_at": "now()",
                    }
                )
                .eq("id", existing["id"])
                .execute()
            )
            if not res.data:
                raise Exception(
                    "Failed to update session: No data returned from Supabase. Check RLS or DB connection."
                )
            return res.data[0]
        else:
            logger.info(
                f"[WA] DB_SESSION_CREATE session_id={session_identifier} status={status}"
            )
            res = (
                self.sb.table("whatsapp_sessions")
                .insert(
                    {
                        "user_id": user_id,
                        "session_identifier": session_identifier,
                        "status": status,
                        "provider": provider,
                    }
                )
                .execute()
            )
            if not res.data:
                raise Exception(
                    "Failed to create session: No data returned from Supabase. Check RLS or DB connection."
                )
            return res.data[0]

    def update_session_status(self, session_id: str, status: str) -> None:
        logger.info(f"[WA] DB_STATUS_UPDATE id={session_id[:8]}... status={status}")
        self.sb.table("whatsapp_sessions").update(
            {"status": status, "updated_at": "now()"}
        ).eq("id", session_id).execute()

    def update_session_connection_details(
        self, session_id: str, phone_number: str, profile_picture_url: str = None
    ) -> None:
        logger.info(
            f"[WA] DB_CONNECTION_DETAILS id={session_id[:8]}... "
            f"phone={'***' + phone_number[-4:] if phone_number and len(phone_number) > 4 else 'unknown'} "
            f"has_profile_pic={bool(profile_picture_url)}"
        )
        update_data = {
            "status": "CONNECTED",
            "phone_number": phone_number,
            "last_connected_at": "now()",
            "updated_at": "now()",
        }
        if profile_picture_url:
            update_data["profile_picture_url"] = profile_picture_url
        self.sb.table("whatsapp_sessions").update(update_data).eq("id", session_id).execute()

    def update_session_qr(
        self,
        session_id: str,
        qr_data: Optional[str] = None,
        qr_expires_at: Optional[str] = None,
    ) -> None:
        """Update QR code data in session record."""
        update_data: Dict[str, Any] = {
            "status": "WAITING_FOR_SCAN",
            "updated_at": "now()",
        }
        if qr_data is not None:
            update_data["qr_data"] = qr_data
        if qr_expires_at is not None:
            update_data["qr_expires_at"] = qr_expires_at

        logger.info(
            f"[WA] DB_QR_UPDATE id={session_id[:8]}... "
            f"has_qr={qr_data is not None}"
        )
        self.sb.table("whatsapp_sessions").update(update_data).eq(
            "id", session_id
        ).execute()

    def clear_session_qr(self, session_id: str) -> None:
        """Clear QR data after scan or expiration."""
        self.sb.table("whatsapp_sessions").update(
            {
                "qr_data": None,
                "qr_expires_at": None,
                "updated_at": "now()",
            }
        ).eq("id", session_id).execute()
