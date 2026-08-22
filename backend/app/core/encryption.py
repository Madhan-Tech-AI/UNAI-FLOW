import os
import base64
import json
from typing import Dict, Any, Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.core.config import settings

class EncryptionService:
    def __init__(self, key_hex_or_str: Optional[str] = None):
        raw_key = key_hex_or_str or settings.session_encryption_key
        # Ensure 32-byte key for AES-256
        if len(raw_key.encode('utf-8')) == 32:
            self.key = raw_key.encode('utf-8')
        else:
            # Hash to exactly 32 bytes
            import hashlib
            self.key = hashlib.sha256(raw_key.encode('utf-8')).digest()
        self.aesgcm = AESGCM(self.key)

    def encrypt(self, data: Dict[str, Any]) -> str:
        """Encrypts dictionary data into a base64 encoded AES-256-GCM string (nonce + ciphertext)."""
        nonce = os.urandom(12)  # Standard 96-bit nonce for AESGCM
        payload_bytes = json.dumps(data).encode('utf-8')
        ciphertext = self.aesgcm.encrypt(nonce, payload_bytes, None)
        combined = nonce + ciphertext
        return base64.b64encode(combined).decode('utf-8')

    def decrypt(self, encrypted_b64: str) -> Dict[str, Any]:
        """Decrypts a base64 encoded AES-256-GCM string back into dictionary data."""
        try:
            combined = base64.b64decode(encrypted_b64.encode('utf-8'))
            nonce = combined[:12]
            ciphertext = combined[12:]
            decrypted_bytes = self.aesgcm.decrypt(nonce, ciphertext, None)
            return json.loads(decrypted_bytes.decode('utf-8'))
        except Exception as e:
            raise ValueError(f"Failed to decrypt WhatsApp session credentials: {str(e)}")

encryption_service = EncryptionService()
