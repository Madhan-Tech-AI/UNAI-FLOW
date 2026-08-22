from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from app.database.supabase import get_supabase_client
from app.core.exceptions import ChannelNotFoundException, ChannelPermissionDeniedException
from app.services.instance_service import instance_service
from app.providers.whatsapp.models import ProviderChannel

class ChannelService:
    def __init__(self):
        self.sb = get_supabase_client()

    async def sync_channels(self, organization_id: str, instance_id: str) -> List[Dict[str, Any]]:
        """
        Discovers live channels from the provider, filters by admin permissions,
        and upserts them into Supabase whatsapp_channels.
        """
        inst = instance_service.get_instance(organization_id, instance_id)
        provider = instance_service.provider
        
        provider_channels: List[ProviderChannel] = await provider.list_channels(inst["instance_uuid"])
        synced = []
        now_iso = datetime.now(timezone.utc).isoformat()
        
        for ch in provider_channels:
            # Check permissions
            if ch.role not in ["admin", "owner"]:
                continue
                
            record = {
                "instance_id": instance_id,
                "newsletter_jid": ch.newsletter_jid,
                "name": ch.name,
                "description": ch.description,
                "invite_code": ch.invite_code,
                "profile_picture": ch.profile_picture,
                "role": ch.role,
                "subscribers_count": ch.subscribers_count,
                "metadata": ch.metadata,
                "synced_at": now_iso
            }
            
            # Upsert into Supabase
            res = self.sb.table("whatsapp_channels").upsert(
                record,
                on_conflict="instance_id,newsletter_jid"
            ).execute()
            
            if res.data:
                synced.append(res.data[0])
                
        return synced

    def list_instance_channels(self, organization_id: str, instance_id: str) -> List[Dict[str, Any]]:
        # Verify instance belongs to org
        instance_service.get_instance(organization_id, instance_id)
        res = self.sb.table("whatsapp_channels").select("*").eq("instance_id", instance_id).execute()
        return res.data or []

    def list_org_channels(self, organization_id: str) -> List[Dict[str, Any]]:
        # Join instances for organization
        instances = instance_service.list_instances(organization_id)
        instance_ids = [inst["id"] for inst in instances]
        if not instance_ids:
            return []
            
        res = self.sb.table("whatsapp_channels").select("*").in_("instance_id", instance_ids).execute()
        return res.data or []

    def get_channel(self, organization_id: str, instance_id: str, newsletter_jid: str) -> Dict[str, Any]:
        instance_service.get_instance(organization_id, instance_id)
        res = self.sb.table("whatsapp_channels").select("*").eq("instance_id", instance_id).eq("newsletter_jid", newsletter_jid).execute()
        if not res.data:
            raise ChannelNotFoundException(newsletter_jid)
        return res.data[0]

channel_service = ChannelService()
