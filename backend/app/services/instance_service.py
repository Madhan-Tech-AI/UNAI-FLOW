import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from app.database.supabase import get_supabase_client
from app.core.exceptions import InstanceNotFoundException, InstanceNotAuthenticatedException
from app.providers.whatsapp.base import WhatsAppProvider
from app.providers.whatsapp.fake_provider import FakeWhatsAppProvider
from app.core.config import settings

class InstanceService:
    def __init__(self, provider: Optional[WhatsAppProvider] = None):
        self.sb = get_supabase_client()
        self.provider = provider or FakeWhatsAppProvider()

    def set_provider(self, provider: WhatsAppProvider):
        self.provider = provider

    def create_instance(self, organization_id: str, display_name: Optional[str] = None) -> Dict[str, Any]:
        """Creates a new instance record for an organization in INITIALIZING state."""
        instance_uuid = f"inst_{uuid.uuid4().hex[:16]}"
        record = {
            "organization_id": organization_id,
            "instance_uuid": instance_uuid,
            "display_name": display_name or "WhatsApp Channel Gateway",
            "status": "INITIALIZING",
            "connection_state": "DISCONNECTED",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        res = self.sb.table("whatsapp_instances").insert(record).execute()
        if not res.data:
            raise Exception("Failed to create WhatsApp instance in database.")
        return res.data[0]

    def list_instances(self, organization_id: str) -> List[Dict[str, Any]]:
        res = self.sb.table("whatsapp_instances").select("*").eq("organization_id", organization_id).execute()
        return res.data or []

    def get_instance(self, organization_id: str, instance_id: str) -> Dict[str, Any]:
        res = self.sb.table("whatsapp_instances").select("*").eq("organization_id", organization_id).eq("id", instance_id).execute()
        if not res.data:
            raise InstanceNotFoundException(instance_id)
        return res.data[0]

    async def connect_instance(self, organization_id: str, instance_id: str) -> Dict[str, Any]:
        """Initiates connection and starts QR code generation."""
        inst = self.get_instance(organization_id, instance_id)
        
        # Call provider connect
        provider_status = await self.provider.connect(inst["instance_uuid"])
        
        # Update instance state
        self.sb.table("whatsapp_instances").update({
            "status": provider_status.status,
            "connection_state": "CONNECTING" if not provider_status.is_ready else "CONNECTED",
            "phone_number": provider_status.phone_number,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", instance_id).execute()
        
        return {
            "instance_id": instance_id,
            "status": provider_status.status,
            "is_ready": provider_status.is_ready
        }

    async def get_qr(self, organization_id: str, instance_id: str) -> Dict[str, Any]:
        """Fetches active QR code from the provider."""
        inst = self.get_instance(organization_id, instance_id)
        qr_obj = await self.provider.get_qr(inst["instance_uuid"])
        
        if qr_obj:
            return {
                "instance_id": instance_id,
                "status": "WAITING_FOR_QR",
                "qr": qr_obj.qr_data,
                "expires_at": qr_obj.expires_at.isoformat() if qr_obj.expires_at else None
            }
        
        # If no QR, check if already authenticated
        status = await self.provider.get_connection_status(inst["instance_uuid"])
        return {
            "instance_id": instance_id,
            "status": status.status,
            "qr": None,
            "expires_at": None
        }

    async def get_health(self, organization_id: str, instance_id: str) -> Dict[str, Any]:
        """Checks live instance health and updates DB timestamps."""
        inst = self.get_instance(organization_id, instance_id)
        provider_status = await self.provider.get_connection_status(inst["instance_uuid"])
        
        # Count channels
        ch_res = self.sb.table("whatsapp_channels").select("id", count="exact").eq("instance_id", instance_id).execute()
        channel_count = ch_res.count or 0
        
        # Update heartbeat
        self.sb.table("whatsapp_instances").update({
            "status": provider_status.status,
            "connection_state": "CONNECTED" if provider_status.is_ready else "DISCONNECTED",
            "phone_number": provider_status.phone_number or inst.get("phone_number"),
            "last_seen": datetime.now(timezone.utc).isoformat()
        }).eq("id", instance_id).execute()
        
        return {
            "instance_id": instance_id,
            "status": provider_status.status,
            "connected": provider_status.is_ready,
            "phone_number": provider_status.phone_number or inst.get("phone_number"),
            "last_heartbeat": datetime.now(timezone.utc).isoformat(),
            "channels_count": channel_count
        }

    async def logout_instance(self, organization_id: str, instance_id: str) -> bool:
        """Logs out from WhatsApp and updates instance state."""
        inst = self.get_instance(organization_id, instance_id)
        await self.provider.logout(inst["instance_uuid"])
        
        self.sb.table("whatsapp_instances").update({
            "status": "DISCONNECTED",
            "connection_state": "DISCONNECTED",
            "updated_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", instance_id).execute()
        
        # Remove session credentials
        self.sb.table("whatsapp_sessions").delete().eq("instance_id", instance_id).execute()
        return True

instance_service = InstanceService()
