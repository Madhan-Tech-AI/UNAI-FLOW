from abc import ABC, abstractmethod
from typing import Dict, Any, List

class WhatsAppProvider(ABC):
    
    @abstractmethod
    async def connect(self, session_identifier: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def disconnect(self, session_identifier: str) -> bool:
        pass

    @abstractmethod
    async def get_status(self, session_identifier: str) -> str:
        pass

    @abstractmethod
    async def get_pairing_data(self, session_identifier: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def get_channels(self, session_identifier: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    async def get_channel(self, session_identifier: str, channel_id: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def get_channel_permissions(self, session_identifier: str, channel_id: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def publish_text(self, session_identifier: str, channel_id: str, body: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def publish_image(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def publish_video(self, session_identifier: str, channel_id: str, media_url: str, caption: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def publish_link(self, session_identifier: str, channel_id: str, url: str, caption: str) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def publish_poll(self, session_identifier: str, channel_id: str, question: str, options: List[str]) -> Dict[str, Any]:
        pass

    @abstractmethod
    async def register_webhook(self) -> bool:
        pass
