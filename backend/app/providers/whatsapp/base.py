from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from app.providers.whatsapp.models import (
    ProviderQR,
    ProviderStatus,
    ProviderChannel,
    ProviderMessageResult
)

class WhatsAppProvider(ABC):
    """
    Abstract WhatsApp Provider interface.
    Decouples FastAPI Gateway completely from any underlying protocol
    (Playwright, Baileys, WPPConnect, WhatsApp Web, or Meta Cloud API).
    """

    @abstractmethod
    async def create_instance(self, instance_id: str) -> Dict[str, Any]:
        """Initialize resources for a new WhatsApp instance."""
        pass

    @abstractmethod
    async def connect(self, instance_id: str) -> ProviderStatus:
        """Start the connection/pairing process for an instance."""
        pass

    @abstractmethod
    async def get_qr(self, instance_id: str) -> Optional[ProviderQR]:
        """Fetch active QR code for device pairing."""
        pass

    @abstractmethod
    async def get_connection_status(self, instance_id: str) -> ProviderStatus:
        """Retrieve live connection status, phone number, and state."""
        pass

    @abstractmethod
    async def logout(self, instance_id: str) -> bool:
        """Disconnect and unlink device session."""
        pass

    @abstractmethod
    async def restart(self, instance_id: str) -> ProviderStatus:
        """Restart instance worker/browser without deleting credentials."""
        pass

    @abstractmethod
    async def restore_session(self, instance_id: str, session_data: Dict[str, Any]) -> ProviderStatus:
        """Restore an authenticated session from decrypted credentials."""
        pass

    @abstractmethod
    async def list_channels(self, instance_id: str) -> List[ProviderChannel]:
        """Discover all newsletters/channels administered by this account."""
        pass

    @abstractmethod
    async def get_channel(self, instance_id: str, newsletter_jid: str) -> Optional[ProviderChannel]:
        """Fetch metadata for a specific newsletter."""
        pass

    @abstractmethod
    async def send_text(self, instance_id: str, to: str, text: str) -> ProviderMessageResult:
        """Publish a text post to a channel."""
        pass

    @abstractmethod
    async def send_image(self, instance_id: str, to: str, image_url_or_bytes: Any, caption: Optional[str] = None) -> ProviderMessageResult:
        """Publish an image post with optional caption to a channel."""
        pass

    @abstractmethod
    async def send_video(self, instance_id: str, to: str, video_url_or_bytes: Any, caption: Optional[str] = None) -> ProviderMessageResult:
        """Publish a video post with optional caption to a channel."""
        pass

    @abstractmethod
    async def send_audio(self, instance_id: str, to: str, audio_url_or_bytes: Any) -> ProviderMessageResult:
        """Publish an audio clip or voice broadcast to a channel."""
        pass

    @abstractmethod
    async def send_poll(self, instance_id: str, to: str, question: str, options: List[str], selectable_count: int = 1) -> ProviderMessageResult:
        """Publish an interactive poll to a channel."""
        pass

    @abstractmethod
    async def upload_media(self, instance_id: str, media_bytes: bytes, mime_type: str) -> str:
        """Upload media to the provider runtime and return media handle."""
        pass

    @abstractmethod
    async def get_messages(self, instance_id: str, channel_jid: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Retrieve recent published messages in a channel."""
        pass
