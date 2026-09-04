"""Google OAuth sign-in + session tokens for the chat app.

Flow:
1. Frontend shows "Sign in with Google" (Google Identity Services) and gets
   a Google ID token.
2. Frontend POSTs it to /api/auth/google. We verify it against Google and
   return our own short-lived JWT + public profile.
3. Frontend opens the Socket.IO connection with `auth: { token }` (or
   `?token=`). The connect handler verifies the JWT and pins the verified
   identity to the socket. Display names/avatars then come from the token,
   never from client input.

Guest mode: if GOOGLE_CLIENT_ID is unset, auth is skipped and anyone can
join with a typed display name (handy for local dev).
"""

import logging
import time
from urllib.parse import parse_qs

try:
    from backend import config
except ImportError:  # allow `cd backend && python main.py`
    import config

logger = logging.getLogger(__name__)

SESSION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

# Verified identity per connected socket: { sid: {sub, name, email, picture} }
# (auth always happens on the node holding the socket, so per-process is fine)
sid_users: dict[str, dict] = {}


def is_auth_required() -> bool:
    if config.REQUIRE_AUTH == "true":
        return True
    if config.REQUIRE_AUTH == "false":
        return False
    return bool(config.GOOGLE_CLIENT_ID)  # "auto"


def verify_google_id_token(id_token: str) -> dict:
    """Verify a Google ID token, return {sub, name, email, picture}."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    info = google_id_token.verify_oauth2_token(
        id_token, google_requests.Request(), config.GOOGLE_CLIENT_ID
    )
    if info.get("aud") != config.GOOGLE_CLIENT_ID:
        raise ValueError("Token audience mismatch")
    return {
        "sub": info.get("sub", ""),
        "name": (info.get("name") or "").strip()[:32] or "Anonymous",
        "email": info.get("email", ""),
        "picture": info.get("picture", ""),
    }


def create_session_token(user: dict) -> str:
    import jwt

    now = int(time.time())
    return jwt.encode(
        {
            "sub": user.get("sub", ""),
            "name": user.get("name", "Anonymous"),
            "email": user.get("email", ""),
            "picture": user.get("picture", ""),
            "iat": now,
            "exp": now + SESSION_TOKEN_TTL_SECONDS,
        },
        config.SECRET_KEY,
        algorithm="HS256",
    )


def verify_session_token(token: str) -> dict | None:
    import jwt

    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])
        if not payload.get("sub"):
            return None
        return {
            "sub": payload.get("sub", ""),
            "name": (payload.get("name") or "").strip()[:32] or "Anonymous",
            "email": payload.get("email", ""),
            "picture": payload.get("picture", ""),
        }
    except Exception:
        return None


def extract_token(environ, auth) -> str:
    """Token from Socket.IO auth payload or `?token=` query string."""
    if isinstance(auth, dict) and auth.get("token"):
        return str(auth["token"])
    qs = environ.get("QUERY_STRING", "") if isinstance(environ, dict) else ""
    try:
        params = parse_qs(qs)
        if params.get("token"):
            return str(params["token"][0])
    except Exception:
        pass
    return ""


def public_profile(user: dict) -> dict:
    return {"name": user.get("name", "Anonymous"), "picture": user.get("picture", "")}
