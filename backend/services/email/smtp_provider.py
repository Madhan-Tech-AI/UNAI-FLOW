import email.utils
from email.message import EmailMessage
import logging
import uuid
from typing import Dict, Any, Optional
import aiosmtplib
from .base import BaseEmailProvider, EmailSendResult

logger = logging.getLogger(__name__)

class SmtpEmailProvider(BaseEmailProvider):
    """
    Production asynchronous SMTP provider using aiosmtplib.
    Supports STARTTLS, direct TLS/SSL, and plain authentication.
    """

    def __init__(
        self,
        hostname: str,
        port: int = 587,
        username: Optional[str] = None,
        password: Optional[str] = None,
        use_tls: bool = True,
        start_tls: bool = True,
        default_from_email: str = "noreply@example.com",
        default_from_name: str = "UNAI Flow",
        timeout: float = 30.0,
    ):
        self.hostname = hostname
        self.port = port
        self.username = username
        self.password = password
        self.use_tls = use_tls
        self.start_tls = start_tls
        self.default_from_email = default_from_email
        self.default_from_name = default_from_name
        self.timeout = timeout

    def get_provider_name(self) -> str:
        return "smtp"

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
        if not self.hostname:
            return EmailSendResult(
                success=False,
                error_message="SMTP provider not configured: missing SMTP_HOST",
                status="failed",
                is_retryable=False,
            )

        msg = EmailMessage()
        
        # Format From header
        sender_email = from_email or self.default_from_email
        sender_name = from_name or self.default_from_name
        msg["From"] = email.utils.formataddr((sender_name, sender_email))

        # Format To header
        msg["To"] = email.utils.formataddr((to_name or "", to_email))
        msg["Subject"] = subject
        msg["Date"] = email.utils.formatdate(localtime=True)

        message_id = f"<{uuid.uuid4().hex}@{self.hostname}>"
        msg["Message-ID"] = message_id

        if reply_to:
            msg["Reply-To"] = reply_to

        if headers:
            for k, v in headers.items():
                if k not in msg:
                    msg[k] = v

        # Multipart: plain text alternative + HTML
        plain_text = text_content or "Please view this email in an HTML-compatible client."
        msg.set_content(plain_text)
        msg.add_alternative(html_content, subtype="html")

        try:
            # Send via aiosmtplib
            # If port 465, use direct TLS; if port 587/25, use STARTTLS
            use_direct_tls = (self.port == 465) or (self.use_tls and not self.start_tls)
            
            response = await aiosmtplib.send(
                msg,
                hostname=self.hostname,
                port=self.port,
                username=self.username if self.username else None,
                password=self.password if self.password else None,
                use_tls=use_direct_tls,
                start_tls=self.start_tls if not use_direct_tls else False,
                timeout=self.timeout,
            )

            # aiosmtplib.send returns (Dict[str, Tuple[int, str]], str)
            status_msg = response[1] if isinstance(response, tuple) and len(response) > 1 else "Sent"
            logger.info(f"[SMTP] Successfully sent to {to_email}: message_id={message_id}")

            return EmailSendResult(
                success=True,
                provider_message_id=message_id,
                status="sent",
                metadata={"smtp_response": str(status_msg), "hostname": self.hostname},
            )

        except aiosmtplib.SMTPResponseException as e:
            code = e.code
            is_transient = 400 <= code < 500
            err_text = f"SMTP error {code}: {e.message}"
            logger.warning(f"[SMTP] Delivery failed for {to_email}: {err_text}")
            return EmailSendResult(
                success=False,
                error_message=err_text,
                status="failed",
                is_retryable=is_transient,
                metadata={"smtp_code": code},
            )
        except (aiosmtplib.SMTPConnectError, aiosmtplib.SMTPServerDisconnected, TimeoutError) as e:
            err_text = f"SMTP connection error: {str(e)}"
            logger.error(f"[SMTP] Connection error for {to_email}: {err_text}")
            return EmailSendResult(
                success=False,
                error_message=err_text,
                status="failed",
                is_retryable=True,  # Transient network error, retryable
            )
        except Exception as e:
            err_text = f"SMTP unexpected error: {str(e)}"
            logger.error(f"[SMTP] Delivery error for {to_email}: {err_text}")
            return EmailSendResult(
                success=False,
                error_message=err_text,
                status="failed",
                is_retryable=False,
            )
