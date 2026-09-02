import logging
from typing import Dict, Any, Optional
import httpx
from .base import BaseEmailProvider, EmailSendResult

logger = logging.getLogger(__name__)

class SendGridEmailProvider(BaseEmailProvider):
    """
    Production HTTP provider for SendGrid v3 API (https://sendgrid.com).
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
        self.api_url = "https://api.sendgrid.com/v3/mail/send"

    def get_provider_name(self) -> str:
        return "sendgrid"

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
                error_message="SendGrid provider not configured: missing SENDGRID_API_KEY",
                status="failed",
                is_retryable=False,
            )

        sender_email = from_email or self.default_from_email
        sender_name = from_name or self.default_from_name

        payload: Dict[str, Any] = {
            "personalizations": [
                {
                    "to": [{"email": to_email, "name": to_name} if to_name else {"email": to_email}],
                    "subject": subject,
                }
            ],
            "from": {"email": sender_email, "name": sender_name},
            "content": [],
        }

        if text_content:
            payload["content"].append({"type": "text/plain", "value": text_content})
        payload["content"].append({"type": "text/html", "value": html_content})

        if reply_to:
            payload["reply_to"] = {"email": reply_to}
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

                if res.status_code in (200, 201, 202):
                    msg_id = res.headers.get("X-Message-Id") or f"sg_{to_email}"
                    logger.info(f"[SendGrid] Successfully sent to {to_email}: id={msg_id}")
                    return EmailSendResult(
                        success=True,
                        provider_message_id=msg_id,
                        status="sent",
                        metadata={"status_code": res.status_code, "msg_id": msg_id},
                    )

                is_rate_limit = res.status_code == 429
                is_server_error = res.status_code >= 500
                is_retryable = is_rate_limit or is_server_error

                err_detail = ""
                try:
                    err_json = res.json()
                    errors = err_json.get("errors", [])
                    err_detail = "; ".join(e.get("message", "") for e in errors)
                except Exception:
                    err_detail = res.text

                err_text = f"SendGrid error ({res.status_code}): {err_detail}"
                logger.warning(f"[SendGrid] Delivery failed for {to_email}: {err_text}")

                return EmailSendResult(
                    success=False,
                    error_message=err_text,
                    status="failed",
                    is_retryable=is_retryable,
                    metadata={"status_code": res.status_code},
                )

        except Exception as e:
            logger.error(f"[SendGrid] Unexpected delivery error for {to_email}: {e}")
            return EmailSendResult(
                success=False,
                error_message=f"SendGrid request failed: {str(e)}",
                status="failed",
                is_retryable=False,
            )
