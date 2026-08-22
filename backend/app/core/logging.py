import logging
import json
import contextvars
from datetime import datetime, timezone

# Context variables for distributed tracing
request_id_ctx = contextvars.ContextVar("request_id", default="")
org_id_ctx = contextvars.ContextVar("org_id", default="")
instance_id_ctx = contextvars.ContextVar("instance_id", default="")
job_id_ctx = contextvars.ContextVar("job_id", default="")

class StructuredJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_obj = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_ctx.get(),
            "organization_id": org_id_ctx.get(),
            "instance_id": instance_id_ctx.get(),
            "job_id": job_id_ctx.get(),
        }
        if record.exc_info:
            log_obj["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_obj)

def setup_structured_logging():
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredJsonFormatter())
    
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    # Remove existing handlers to avoid duplicates
    root_logger.handlers = [handler]
    
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

logger = logging.getLogger("unai_whatsapp_gateway")
