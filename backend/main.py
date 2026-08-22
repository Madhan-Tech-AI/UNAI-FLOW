from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, automations, connections, youtube
import os
import asyncio
from contextlib import asynccontextmanager
from app.workers.publishing_worker import PublishingWorker
from app.core.exceptions import GatewayException
from app.core.logging import setup_structured_logging, logger

# Initialize structured logging
setup_structured_logging()

worker = PublishingWorker()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start background polling worker
    worker_task = asyncio.create_task(worker.start())
    yield
    # Stop worker
    worker.stop()
    await worker_task

app = FastAPI(
    title="UNAI Flow WhatsApp Channels API Gateway",
    description="Production-ready WhatsApp Channels API Gateway inspired by Whapi.Cloud with multi-tenancy, API keys, and persistent linked-device sessions.",
    version="1.0.0",
    lifespan=lifespan
)

# Global Exception Handler for Gateway domain exceptions
@app.exception_handler(GatewayException)
async def gateway_exception_handler(request: Request, exc: GatewayException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details
            }
        }
    )

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Existing Dashboard Routers
app.include_router(auth.router)
app.include_router(automations.router)
app.include_router(connections.router)
app.include_router(youtube.router)

# Legacy / Prototype API Routers
from app.api import health as legacy_health_router
from app.api import whatsapp as legacy_whatsapp_router
from app.api import channels as legacy_channels_router
from app.api import publishing as legacy_publishing_router
from app.api import webhooks as legacy_webhooks_router

app.include_router(legacy_health_router.router, prefix="/api")
app.include_router(legacy_whatsapp_router.router, prefix="/api")
app.include_router(legacy_channels_router.router, prefix="/api")
app.include_router(legacy_publishing_router.router, prefix="/api")
app.include_router(legacy_webhooks_router.router, prefix="/api")

# New Whapi.Cloud-style v1 Gateway Routers
from app.api.routes import instances as v1_instances
from app.api.routes import channels as v1_channels
from app.api.routes import messages as v1_messages
from app.api.routes import media as v1_media
from app.api.routes import api_keys as v1_api_keys
from app.api.routes import webhooks as v1_webhooks
from app.api.routes import health as v1_health

app.include_router(v1_instances.router)
app.include_router(v1_channels.router)
app.include_router(v1_messages.router)
app.include_router(v1_media.router)
app.include_router(v1_api_keys.router)
app.include_router(v1_webhooks.router)
app.include_router(v1_health.router)

@app.get("/")
def root():
    return {
        "service": "UNAI Flow WhatsApp Channels API Gateway",
        "status": "online",
        "docs_url": "/docs",
        "openapi_url": "/openapi.json"
    }
