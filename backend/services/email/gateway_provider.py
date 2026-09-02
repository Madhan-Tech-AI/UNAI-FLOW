import logging
import os
from typing import Dict, Any, Optional
import httpx
from .base import BaseEmailProvider, EmailSendResult

logger = logging.getLogger(__name__)

class UnaiEmailGatewayProvider(BaseEmailProvider):
    """
    Client adapter for the self-hosted unai-email-gateway microservice.
    Dispatches emails over authenticated HTTPS to your own dedicated mail relay.
    """

    def __init__(
        self,
        gateway_url: Optional[str] = None,
        api_key: Optional[str] = None,
        default_from_email: str = "noreply@unaiflow.com",
        default_from_name: str = "UNAI Flow",
        timeout: float = 25.0,
    ):
        self.gateway_url = (gateway_url or os.getenv("EMAIL_GATEWAY_URL") or "http://localhost:3002").rstrip("/")
        self.api_key = api_key or os.getenv("EMAIL_GATEWAY_API_KEY") or ""
        self.default_from_email = default_from_email
        self.default_from_name = default_from_name
        self.timeout = timeout

    def get_provider_name(self) -> str:
        return "unai_gateway"

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
        if not self.gateway_url:
            return EmailSendResult(
                success=False,
                error_message="Email Gateway URL not configured: missing EMAIL_GATEWAY_URL",
                status="failed",
                is_retryable=False,
            )

        payload: Dict[str, Any] = {
            "to": to_email,
            "name": to_name,
            "subject": subject,
            "html": html_content,
            "text": text_content,
            "from_email": from_email or self.default_from_email,
            "from_name": from_name or self.default_from_name,
            "reply_to": reply_to,
            "headers": headers,
        }

        req_headers = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            req_headers["X-API-Key"] = self.api_key

        url = f"{self.gateway_url}/v1/email/send"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(url, headers=req_headers, json=payload)

                if res.status_code in (200, 201):
                    data = res.json()
                    msg_id = data.get("messageId") or f"unai_gw_{to_email}"
                    logger.info(f"[UNAI_GATEWAY] Successfully sent to {to_email}: messageId={msg_id}")
                    return EmailSendResult(
                        success=True,
                        provider_message_id=msg_id,
                        status="sent",
                        metadata=data,
                    )

                # Gateway returned error response
                err_data = {}
                try:
                    err_data = res.json()
                except Exception:
                    err_data = {"raw": res.text}

                err_msg = err_data.get("error") or str(err_data)
                is_retryable = res.status_code in (429, 502, 503, 504)

                logger.warning(f"[UNAI_GATEWAY] Delivery failed ({res.status_code}) for {to_email}: {err_msg}")
                return EmailSendResult(
                    success=False,
                    error_message=f"Gateway error ({res.status_code}): {err_msg}",
                    status="failed",
                    is_retryable=is_retryable,
                    metadata={"status_code": res.status_code},
                )

        except httpx.TimeoutException:
            logger.error(f"[UNAI_GATEWAY] Connection timed out reaching gateway at {self.gateway_url}")
            return EmailSendResult(
                success=False,
                error_message=f"Timed out connecting to UNAI Email Gateway at {self.gateway_url}",
                status="failed",
                is_retryable=True,
            )
        except Exception as e:
            logger.error(f"[UNAI_GATEWAY] Connection error: {e}")
            return EmailSendResult(
                success=False,
                error_message=f"Cannot reach UNAI Email Gateway: {str(e)}",
                status="failed",
                is_retryable=True,
            )
