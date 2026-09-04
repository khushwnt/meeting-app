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

MAX_PARTICIPANTS_PER_ROOM = int(os.environ.get("MAX_PARTICIPANTS_PER_ROOM", "50"))

# Auth (Google OAuth). If GOOGLE_CLIENT_ID is unset, anyone can join as a
# guest with a typed name (local dev). Set it to require Google sign-in.
# REQUIRE_AUTH: "auto" (default) = required iff GOOGLE_CLIENT_ID is set.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")
REQUIRE_AUTH = os.environ.get("REQUIRE_AUTH", "auto")

# Chat limits
MAX_HISTORY = int(os.environ.get("MAX_HISTORY", "100"))
MAX_TEXT_LENGTH = int(os.environ.get("MAX_TEXT_LENGTH", "2000"))
# Max base64 voice-note payload (~1.3MB of audio after base64 inflation).
MAX_VOICE_CHARS = int(os.environ.get("MAX_VOICE_CHARS", "2000000"))
# Socket.IO payload ceiling must exceed the largest voice note.
MAX_SOCKET_BUFFER_SIZE = int(os.environ.get("MAX_SOCKET_BUFFER_SIZE", "4000000"))

TITLE = "Meeting Room Chat Server"
