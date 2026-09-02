"""
UNAI Flow Email Automation Service Package
"""
from .base import BaseEmailProvider, EmailSendResult
from .gateway_provider import UnaiEmailGatewayProvider
from .service import EmailService, get_email_service
from .template_generator import generate_recipient_template
from .excel_parser import parse_recipient_spreadsheet

__all__ = [
    "BaseEmailProvider",
    "EmailSendResult",
    "UnaiEmailGatewayProvider",
    "EmailService",
    "get_email_service",
    "generate_recipient_template",
    "parse_recipient_spreadsheet",
]
