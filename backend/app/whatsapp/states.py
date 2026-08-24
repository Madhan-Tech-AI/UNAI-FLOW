"""
Controlled session status enum and valid state transitions for WhatsApp sessions.
The frontend must NEVER invent states — only backend/gateway events can transition.
"""
from enum import Enum
from typing import Dict, Set


class SessionStatus(str, Enum):
    """Controlled WhatsApp session status values."""
    CREATING = "CREATING"
    INITIALIZING = "INITIALIZING"
    WAITING_FOR_SCAN = "WAITING_FOR_SCAN"
    PAIRING = "PAIRING"
    AUTHENTICATED = "AUTHENTICATED"
    SYNCING = "SYNCING"
    READY = "READY"
    CONNECTED = "CONNECTED"  # Alias for READY in legacy code
    DISCONNECTED = "DISCONNECTED"
    RECONNECTING = "RECONNECTING"
    EXPIRED = "EXPIRED"
    ERROR = "ERROR"


# Valid state transitions — any transition not in this map is invalid
VALID_TRANSITIONS: Dict[SessionStatus, Set[SessionStatus]] = {
    SessionStatus.CREATING: {SessionStatus.INITIALIZING, SessionStatus.ERROR},
    SessionStatus.INITIALIZING: {
        SessionStatus.WAITING_FOR_SCAN,
        SessionStatus.CONNECTED,  # If credentials already exist
        SessionStatus.ERROR,
        SessionStatus.DISCONNECTED,
    },
    SessionStatus.WAITING_FOR_SCAN: {
        SessionStatus.PAIRING,
        SessionStatus.EXPIRED,
        SessionStatus.ERROR,
        SessionStatus.DISCONNECTED,
    },
    SessionStatus.PAIRING: {
        SessionStatus.AUTHENTICATED,
        SessionStatus.ERROR,
        SessionStatus.DISCONNECTED,
    },
    SessionStatus.AUTHENTICATED: {
        SessionStatus.SYNCING,
        SessionStatus.READY,
        SessionStatus.CONNECTED,
        SessionStatus.ERROR,
        SessionStatus.DISCONNECTED,
    },
    SessionStatus.SYNCING: {
        SessionStatus.READY,
        SessionStatus.CONNECTED,
        SessionStatus.ERROR,
        SessionStatus.DISCONNECTED,
    },
    SessionStatus.READY: {
        SessionStatus.DISCONNECTED,
        SessionStatus.RECONNECTING,
        SessionStatus.ERROR,
    },
    SessionStatus.CONNECTED: {
        SessionStatus.DISCONNECTED,
        SessionStatus.RECONNECTING,
        SessionStatus.ERROR,
    },
    SessionStatus.DISCONNECTED: {
        SessionStatus.RECONNECTING,
        SessionStatus.INITIALIZING,
        SessionStatus.CREATING,
        SessionStatus.ERROR,
    },
    SessionStatus.RECONNECTING: {
        SessionStatus.INITIALIZING,
        SessionStatus.CONNECTED,
        SessionStatus.READY,
        SessionStatus.ERROR,
        SessionStatus.DISCONNECTED,
    },
    SessionStatus.EXPIRED: {
        SessionStatus.CREATING,
        SessionStatus.INITIALIZING,
        SessionStatus.WAITING_FOR_SCAN,  # QR refresh
        SessionStatus.ERROR,
    },
    SessionStatus.ERROR: {
        SessionStatus.CREATING,
        SessionStatus.INITIALIZING,
        SessionStatus.DISCONNECTED,
    },
}

# Terminal states where polling should stop
TERMINAL_STATES = {
    SessionStatus.READY,
    SessionStatus.CONNECTED,
    SessionStatus.ERROR,
    SessionStatus.DISCONNECTED,
    SessionStatus.EXPIRED,
}

# States that are considered "active" (session is doing something)
ACTIVE_STATES = {
    SessionStatus.CREATING,
    SessionStatus.INITIALIZING,
    SessionStatus.WAITING_FOR_SCAN,
    SessionStatus.PAIRING,
    SessionStatus.AUTHENTICATED,
    SessionStatus.SYNCING,
    SessionStatus.RECONNECTING,
}


def is_valid_transition(from_status: str, to_status: str) -> bool:
    """Check if a state transition is valid."""
    try:
        from_s = SessionStatus(from_status)
        to_s = SessionStatus(to_status)
    except ValueError:
        return False
    return to_s in VALID_TRANSITIONS.get(from_s, set())


def is_terminal(status: str) -> bool:
    """Check if a status is terminal (polling should stop)."""
    try:
        return SessionStatus(status) in TERMINAL_STATES
    except ValueError:
        return False
