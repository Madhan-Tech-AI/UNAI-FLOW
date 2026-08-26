from typing import List, Optional, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "UNAI Flow WhatsApp Gateway"
    app_env: str = "development"
    app_url: str = "http://localhost:8000"
    app_api_key: str = ""
    
    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""
    
    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    
    # Security & Encryption
    session_encryption_key: str = "0123456789abcdef0123456789abcdef"  # 32-byte key for AES-256-GCM
    encryption_key: str = "0123456789abcdef0123456789abcdef"
    api_key_pepper: str = "unai_flow_pepper_secret"
    webhook_signing_secret: str = "whsec_default_secret_key"
    
    # WhatsApp Channel API (WCA Engine URL & Key)
    whatsapp_provider: str = "whatsapp_web"
    whatsapp_provider_config: str = ""
    wca_api_url: str = "https://unai-whatsapp-channelapi.onrender.com"
    wca_api_url_cloud: str = "https://unai-whatsapp-channelapi.onrender.com"
    wca_api_key: str = ""
    
    # Rate Limiting
    rate_limit_per_minute: int = 100
    
    # CORS
    cors_origins: Union[List[str], str] = ["*"]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            v_clean = v.strip()
            if v_clean.startswith("[") and v_clean.endswith("]"):
                import json
                try:
                    return json.loads(v_clean)
                except Exception:
                    pass
            if v_clean == "*":
                return ["*"]
            return [i.strip() for i in v_clean.split(",") if i.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    def get_wca_candidate_urls(self) -> List[str]:
        """Returns ordered list of WCA gateway URLs to try (local first, cloud fallback)."""
        urls = []
        primary = self.wca_api_url.rstrip("/")
        if primary:
            urls.append(primary)
        cloud = self.wca_api_url_cloud.rstrip("/")
        if cloud and cloud not in urls:
            urls.append(cloud)
        return urls

settings = Settings()
