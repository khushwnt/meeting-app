"""Centralized configuration for the FastAPI signaling server.

All values can be overridden with environment variables, which is how
Render/Vercel-style hosting is configured:

    PORT=5000
    CORS_ORIGINS=https://your-app.vercel.app,https://www.yourdomain.com
    SOCKET_CORS_ORIGINS=https://your-app.vercel.app
    REDIS_URL=redis://localhost:6379/0   (or rediss://... for Upstash TLS)
"""

import os


def _normalize_origin(origin: str) -> str:
    # Browsers send `Origin` WITHOUT a trailing slash, so
    # `https://app.vercel.app/` would never match. Strip it.
    return origin.strip().rstrip("/")


def _get_cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "*")
    origins = [_normalize_origin(o) for o in raw.split(",") if o.strip()]
    return origins or ["*"]


HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "5000"))

# CORS: restrict in production, e.g. "https://your-app.vercel.app"
CORS_ORIGINS = _get_cors_origins()
_socket_cors_raw = os.environ.get("SOCKET_CORS_ORIGINS")
SOCKET_CORS_ORIGINS = (
    _normalize_origin(_socket_cors_raw)
    if _socket_cors_raw
    else (CORS_ORIGINS if CORS_ORIGINS != ["*"] else "*")
)

# When set, room state is shared via Redis (multi-instance safe).
# When unset, an in-memory store is used (single instance only).
REDIS_URL = os.environ.get("REDIS_URL", "")

MAX_PARTICIPANTS_PER_ROOM = int(os.environ.get("MAX_PARTICIPANTS_PER_ROOM", "2"))

TITLE = "Telemedicine WebRTC Signaling Server"
