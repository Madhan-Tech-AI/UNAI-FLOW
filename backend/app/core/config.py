import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "UNAI Flow WhatsApp Gateway"
    app_env: str = "development"
    app_url: str = "http://localhost:8000"
    
    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""
    
    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    
    # Security & Encryption
    session_encryption_key: str = "0123456789abcdef0123456789abcdef"  # 32-byte key for AES-256-GCM
    api_key_pepper: str = "unai_flow_pepper_secret"
    webhook_signing_secret: str = "whsec_default_secret_key"
    
    # WhatsApp Channel API (WCA Engine URL & Key)
    wca_api_url: str = "https://unai-whatsapp-channelapi.onrender.com"
    wca_api_key: str = ""
    
    # Rate Limiting
    rate_limit_per_minute: int = 100
    
    # CORS
    cors_origins: List[str] = ["*"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
