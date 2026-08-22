from typing import Optional, Any, Dict

class GatewayException(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        details: Optional[Dict[str, Any]] = None
    ):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(self.message)

class InvalidApiKeyException(GatewayException):
    def __init__(self, message: str = "Invalid or expired API key provided."):
        super().__init__(code="INVALID_API_KEY", message=message, status_code=401)

class InsufficientScopeException(GatewayException):
    def __init__(self, required_scope: str):
        super().__init__(
            code="INSUFFICIENT_SCOPE",
            message=f"API key does not have the required scope: {required_scope}",
            status_code=403,
            details={"required_scope": required_scope}
        )

class InstanceNotFoundException(GatewayException):
    def __init__(self, instance_id: str):
        super().__init__(
            code="INSTANCE_NOT_FOUND",
            message=f"WhatsApp instance '{instance_id}' not found.",
            status_code=404,
            details={"instance_id": instance_id}
        )

class InstanceNotAuthenticatedException(GatewayException):
    def __init__(self, instance_id: str):
        super().__init__(
            code="INSTANCE_NOT_AUTHENTICATED",
            message=f"WhatsApp instance '{instance_id}' is not in an AUTHENTICATED state.",
            status_code=400,
            details={"instance_id": instance_id}
        )

class ChannelNotFoundException(GatewayException):
    def __init__(self, channel_id: str):
        super().__init__(
            code="CHANNEL_NOT_FOUND",
            message=f"WhatsApp channel '{channel_id}' not found.",
            status_code=404,
            details={"channel_id": channel_id}
        )

class ChannelPermissionDeniedException(GatewayException):
    def __init__(self, channel_id: str):
        super().__init__(
            code="CHANNEL_PERMISSION_DENIED",
            message=f"You do not have publishing permission on channel '{channel_id}'.",
            status_code=403,
            details={"channel_id": channel_id}
        )

class InvalidMediaException(GatewayException):
    def __init__(self, message: str):
        super().__init__(code="INVALID_MEDIA", message=message, status_code=400)

class UnsupportedMediaException(GatewayException):
    def __init__(self, mime_type: str):
        super().__init__(
            code="UNSUPPORTED_MEDIA",
            message=f"Media type '{mime_type}' is not supported for WhatsApp Channels.",
            status_code=415,
            details={"mime_type": mime_type}
        )

class MessageSendFailedException(GatewayException):
    def __init__(self, message: str):
        super().__init__(code="MESSAGE_SEND_FAILED", message=message, status_code=502)

class RateLimitedException(GatewayException):
    def __init__(self, retry_after: int = 60):
        super().__init__(
            code="RATE_LIMITED",
            message="Rate limit exceeded. Please retry shortly.",
            status_code=429,
            details={"retry_after": retry_after}
        )

class WhatsAppSessionException(GatewayException):
    def __init__(self, message: str):
        super().__init__(code="WHATSAPP_SESSION_ERROR", message=message, status_code=500)
