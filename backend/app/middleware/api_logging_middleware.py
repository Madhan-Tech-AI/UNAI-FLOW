import time
import asyncio
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from app.services.usage_service import usage_service
from app.core.logging import org_id_ctx, request_id_ctx, app_id_ctx


class ApiLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that automatically logs every public /v1/ API call
    into the api_request_log database table for usage metering,
    latency tracking, and developer analytics.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Only track /v1/ public API endpoints (skip docs, openapi, root health)
        if not path.startswith("/v1/"):
            return await call_next(request)

        start_time = time.monotonic()
        response = await call_next(request)
        latency_ms = int((time.monotonic() - start_time) * 1000)

        # Contextual metadata extracted from contextvars & headers
        org_id = org_id_ctx.get(None)
        app_id = app_id_ctx.get(None)
        req_id = request_id_ctx.get(None) or request.headers.get("x-request-id")
        idempotency_key = request.headers.get("idempotency-key")
        user_agent = request.headers.get("user-agent")
        ip = request.client.host if request.client else None

        req_size = None
        if "content-length" in request.headers:
            try:
                req_size = int(request.headers["content-length"])
            except ValueError:
                pass

        res_size = None
        if "content-length" in response.headers:
            try:
                res_size = int(response.headers["content-length"])
            except ValueError:
                pass

        # Log asynchronously non-blocking in threadpool
        try:
            asyncio.create_task(
                asyncio.to_thread(
                    usage_service.log_request,
                    organization_id=org_id,
                    api_key_id=None,
                    method=request.method,
                    path=path,
                    status_code=response.status_code,
                    latency_ms=latency_ms,
                    request_size_bytes=req_size,
                    response_size_bytes=res_size,
                    ip_address=ip,
                    user_agent=user_agent,
                    idempotency_key=idempotency_key,
                    request_id=req_id,
                    application_id=app_id,
                )
            )
        except Exception:
            pass

        return response
