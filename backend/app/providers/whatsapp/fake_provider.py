import uuid
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from app.providers.whatsapp.base import WhatsAppProvider
from app.providers.whatsapp.models import (
    ProviderQR,
    ProviderStatus,
    ProviderChannel,
    ProviderMessageResult
)

class FakeWhatsAppProvider(WhatsAppProvider):
    """
    In-memory simulation provider for CI/CD, local testing, and automated integration tests.
    Does not require a real WhatsApp account.
    """
    def __init__(self):
        self._instances: Dict[str, Dict[str, Any]] = {}

    def _get_or_create(self, instance_id: str) -> Dict[str, Any]:
        if instance_id not in self._instances:
            self._instances[instance_id] = {
                "status": "INITIALIZING",
                "phone_number": None,
                "display_name": "Test WhatsApp Account",
                "qr": None,
                "channels": [
                    ProviderChannel(
                        newsletter_jid="120363171744447809@newsletter",
                        name="Company Announcements",
                        description="Official updates and product launches",
                        invite_code="https://whatsapp.com/channel/0029VaFake123",
                        profile_picture="https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200",
                        role="admin",
                        subscribers_count=1420,
                        verified=True
                    ),
                    ProviderChannel(
                        newsletter_jid="120363998877665544@newsletter",
                        name="Tech Deals & Offers",
                        description="Weekly discounts and coupons",
                        invite_code="https://whatsapp.com/channel/0029VaFakeDeals",
                        profile_picture="https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=200",
                        role="owner",
                        subscribers_count=8500,
                        verified=False
                    )
                ],
                "messages": []
            }
        return self._instances[instance_id]

    async def create_instance(self, instance_id: str) -> Dict[str, Any]:
        inst = self._get_or_create(instance_id)
        inst["status"] = "INITIALIZING"
        return {"instance_id": instance_id, "status": "INITIALIZING"}

    async def connect(self, instance_id: str) -> ProviderStatus:
        inst = self._get_or_create(instance_id)
        inst["status"] = "WAITING_FOR_QR"
        # Mock 1x1 green transparent PNG QR data URL
        inst["qr"] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        inst["qr_expires_at"] = datetime.now(timezone.utc) + timedelta(minutes=2)
        return ProviderStatus(
            status="WAITING_FOR_QR",
            is_ready=False,
            display_name=inst["display_name"]
        )

    async def get_qr(self, instance_id: str) -> Optional[ProviderQR]:
        inst = self._get_or_create(instance_id)
        if inst["status"] == "WAITING_FOR_QR" and inst.get("qr"):
            return ProviderQR(
                qr_data=inst["qr"],
                expires_at=inst.get("qr_expires_at")
            )
        return None

    async def simulate_scan(self, instance_id: str, phone_number: str = "+1 (555) 019-2834"):
        """Helper to simulate user scanning the QR code."""
        inst = self._get_or_create(instance_id)
        inst["status"] = "AUTHENTICATED"
        inst["phone_number"] = phone_number
        inst["qr"] = None

    async def get_connection_status(self, instance_id: str) -> ProviderStatus:
        inst = self._get_or_create(instance_id)
        is_ready = inst["status"] == "AUTHENTICATED"
        return ProviderStatus(
            status=inst["status"],
            is_ready=is_ready,
            phone_number=inst.get("phone_number"),
            display_name=inst.get("display_name")
        )

    async def logout(self, instance_id: str) -> bool:
        inst = self._get_or_create(instance_id)
        inst["status"] = "DISCONNECTED"
        inst["phone_number"] = None
        inst["qr"] = None
        return True

    async def restart(self, instance_id: str) -> ProviderStatus:
        inst = self._get_or_create(instance_id)
        return ProviderStatus(status=inst["status"], is_ready=(inst["status"] == "AUTHENTICATED"))

    async def restore_session(self, instance_id: str, session_data: Dict[str, Any]) -> ProviderStatus:
        inst = self._get_or_create(instance_id)
        inst["status"] = "AUTHENTICATED"
        inst["phone_number"] = session_data.get("phone_number", "+1 (555) 019-2834")
        return ProviderStatus(status="AUTHENTICATED", is_ready=True, phone_number=inst["phone_number"])

    async def list_channels(self, instance_id: str) -> List[ProviderChannel]:
        inst = self._get_or_create(instance_id)
        return inst["channels"]

    async def get_channel(self, instance_id: str, newsletter_jid: str) -> Optional[ProviderChannel]:
        inst = self._get_or_create(instance_id)
        for ch in inst["channels"]:
            if ch.newsletter_jid == newsletter_jid:
                return ch
        return None

    async def send_text(self, instance_id: str, to: str, text: str) -> ProviderMessageResult:
        inst = self._get_or_create(instance_id)
        msg_id = f"fake_msg_{uuid.uuid4().hex[:12]}"
        msg_record = {
            "id": msg_id,
            "to": to,
            "type": "text",
            "body": text,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        inst["messages"].append(msg_record)
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc))

    async def send_image(self, instance_id: str, to: str, image_url_or_bytes: Any, caption: Optional[str] = None) -> ProviderMessageResult:
        inst = self._get_or_create(instance_id)
        msg_id = f"fake_img_{uuid.uuid4().hex[:12]}"
        inst["messages"].append({"id": msg_id, "to": to, "type": "image", "caption": caption})
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc))

    async def send_video(self, instance_id: str, to: str, video_url_or_bytes: Any, caption: Optional[str] = None) -> ProviderMessageResult:
        inst = self._get_or_create(instance_id)
        msg_id = f"fake_vid_{uuid.uuid4().hex[:12]}"
        inst["messages"].append({"id": msg_id, "to": to, "type": "video", "caption": caption})
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc))

    async def send_audio(self, instance_id: str, to: str, audio_url_or_bytes: Any) -> ProviderMessageResult:
        inst = self._get_or_create(instance_id)
        msg_id = f"fake_aud_{uuid.uuid4().hex[:12]}"
        inst["messages"].append({"id": msg_id, "to": to, "type": "audio"})
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc))

    async def send_poll(self, instance_id: str, to: str, question: str, options: List[str], selectable_count: int = 1) -> ProviderMessageResult:
        inst = self._get_or_create(instance_id)
        msg_id = f"fake_poll_{uuid.uuid4().hex[:12]}"
        inst["messages"].append({"id": msg_id, "to": to, "type": "poll", "question": question, "options": options})
        return ProviderMessageResult(success=True, message_id=msg_id, timestamp=datetime.now(timezone.utc))

    async def upload_media(self, instance_id: str, media_bytes: bytes, mime_type: str) -> str:
        return f"fake_media_{uuid.uuid4().hex[:10]}"

    async def get_messages(self, instance_id: str, channel_jid: str, limit: int = 20) -> List[Dict[str, Any]]:
        inst = self._get_or_create(instance_id)
        return [m for m in inst["messages"] if m["to"] == channel_jid][-limit:]
