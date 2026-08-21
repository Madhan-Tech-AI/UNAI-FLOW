import os
import uuid
import time
from typing import Dict, Any, Optional, List
from lib.supabase_client import supabase
from lib.encryption import encrypt_token, decrypt_token

class SessionManager:
    """
    Production-grade WhatsApp Multi-Tenant Session Manager.
    Manages user connection records, session states, encrypted tokens, and auto-reconnection.
    """

    @staticmethod
    def get_or_create_connection_id(user_id: str) -> str:
        """Returns or creates a persistent connection_id for the user."""
        res = supabase.table("whatsapp_connections") \
            .select("connection_id") \
            .eq("user_id", user_id) \
            .execute()
            
        if res.data and len(res.data) > 0:
            return res.data[0]["connection_id"]
            
        # Generate new deterministic connection ID
        conn_id = f"wa_{user_id.replace('-', '')[:16]}"
        supabase.table("whatsapp_connections").insert({
            "user_id": user_id,
            "connection_id": conn_id,
            "status": "INITIALIZING",
            "metadata": {"created_by": "session_manager"}
        }).execute()
        
        return conn_id

    @staticmethod
    def get_connection(user_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves connection record for a user."""
        res = supabase.table("whatsapp_connections") \
            .select("*") \
            .eq("user_id", user_id) \
            .execute()
        return res.data[0] if res.data else None

    @staticmethod
    def update_connection_status(
        connection_id: str,
        status: str,
        phone_number: Optional[str] = None,
        account_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Updates connection state and metadata."""
        update_data = {
            "status": status,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        if phone_number:
            update_data["phone_number"] = phone_number
        if account_name:
            update_data["platform_account_name"] = account_name
        if status == "CONNECTED":
            update_data["connected_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if metadata:
            update_data["metadata"] = metadata

        supabase.table("whatsapp_connections") \
            .update(update_data) \
            .eq("connection_id", connection_id) \
            .execute()

        # Update or insert into whatsapp_sessions table
        SessionManager.record_session_heartbeat(connection_id, status)

    @staticmethod
    def record_session_heartbeat(connection_id: str, state: str):
        """Records active session reference and heartbeat timestamp."""
        session_ref = f"vault_{connection_id}"
        sess_state = "active" if state == "CONNECTED" else "connecting" if state in ["INITIALIZING", "QR_READY", "AUTHENTICATING"] else "inactive"

        existing = supabase.table("whatsapp_sessions") \
            .select("id") \
            .eq("connection_id", connection_id) \
            .execute()

        payload = {
            "connection_id": connection_id,
            "session_reference": encrypt_token(session_ref),
            "state": sess_state,
            "last_seen": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

        if existing.data:
            supabase.table("whatsapp_sessions") \
                .update(payload) \
                .eq("id", existing.data[0]["id"]) \
                .execute()
        else:
            supabase.table("whatsapp_sessions").insert(payload).execute()

    @staticmethod
    def save_selected_channel(connection_id: str, channel_id: str, channel_name: str, channel_link: str = "", role: str = "admin"):
        """Saves discovered channel and marks it as selected."""
        # Unselect other channels for this connection
        supabase.table("whatsapp_channels") \
            .update({"selected": False}) \
            .eq("connection_id", connection_id) \
            .execute()

        # Check if this channel exists
        existing = supabase.table("whatsapp_channels") \
            .select("id") \
            .eq("connection_id", connection_id) \
            .eq("channel_id", channel_id) \
            .execute()

        channel_payload = {
            "connection_id": connection_id,
            "channel_id": channel_id,
            "channel_name": channel_name,
            "channel_link": channel_link,
            "role": role,
            "selected": True,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }

        if existing.data:
            supabase.table("whatsapp_channels") \
                .update(channel_payload) \
                .eq("id", existing.data[0]["id"]) \
                .execute()
        else:
            supabase.table("whatsapp_channels").insert(channel_payload).execute()

    @staticmethod
    def get_selected_channel(connection_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves user's currently selected WhatsApp channel."""
        res = supabase.table("whatsapp_channels") \
            .select("*") \
            .eq("connection_id", connection_id) \
            .eq("selected", True) \
            .execute()
        return res.data[0] if res.data else None

    @staticmethod
    def disconnect(connection_id: str):
        """Purges connection and marks as revoked."""
        supabase.table("whatsapp_connections") \
            .update({"status": "DISCONNECTED"}) \
            .eq("connection_id", connection_id) \
            .execute()

        supabase.table("whatsapp_sessions") \
            .delete() \
            .eq("connection_id", connection_id) \
            .execute()
