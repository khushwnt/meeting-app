"""Telemedicine WebRTC signaling server — FastAPI + python-socketio.

Local run (from project root):
    python -m backend.main            # HTTP dev
    python -m backend.main --ssl      # HTTPS (needs backend/cert.pem + key.pem)

Production (Render):
    uvicorn backend.main:socket_app --host 0.0.0.0 --port $PORT
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from backend import config
    from backend.rooms import store
    from backend.signaling import sio
except ImportError:  # allow `cd backend && python main.py`
    import config
    from rooms import store
    from signaling import sio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# FASTAPI APP
# =============================================================================

app = FastAPI(title=config.TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint (also used by Render)."""
    stats = await store.stats()
    return JSONResponse(
        {
            "status": "healthy",
            "framework": "fastapi",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **stats,
        }
    )


@app.get("/api/rooms")
async def list_active_rooms():
    """Public lobby endpoint: rooms that currently have participants.

    Response: {"rooms": [{"roomId": str, "participants": int, "maxParticipants": int}]}
    Only rooms with at least one participant are listed.
    """
    return JSONResponse({"rooms": await store.list_rooms()})


@app.get("/debug/rooms")
async def debug_rooms():
    """Debug endpoint (development only)."""
    return JSONResponse({"rooms": await store.list_rooms(), **await store.stats()})


# Wrap FastAPI with Socket.IO — this is the ASGI app uvicorn must serve.
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)


# =============================================================================
# CLI RUNNER (local dev)
# =============================================================================

def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=config.TITLE)
    parser.add_argument("--ssl", action="store_true", help="Enable HTTPS with cert.pem/key.pem")
    parser.add_argument("--host", default=config.HOST, help="Host to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=config.PORT, help="Port to bind (default: 5000)")
    parser.add_argument("--no-reload", action="store_true", help="Disable uvicorn auto-reload")
    return parser.parse_args(argv)


def main(argv=None):
    import uvicorn

    args = parse_args(argv)
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    cert_path = os.path.join(backend_dir, "cert.pem")
    key_path = os.path.join(backend_dir, "key.pem")

    ssl_kwargs = {}
    if args.ssl:
        if not (os.path.exists(cert_path) and os.path.exists(key_path)):
            print("⚠ SSL certificates not found in backend/!")
            print("  Generate them with:  python backend/generate-cert.py")
            sys.exit(1)
        ssl_kwargs = {"ssl_keyfile": key_path, "ssl_certfile": cert_path}

    print(f"""
    ╔═══════════════════════════════════════════════════════════╗
    ║     TELEMEDICINE WEBRTC SIGNALING SERVER (FastAPI)        ║
    ║     {'🔒 HTTPS' if args.ssl else '📡 HTTP '}  {args.host}:{args.port}
    ║     Socket.IO endpoint ready                              ║
    ╚═══════════════════════════════════════════════════════════╝
    """)

    target = "backend.main:socket_app" if os.path.exists(
        os.path.join(os.getcwd(), "backend", "main.py")) else "main:socket_app"
    uvicorn.run(
        target,
        host=args.host,
        port=args.port,
        reload=not args.no_reload,
        **ssl_kwargs,
    )


if __name__ == "__main__":
    main()
