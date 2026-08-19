import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    PORT: int = int(os.getenv("PORT", os.getenv("WCA_PORT", "3001")))
    API_KEY: str = os.getenv("WCA_API_KEY", "105eadef-beae-4e08-bcc0-85a06ff80727")
    CHANNEL_LINK: str = os.getenv("WCA_CHANNEL_LINK", "https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M")
    CHANNEL_ID: str = os.getenv("WCA_CHANNEL_ID", "0029VbDxqHz6hENhNBcZM31M")
    CHANNEL_NAME: str = os.getenv("WCA_CHANNEL_NAME", os.getenv("WHATSAPP_CHANNEL_NAME", "Madhan Tech AI"))
    SESSION_DIR: str = os.getenv("WCA_SESSION_DIR", "./sessions/wa_profile")
    DUPLICATE_WINDOW_SEC: int = int(os.getenv("WCA_DUPLICATE_WINDOW_SEC", "300"))
    MAX_REQUESTS_PER_MINUTE: int = int(os.getenv("WCA_MAX_REQUESTS_PER_MINUTE", "30"))

config = Config()
