from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, automations, connections, youtube, email_campaigns
from app.workers.email_worker import email_worker
import os
import asyncio
import logging
from contextlib import asynccontextmanager

# Try importing optional gateway components — these may fail if
# Redis, Celery, or Playwright dependencies are missing on Render.
try:
    from app.core.exceptions import GatewayException
    HAS_GATEWAY_EXCEPTIONS = True
except ImportError:
    HAS_GATEWAY_EXCEPTIONS = False

try:
    from app.core.logging import setup_structured_logging, logger
    setup_structured_logging()
except ImportError:
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)

# PublishingWorker is optional — it polls whatsapp_publish_jobs and
# requires WhatsAppWebSessionProvider which may not be installable.
worker = None
try:
    from app.workers.publishing_worker import PublishingWorker
    worker = PublishingWorker()
except Exception as e:
    logger.warning(f"PublishingWorker unavailable (non-fatal): {e}")

# CampaignWorker for WhatsApp bulk messaging campaigns
campaign_worker = None
try:
    from app.workers.campaign_worker import campaign_worker
    from app.services.campaign_service import campaign_service
    campaign_service.set_worker_trigger(campaign_worker.trigger)
except Exception as e:
    logger.warning(f"CampaignWorker unavailable (non-fatal): {e}")

async def _warmup_wca():
    """Wake up the WCA service on Render before accepting requests."""
    import httpx
    try:
        from app.core.config import settings
        url = f"{settings.wca_api_url.rstrip('/')}/health"
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(url)
            logger.info(f"[STARTUP] WCA warm-up: {r.status_code}")
    except Exception as e:
        logger.warning(f"[STARTUP] WCA warm-up failed (will retry on first request): {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure Supabase storage buckets exist
    try:
        from lib.supabase_client import ensure_storage_buckets
        ensure_storage_buckets()
    except Exception as e:
        logger.warning(f"[STARTUP] Storage buckets check note: {e}")

    # Wake up WCA service (non-blocking)
    asyncio.create_task(_warmup_wca())

    worker_task = None
    if worker:
        worker_task = asyncio.create_task(worker.start())
        logger.info("[STARTUP] PublishingWorker started.")

    email_worker_task = asyncio.create_task(email_worker.start())
    logger.info("[STARTUP] EmailWorker started.")

    campaign_worker_task = None
    if campaign_worker:
        campaign_worker_task = asyncio.create_task(campaign_worker.start())
        logger.info("[STARTUP] CampaignWorker started.")

    yield

    if worker:
        worker.stop()
        if worker_task:
            await worker_task

    email_worker.stop()
    if email_worker_task:
        await email_worker_task

    if campaign_worker:
        campaign_worker.stop()
        if campaign_worker_task:
            await campaign_worker_task

app = FastAPI(
    title="UNAI Flow WhatsApp Channels API Gateway",
    description="Production-ready WhatsApp Channels API Gateway inspired by Whapi.Cloud with multi-tenancy, API keys, and persistent linked-device sessions.",
    version="1.0.0",
    lifespan=lifespan
)

# Global Exception Handler for Gateway domain exceptions
if HAS_GATEWAY_EXCEPTIONS:
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

# API Logging Middleware for developer usage analytics & metering
# NOTE: This must be added BEFORE CORSMiddleware because FastAPI's
# middleware stack is LIFO — last added = runs first (outermost).
try:
    from app.middleware.api_logging_middleware import ApiLoggingMiddleware
    app.add_middleware(ApiLoggingMiddleware)
except Exception as e:
    logger.warning(f"ApiLoggingMiddleware unavailable (non-fatal): {e}")

# Configure CORS — added LAST so it wraps everything (runs first in LIFO)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://unai-flow-rc39.vercel.app",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Existing Dashboard Routers
app.include_router(auth.router)
app.include_router(automations.router)
app.include_router(connections.router)
app.include_router(youtube.router)
app.include_router(email_campaigns.router, prefix="/api")
app.include_router(email_campaigns.router)

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

# New Whapi.Cloud-style v1 Gateway Routers (optional — may fail if deps missing)
try:
    from app.api.routes import instances as v1_instances
    from app.api.routes import channels as v1_channels
    from app.api.routes import messages as v1_messages
    from app.api.routes import media as v1_media
    from app.api.routes import api_keys as v1_api_keys
    from app.api.routes import webhooks as v1_webhooks
    from app.api.routes import health as v1_health
    from app.api.routes import campaigns as v1_campaigns
    from app.api.routes import usage as v1_usage

    app.include_router(v1_instances.router)
    app.include_router(v1_channels.router)
    app.include_router(v1_messages.router)
    app.include_router(v1_media.router)
    app.include_router(v1_api_keys.router)
    app.include_router(v1_webhooks.router)
    app.include_router(v1_health.router)
    app.include_router(v1_campaigns.router)
    app.include_router(v1_usage.router)
except Exception as e:
    logger.warning(f"v1 Gateway routers unavailable (non-fatal): {e}")

@app.get("/")
def root():
    return {
        "service": "UNAI Flow WhatsApp Channels API Gateway",
        "status": "online",
        "docs_url": "/docs",
        "openapi_url": "/openapi.json"
    }

@app.get("/health")
def health():
    return {"status": "ok", "service": "unai-flow-backend"}
