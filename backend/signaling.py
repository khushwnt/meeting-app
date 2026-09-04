"""Socket.IO event handlers for the chat app.

No auth — anyone with a display name can join a room and chat.
Text + voice-note messages are broadcast to the room and stored
(memory, or Redis when REDIS_URL is set) so late joiners get history.

Client → server: join-room, leave-room, chat-message, voice-message, typing
Server → client: room-joined, user-joined, participant-left, room-users,
                 chat-history, chat-message, voice-message, typing,
                 room-full, error
"""

import logging
import time
import uuid

import socketio

try:
    from backend import config
    from backend.rooms import store
except ImportError:  # allow `cd backend && python main.py`
    import config
    from rooms import store

logger = logging.getLogger(__name__)


def _create_server() -> socketio.AsyncServer:
    kwargs = {
        "async_mode": "asgi",
        "cors_allowed_origins": config.SOCKET_CORS_ORIGINS,
        # Voice notes ride over the socket; allow payloads above the 1MB default.
        "max_http_buffer_size": config.MAX_SOCKET_BUFFER_SIZE,
    }
    if config.REDIS_URL:
        try:
            kwargs["client_manager"] = socketio.AsyncRedisManager(config.REDIS_URL)
            logger.info("→ Socket.IO Redis manager enabled (multi-instance)")
        except Exception as exc:
            logger.warning(f"⚠ Could not enable Redis manager ({exc}); single-instance mode")
    return socketio.AsyncServer(**kwargs)


sio = _create_server()


def _clean_username(raw) -> str:
    name = str(raw or "").strip()
    return name[:32] if name else "Anonymous"


async def _broadcast_users(room_id: str) -> None:
    await sio.emit("room-users", {"users": await store.get_room_users(room_id)}, room=room_id)


# =============================================================================
# CONNECTION LIFECYCLE
# =============================================================================

@sio.event
async def connect(sid, environ):
    logger.info(f"✓ Client connected: {sid}")


@sio.event
async def disconnect(sid):
    logger.info(f"✗ Client disconnected: {sid}")

    session = await store.get_session(sid)
    if session:
        room_id = session["roomId"]
        await sio.emit(
            "participant-left",
            {"leftUser": session.get("username", "Anonymous"), "reason": "disconnected"},
            room=room_id,
        )
        await store.remove_participant(sid)
        await _broadcast_users(room_id)

    try:
        await sio.leave_room(sid, "*")
    except Exception:
        pass


# =============================================================================
# ROOM MANAGEMENT
# =============================================================================

@sio.on("join-room")
async def handle_join_room(sid, data):
    room_id = str((data or {}).get("roomId") or "").strip()[:64]
    username = _clean_username((data or {}).get("username"))

    if not room_id:
        await sio.emit("error", {"message": "Room name is required"}, to=sid)
        return

    logger.info(f"→ User '{username}' attempting to join room: {room_id}")

    if await store.get_room_participant_count(room_id) >= config.MAX_PARTICIPANTS_PER_ROOM:
        logger.warning(f"✗ Room {room_id} is full. Rejecting {username}.")
        await sio.emit(
            "room-full",
            {"message": "This room is full. Please try another one."},
            to=sid,
        )
        return

    await sio.enter_room(sid, room_id)
    await store.add_participant(room_id, sid, username)

    count = await store.get_room_participant_count(room_id)
    logger.info(f"✓ User '{username}' joined room {room_id} ({count} online)")

    await sio.emit(
        "room-joined",
        {"roomId": room_id, "username": username, "participantCount": count},
        to=sid,
    )
    await sio.emit(
        "user-joined",
        {"username": username},
        room=room_id,
        skip_sid=sid,
    )
    await sio.emit("chat-history", {"messages": await store.get_history(room_id)}, to=sid)
    await _broadcast_users(room_id)


@sio.on("leave-room")
async def handle_leave_room(sid, data=None):
    session = await store.get_session(sid)
    if not session:
        return

    room_id = (data or {}).get("roomId", session["roomId"]) if data else session["roomId"]
    username = session.get("username", "Anonymous")

    await sio.emit(
        "participant-left",
        {"leftUser": username, "reason": "left"},
        room=room_id,
    )
    await sio.leave_room(sid, room_id)
    await store.remove_participant(sid)
    await _broadcast_users(room_id)


# =============================================================================
# CHAT MESSAGING
# =============================================================================

@sio.on("chat-message")
async def handle_chat_message(sid, data):
    session = await store.get_session(sid)
    if not session:
        await sio.emit("error", {"message": "Join a room first"}, to=sid)
        return

    text = str((data or {}).get("text") or "").strip()
    if not text:
        return
    text = text[: config.MAX_TEXT_LENGTH]

    client_id = str((data or {}).get("id") or "")[:64]
    message = {
        "id": client_id or uuid.uuid4().hex,
        "roomId": session["roomId"],
        "sender": session.get("username", "Anonymous"),
        "type": "text",
        "text": text,
        "timestamp": int(time.time() * 1000),
    }
    await store.add_message(session["roomId"], message)
    await sio.emit("chat-message", message, room=session["roomId"])


@sio.on("voice-message")
async def handle_voice_message(sid, data):
    session = await store.get_session(sid)
    if not session:
        await sio.emit("error", {"message": "Join a room first"}, to=sid)
        return

    audio = (data or {}).get("audio") or ""
    mime_type = str((data or {}).get("mimeType") or "audio/webm")
    try:
        duration = float((data or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0

    if not audio or len(audio) > config.MAX_VOICE_CHARS:
        await sio.emit("error", {"message": "Voice note was rejected (empty or too long)"}, to=sid)
        return

    client_id = str((data or {}).get("id") or "")[:64]
    message = {
        "id": client_id or uuid.uuid4().hex,
        "roomId": session["roomId"],
        "sender": session.get("username", "Anonymous"),
        "type": "voice",
        "audio": audio,
        "mimeType": mime_type[:64],
        "duration": round(max(0, min(duration, 600)), 1),
        "timestamp": int(time.time() * 1000),
    }
    await store.add_message(session["roomId"], message)
    await sio.emit("voice-message", message, room=session["roomId"])


@sio.on("typing")
async def handle_typing(sid, data):
    session = await store.get_session(sid)
    if not session:
        return
    await sio.emit(
        "typing",
        {
            "username": session.get("username", "Anonymous"),
            "isTyping": bool((data or {}).get("isTyping")),
        },
        room=session["roomId"],
        skip_sid=sid,
    )
