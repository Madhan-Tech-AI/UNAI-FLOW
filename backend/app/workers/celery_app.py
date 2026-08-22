import os
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "unai_whatsapp_gateway",
    broker=settings.redis_url,
    backend=settings.redis_url
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,        # 5 minutes max
    task_soft_time_limit=240,   # 4 minutes soft
    worker_prefetch_multiplier=1
)
