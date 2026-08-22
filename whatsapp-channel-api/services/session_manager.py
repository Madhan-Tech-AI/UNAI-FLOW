import asyncio
import logging
from typing import Dict, Optional

from services.whatsapp_engine import WhatsAppEngine

logger = logging.getLogger("WCASessionManager")

class WCASessionManager:
    def __init__(self):
        self.sessions: Dict[str, WhatsAppEngine] = {}
        self._lock = asyncio.Lock()

    async def get_or_create(self, session_identifier: str) -> WhatsAppEngine:
        async with self._lock:
            if session_identifier not in self.sessions:
                logger.info(f"Creating new WhatsAppEngine for session: {session_identifier}")
                self.sessions[session_identifier] = WhatsAppEngine(session_identifier)
            return self.sessions[session_identifier]
            
    def get(self, session_identifier: str) -> Optional[WhatsAppEngine]:
        return self.sessions.get(session_identifier)

    async def start_engine(self, session_identifier: str):
        engine = await self.get_or_create(session_identifier)
        await engine.initialize()

    async def close(self, session_identifier: str):
        async with self._lock:
            engine = self.sessions.pop(session_identifier, None)
            if engine:
                logger.info(f"Closing WhatsAppEngine for session: {session_identifier}")
                await engine.close()

    async def close_all(self):
        async with self._lock:
            tasks = []
            for session_identifier, engine in self.sessions.items():
                logger.info(f"Closing WhatsAppEngine for session: {session_identifier}")
                tasks.append(engine.close())
            if tasks:
                await asyncio.gather(*tasks)
            self.sessions.clear()

session_manager = WCASessionManager()
