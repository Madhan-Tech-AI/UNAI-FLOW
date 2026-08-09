import os
from cryptography.fernet import Fernet

_key = os.getenv("ENCRYPTION_KEY")
if _key:
    fernet = Fernet(_key.encode())
else:
    fernet = None

def encrypt_token(token: str) -> str:
    if not fernet:
        print("WARNING: ENCRYPTION_KEY not set. Using plaintext tokens.")
        return token
    return fernet.encrypt(token.encode()).decode()

def decrypt_token(encrypted_token: str) -> str:
    if not fernet:
        return encrypted_token
    try:
        return fernet.decrypt(encrypted_token.encode()).decode()
    except Exception:
        # Fallback if token was stored in plaintext before key was added
        return encrypted_token
