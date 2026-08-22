import secrets
import hashlib
import hmac
from typing import Dict, Any, Tuple, List, Optional
from datetime import datetime, timezone
from app.core.config import settings

def generate_api_key(environment: str = "live") -> Tuple[str, str, str]:
    """
    Generates a cryptographically secure random API key.
    Returns: (full_raw_key, prefix, key_hash)
    Example raw key: wa_live_3f9a7b8c...
    """
    prefix = f"wa_{environment}_"
    random_part = secrets.token_urlsafe(32)
    raw_key = f"{prefix}{random_part}"
    key_prefix_display = raw_key[:12]  # e.g. wa_live_3f9a
    key_hash = hash_api_key(raw_key)
    return raw_key, key_prefix_display, key_hash

def hash_api_key(raw_key: str) -> str:
    """Hashes an API key with a secret pepper using HMAC-SHA256."""
    pepper = settings.api_key_pepper.encode('utf-8')
    return hmac.new(pepper, raw_key.encode('utf-8'), hashlib.sha256).hexdigest()

def verify_api_key_hash(raw_key: str, stored_hash: str) -> bool:
    """Secure constant-time comparison for API key hashes."""
    computed_hash = hash_api_key(raw_key)
    return hmac.compare_digest(computed_hash, stored_hash)

def sign_webhook_payload(payload: str, secret: Optional[str] = None) -> str:
    """Signs a webhook payload with HMAC-SHA256."""
    signing_secret = (secret or settings.webhook_signing_secret).encode('utf-8')
    return hmac.new(signing_secret, payload.encode('utf-8'), hashlib.sha256).hexdigest()

def verify_webhook_signature(payload: str, signature: str, secret: Optional[str] = None) -> bool:
    """Verifies a webhook HMAC-SHA256 signature in constant time."""
    expected_sig = sign_webhook_payload(payload, secret)
    return hmac.compare_digest(expected_sig, signature)
