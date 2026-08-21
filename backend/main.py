from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, automations, connections, youtube
import os
import asyncio
from contextlib import asynccontextmanager
from app.workers.publishing_worker import PublishingWorker

worker = PublishingWorker()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start worker
    worker_task = asyncio.create_task(worker.start())
    yield
    # Stop worker
    worker.stop()
    await worker_task

app = FastAPI(title="UNAI Flow API", lifespan=lifespan)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.api import health as health_router
from app.api import whatsapp as whatsapp_router
from app.api import channels as channels_router
from app.api import publishing as publishing_router
from app.api import webhooks as webhooks_router

app.include_router(auth.router)
app.include_router(automations.router)
app.include_router(connections.router)
app.include_router(youtube.router)
app.include_router(health_router.router, prefix="/api")
app.include_router(whatsapp_router.router, prefix="/api")
app.include_router(channels_router.router, prefix="/api")
app.include_router(publishing_router.router, prefix="/api")
app.include_router(webhooks_router.router, prefix="/api")

@app.get("/")
def root():
    return {"message": "UNAI Flow API is running. Access /docs for API documentation."}
