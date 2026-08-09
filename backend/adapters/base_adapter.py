from abc import ABC, abstractmethod
from typing import Dict, Any

class PlatformAdapter(ABC):
    @abstractmethod
    async def publish(self, content: str, user_id: str, automation_id: str) -> Dict[str, Any]:
        """
        Publishes the content to the platform.
        Returns a dict containing 'post_id', 'post_url' if successful.
        Raises an exception if it fails.
        """
        pass
