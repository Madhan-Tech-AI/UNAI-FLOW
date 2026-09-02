import os
import re
import html
import logging
from typing import Dict, Any, Optional, List, Tuple
from .base import BaseEmailProvider, EmailSendResult
from .smtp_provider import SmtpEmailProvider
from .resend_provider import ResendEmailProvider
from .sendgrid_provider import SendGridEmailProvider
from lib.supabase_client import supabase

logger = logging.getLogger(__name__)

class EmailService:
    """
    Central orchestration service for bulk & transactional email campaigns.
    Handles provider instantiation, personalization, suppression checks, and HTML sanitization.
    """

    def __init__(self):
        self.provider_name = os.getenv("EMAIL_PROVIDER", "smtp").lower()
        self.from_email = os.getenv("EMAIL_FROM_EMAIL", "noreply@unaiflow.com")
        self.from_name = os.getenv("EMAIL_FROM_NAME", "UNAI Flow")
        self.reply_to = os.getenv("EMAIL_REPLY_TO", "")
        self.rate_limit_per_second = float(os.getenv("EMAIL_RATE_LIMIT_PER_SECOND", "10"))
        self.batch_size = int(os.getenv("EMAIL_BATCH_SIZE", "50"))
        self.max_retries = int(os.getenv("EMAIL_MAX_RETRIES", "3"))
        
        self.provider: BaseEmailProvider = self._init_provider()

    def _init_provider(self) -> BaseEmailProvider:
        """Instantiates the configured email provider from environment variables."""
        if self.provider_name == "resend":
            api_key = os.getenv("RESEND_API_KEY", "")
            return ResendEmailProvider(
                api_key=api_key,
                default_from_email=self.from_email,
                default_from_name=self.from_name,
            )
        elif self.provider_name == "sendgrid":
            api_key = os.getenv("SENDGRID_API_KEY", "")
            return SendGridEmailProvider(
                api_key=api_key,
                default_from_email=self.from_email,
                default_from_name=self.from_name,
            )
        else:
            # Default to SMTP
            host = os.getenv("SMTP_HOST", "localhost")
            port = int(os.getenv("SMTP_PORT", "587"))
            user = os.getenv("SMTP_USER", "")
            password = os.getenv("SMTP_PASSWORD", "")
            use_tls = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")
            start_tls = os.getenv("SMTP_STARTTLS", "true").lower() in ("1", "true", "yes")
            return SmtpEmailProvider(
                hostname=host,
                port=port,
                username=user,
                password=password,
                use_tls=use_tls,
                start_tls=start_tls,
                default_from_email=self.from_email,
                default_from_name=self.from_name,
            )

    @staticmethod
    def personalize(template_str: str, variables: Dict[str, Any], default_name: str = "there") -> str:
        """
        Server-side personalization engine:
        Replaces {{name}} and dynamic tokens with contact attributes.
        If {{name}} is empty or missing, resolves to default_name (e.g. 'there').
        Cleans any remaining unresolved {{...}} tags so raw variables are never sent.
        """
        if not template_str:
            return ""

        result = template_str

        # 1. Normalize variables
        clean_vars: Dict[str, str] = {}
        for k, v in (variables or {}).items():
            key_lower = str(k).strip().lower()
            val_str = str(v).strip() if v is not None else ""
            clean_vars[key_lower] = val_str

        # 2. Extract and resolve all {{variable}} patterns
        def replace_token(match):
            raw_token = match.group(1).strip()
            token_lower = raw_token.lower()

            if token_lower in clean_vars and clean_vars[token_lower]:
                return html.escape(clean_vars[token_lower])

            # Special fallback for 'name'
            if token_lower in ("name", "first_name", "fullname", "full_name"):
                return default_name

            # Unresolved dynamic token -> return empty string (never expose raw token)
            return ""

        result = re.sub(r"\{\{\s*([a-zA-Z0-9_\-]+)\s*\}\}", replace_token, result)
        return result

    @staticmethod
    def sanitize_html(html_str: str) -> str:
        """
        Production HTML sanitization:
        Strips script, iframe, object, embed, javascript: protocols, and event handlers (onclick, etc.).
        """
        if not html_str:
            return ""

        # Remove <script>...</script>
        clean = re.sub(r"<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>", "", html_str, flags=re.IGNORECASE)
        # Remove <iframe>...</iframe>
        clean = re.sub(r"<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>", "", clean, flags=re.IGNORECASE)
        # Remove <object> and <embed>
        clean = re.sub(r"<\/?(object|embed|applet)\b[^>]*>", "", clean, flags=re.IGNORECASE)
        # Remove inline on* event attributes (onload, onclick, onerror, etc.)
        clean = re.sub(r"\s+on[a-zA-Z]+\s*=\s*(?:'[^']*'|\"[^\"]*\"|[^\s>]+)", "", clean, flags=re.IGNORECASE)
        # Remove javascript: and data: pseudo-protocols in href/src
        clean = re.sub(r"(href|src)\s*=\s*['\"]?\s*(?:javascript|data):[^'\">]+['\"]?", "", clean, flags=re.IGNORECASE)

        return clean

    @staticmethod
    def html_to_plain_text(html_str: str) -> str:
        """Converts HTML to clean readable plain text for multipart email delivery."""
        if not html_str:
            return ""

        # Replace block tags with newlines
        text = re.sub(r"<\s*br\s*\/?\s*>", "\n", html_str, flags=re.IGNORECASE)
        text = re.sub(r"<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>", "\n", text, flags=re.IGNORECASE)
        # Strip all remaining tags
        text = re.sub(r"<[^>]+>", "", text)
        # Unescape HTML entities
        text = html.unescape(text)
        # Collapse multiple blank lines
        text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
        return text

    async def check_suppression(self, user_id: str, email: str) -> Tuple[bool, Optional[str]]:
        """
        Checks if an email is on the user's suppression list (unsubscribed, bounced, complained).
        Returns (is_suppressed, reason).
        """
        try:
            res = (
                supabase.table("email_suppressions")
                .select("reason")
                .eq("user_id", user_id)
                .eq("email", email.strip().lower())
                .limit(1)
                .execute()
            )
            if res.data and len(res.data) > 0:
                return True, res.data[0].get("reason", "suppressed")
        except Exception as e:
            logger.warning(f"[EMAIL] Suppression check note: {e}")
        return False, None

    async def add_suppression(self, user_id: str, email: str, reason: str = "unsubscribed", notes: str = ""):
        """Adds an email address to the suppression list."""
        try:
            supabase.table("email_suppressions").upsert(
                {
                    "user_id": user_id,
                    "email": email.strip().lower(),
                    "reason": reason,
                    "notes": notes,
                },
                on_conflict="user_id,email",
            ).execute()
            logger.info(f"[EMAIL] Added {email} to suppression list: reason={reason}")
        except Exception as e:
            logger.error(f"[EMAIL] Failed to add suppression for {email}: {e}")

    async def send_single_recipient(
        self,
        user_id: str,
        to_email: str,
        to_name: Optional[str],
        raw_subject: str,
        raw_html: str,
        variables: Dict[str, Any],
        from_email: Optional[str] = None,
        from_name: Optional[str] = None,
        reply_to: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> EmailSendResult:
        """
        Performs end-to-end processing and sending for a single campaign recipient:
        1. Checks suppression list
        2. Personalizes subject and HTML body
        3. Sanitizes HTML
        4. Generates plain text fallback
        5. Sends via the active provider
        """
        clean_email = to_email.strip().lower()

        # 1. Suppression check
        is_suppressed, reason = await self.check_suppression(user_id, clean_email)
        if is_suppressed:
            logger.info(f"[EMAIL] Skipping {clean_email} — suppressed (reason: {reason})")
            return EmailSendResult(
                success=False,
                error_message=f"Recipient email is on suppression list ({reason})",
                status="failed",
                is_retryable=False,
                metadata={"suppressed": True, "suppression_reason": reason},
            )

        # 2. Personalize
        resolved_name = (to_name or "").strip()
        personalized_subject = self.personalize(raw_subject, variables, default_name=resolved_name or "there")
        personalized_html = self.personalize(raw_html, variables, default_name=resolved_name or "there")

        # 3. Sanitize HTML
        safe_html = self.sanitize_html(personalized_html)

        # 4. Generate plain text
        plain_text = self.html_to_plain_text(safe_html)

        # 5. Dispatch
        return await self.provider.send_email(
            to_email=clean_email,
            to_name=resolved_name,
            subject=personalized_subject,
            html_content=safe_html,
            text_content=plain_text,
            from_email=from_email or self.from_email,
            from_name=from_name or self.from_name,
            reply_to=reply_to or self.reply_to,
            headers=headers,
        )


# Singleton instance
_service_instance: Optional[EmailService] = None

def get_email_service() -> EmailService:
    global _service_instance
    if _service_instance is None:
        _service_instance = EmailService()
    return _service_instance
