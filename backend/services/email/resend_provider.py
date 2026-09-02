import logging
from typing import Dict, Any, Optional
import httpx
from .base import BaseEmailProvider, EmailSendResult

logger = logging.getLogger(__name__)

class ResendEmailProvider(BaseEmailProvider):
    """
    Production HTTP provider for Resend (https://resend.com).
    """

    def __init__(
        self,
        api_key: str,
        default_from_email: str = "noreply@example.com",
        default_from_name: str = "UNAI Flow",
        timeout: float = 20.0,
    ):
        self.api_key = api_key
        self.default_from_email = default_from_email
        self.default_from_name = default_from_name
        self.timeout = timeout
        self.api_url = "https://api.resend.com/emails"

    def get_provider_name(self) -> str:
        return "resend"

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
        if not self.api_key:
            return EmailSendResult(
                success=False,
                error_message="Resend provider not configured: missing RESEND_API_KEY",
                status="failed",
                is_retryable=False,
            )

        sender_email = from_email or self.default_from_email
        sender_name = from_name or self.default_from_name
        from_header = f"{sender_name} <{sender_email}>" if sender_name else sender_email

        payload: Dict[str, Any] = {
            "from": from_header,
            "to": [f"{to_name} <{to_email}>" if to_name else to_email],
            "subject": subject,
            "html": html_content,
        }

        if text_content:
            payload["text"] = text_content
        if reply_to:
            payload["reply_to"] = reply_to
        if headers:
            payload["headers"] = headers

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(
                    self.api_url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )

                if res.status_code in (200, 201):
                    data = res.json()
                    msg_id = data.get("id") or f"resend_{to_email}"
                    logger.info(f"[Resend] Successfully sent to {to_email}: id={msg_id}")
                    return EmailSendResult(
                        success=True,
                        provider_message_id=msg_id,
                        status="sent",
                        metadata=data,
                    )
                
                # Handle error responses
                is_rate_limit = res.status_code == 429
                is_server_error = res.status_code >= 500
                is_retryable = is_rate_limit or is_server_error

                error_data = {}
                try:
                    error_data = res.json()
                except Exception:
                    error_data = {"raw": res.text}

                error_msg = error_data.get("message") or str(error_data)
                err_text = f"Resend API error ({res.status_code}): {error_msg}"
                logger.warning(f"[Resend] Delivery failed for {to_email}: {err_text}")

                return EmailSendResult(
                    success=False,
                    error_message=err_text,
                    status="failed",
                    is_retryable=is_retryable,
                    metadata={"status_code": res.status_code, "resend_error": error_data},
                )

        except httpx.TimeoutException:
            logger.error(f"[Resend] Request timeout for {to_email}")
            return EmailSendResult(
                success=False,
                error_message="Resend request timed out",
                status="failed",
                is_retryable=True,
            )
        except Exception as e:
            logger.error(f"[Resend] Unexpected error for {to_email}: {e}")
            return EmailSendResult(
                success=False,
                error_message=f"Resend connection failed: {str(e)}",
                status="failed",
                is_retryable=False,
            )
