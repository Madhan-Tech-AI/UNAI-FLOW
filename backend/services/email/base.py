from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, Optional

@dataclass
class EmailSendResult:
    success: bool
    provider_message_id: Optional[str] = None
    error_message: Optional[str] = None
    status: str = "sent"  # "sent" or "failed"
    is_retryable: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

class BaseEmailProvider(ABC):
    """
    Abstract contract for transactional and bulk email providers.
    Implementations must perform real asynchronous email delivery.
    """

    @abstractmethod
    async def send_email(
        self,
        to_email: str,
        to_name: Optional[str],
        subject: str,
        html_content: str,
        text_content: Optional[str] = None,
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
        reply_to: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> EmailSendResult:
        """
        Sends an email to a single recipient through the external provider.
        Returns an EmailSendResult indicating real acceptance or error.
        """
        pass

    @abstractmethod
    def get_provider_name(self) -> str:
        """Return the unique name of the provider (e.g. 'smtp', 'resend', 'sendgrid')."""
        pass
