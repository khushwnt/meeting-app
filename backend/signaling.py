"""Socket.IO event handlers for WebRTC signaling.

Event names and payloads match what the React frontend (socket.io-client)
expects. Room state lives in ``backend.rooms.store`` (memory or Redis).
When REDIS_URL is set, a Redis manager is attached so emits also reach
clients connected to *other* server instances.
"""

import logging

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
    }
    if config.REDIS_URL:
        try:
            kwargs["client_manager"] = socketio.AsyncRedisManager(config.REDIS_URL)
            logger.info("→ Socket.IO Redis manager enabled (multi-instance)")
        except Exception as exc:
            logger.warning(f"⚠ Could not enable Redis manager ({exc}); single-instance mode")
    return socketio.AsyncServer(**kwargs)


sio = _create_server()


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
        other_sid = await store.get_other_participant_in_room(session["roomId"], sid)
        if other_sid:
            await sio.emit(
                "participant-left",
                {"leftUser": session.get("username", "Participant"), "reason": "disconnected"},
                to=other_sid,
            )

    removed = await store.remove_participant(sid)
    if removed:
        logger.info(f"→ Cleaned up session for room {removed['roomId']}")

    try:
        await sio.leave_room(sid, "*")
    except Exception:
        pass


# =============================================================================
# ROOM MANAGEMENT
# =============================================================================

@sio.on("join-room")
async def handle_join_room(sid, data):
    room_id = (data or {}).get("roomId")
    username = (data or {}).get("username", "Anonymous")
    role = (data or {}).get("role", "participant")

    if not room_id:
        await sio.emit("error", {"message": "Room ID is required"}, to=sid)
        return

    logger.info(f"→ User '{username}' ({role}) attempting to join room: {room_id}")

    if await store.get_room_participant_count(room_id) >= config.MAX_PARTICIPANTS_PER_ROOM:
        logger.warning(f"✗ Room {room_id} is full. Rejecting {username}.")
        await sio.emit(
            "room-full",
            {"message": "This consultation room is already full (max 2 participants)"},
            to=sid,
        )
        return

    await sio.enter_room(sid, room_id)
    await store.add_participant(room_id, sid, username, role)

    other_sid = await store.get_other_participant_in_room(room_id, sid)
    is_first = other_sid is None

    logger.info(f"✓ User '{username}' joined room {room_id}")

    await sio.emit(
        "room-joined",
        {
            "roomId": room_id,
            "username": username,
            "role": role,
            "isFirst": is_first,
            "participantCount": await store.get_room_participant_count(room_id),
        },
        to=sid,
    )

    if other_sid:
        await sio.emit(
            "user-joined",
            {"username": username, "role": role, "sid": sid},
            to=other_sid,
        )
        other_user = (await store.get_session(other_sid)) or {}
        await sio.emit(
            "participant-state",
            {
                "username": other_user.get("username", "Participant"),
                "micEnabled": other_user.get("micEnabled", True),
                "videoEnabled": other_user.get("videoEnabled", True),
            },
            to=sid,
        )


@sio.on("leave-room")
async def handle_leave_room(sid, data=None):
    session = await store.get_session(sid)
    if not session:
        return

    room_id = (data or {}).get("roomId", session["roomId"]) if data else session["roomId"]
    username = session.get("username", "Anonymous")

    other_sid = await store.get_other_participant_in_room(room_id, sid)
    if other_sid:
        await sio.emit(
            "participant-left",
            {"leftUser": username, "reason": "left-gracefully"},
            to=other_sid,
        )

    await sio.leave_room(sid, room_id)
    await store.remove_participant(sid)


# =============================================================================
# WEBRTC SIGNALING RELAY
# =============================================================================

@sio.on("offer")
async def handle_offer(sid, data):
    session = await store.get_session(sid)
    if not session:
        logger.warning(f"✗ Offer received from user not in a room: {sid}")
        return
    other_sid = await store.get_other_participant_in_room(session["roomId"], sid)
    if not other_sid:
        logger.warning(f"✗ No other participant to send offer to in room {session['roomId']}")
        return
    await sio.emit(
        "offer",
        {
            "offer": (data or {}).get("offer"),
            "from": sid,
            "fromUsername": session.get("username", "Participant"),
        },
        to=other_sid,
    )


@sio.on("answer")
async def handle_answer(sid, data):
    session = await store.get_session(sid)
    if not session:
        return
    other_sid = await store.get_other_participant_in_room(session["roomId"], sid)
    if not other_sid:
        return
    await sio.emit(
        "answer",
        {
            "answer": (data or {}).get("answer"),
            "from": sid,
            "fromUsername": session.get("username", "Participant"),
        },
        to=other_sid,
    )


@sio.on("ice-candidate")
async def handle_ice_candidate(sid, data):
    session = await store.get_session(sid)
    if not session:
        return
    other_sid = await store.get_other_participant_in_room(session["roomId"], sid)
    if not other_sid:
        return
    await sio.emit(
        "ice-candidate",
        {"candidate": (data or {}).get("candidate"), "from": sid},
        to=other_sid,
    )


# =============================================================================
# MEDIA STATE BROADCASTING
# =============================================================================

@sio.on("media-state-change")
async def handle_media_state_change(sid, data):
    data = data or {}
    updated = await store.update_media_state(
        sid, data.get("micEnabled"), data.get("videoEnabled")
    )
    if updated is None:
        return

    other_sid = await store.get_other_participant_in_room(updated["roomId"], sid)
    if other_sid:
        await sio.emit(
            "media-state-changed",
            {
                "username": updated.get("username", "Participant"),
                "micEnabled": updated.get("micEnabled", True),
                "videoEnabled": updated.get("videoEnabled", True),
            },
            to=other_sid,
        )
