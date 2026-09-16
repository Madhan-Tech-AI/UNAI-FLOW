import time
import asyncio
import secrets
import logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response, JSONResponse
from app.services.usage_service import usage_service
from app.core.logging import org_id_ctx, request_id_ctx, app_id_ctx

logger = logging.getLogger("unai_whatsapp_gateway")


class ApiLoggingMiddleware(BaseHTTPMiddleware):
    """
    Middleware that automatically assigns a unique correlation request ID (X-Request-ID),
    tracks latency, catches unhandled route errors inside CORS boundary to prevent
    CORS-obscured failures, and logs every public /v1/ API call into api_request_log.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        req_id = request.headers.get("x-request-id") or f"req_{secrets.token_hex(8)}"
        request_id_ctx.set(req_id)

        path = request.url.path

        # Handle non-v1 paths with basic error containment
        if not path.startswith("/v1/"):
            try:
                response = await call_next(request)
            except Exception as exc:
                logger.error(f"Unhandled error on {request.method} {path} (Request ID: {req_id}): {exc}", exc_info=True)
                return JSONResponse(
                    status_code=500,
                    headers={"X-Request-ID": req_id},
                    content={"error": {"code": "INTERNAL_SERVER_ERROR", "message": "Internal Server Error", "request_id": req_id}}
                )
            response.headers["X-Request-ID"] = req_id
            return response

        start_time = time.monotonic()

        try:
            response = await call_next(request)
        except Exception as exc:
            latency_ms = int((time.monotonic() - start_time) * 1000)
            logger.error(
                f"Unhandled 500 error on {request.method} {path} (Request ID: {req_id}): {exc}",
                exc_info=True
            )
            # Construct a safe JSON response guaranteed to be wrapped by CORSMiddleware
            origin = request.headers.get("origin")
            err_headers = {
                "X-Request-ID": req_id,
                "Access-Control-Expose-Headers": "*",
            }
            if origin:
                err_headers["Access-Control-Allow-Origin"] = origin
                err_headers["Access-Control-Allow-Credentials"] = "true"
                err_headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
                err_headers["Access-Control-Allow-Headers"] = "*"

            response = JSONResponse(
                status_code=500,
                headers=err_headers,
                content={
                    "error": {
                        "code": "INTERNAL_SERVER_ERROR",
                        "message": "An unexpected server error occurred. Please try again or contact support.",
                        "request_id": req_id,
                        "details": {}
                    }
                }
            )

        latency_ms = int((time.monotonic() - start_time) * 1000)

        # Attach correlation ID to every response
        response.headers["X-Request-ID"] = req_id
        response.headers["Access-Control-Expose-Headers"] = "*"

        # Contextual metadata extracted from contextvars & headers
        org_id = org_id_ctx.get(None)
        app_id = app_id_ctx.get(None)
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
