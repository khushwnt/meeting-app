"""Room and session state with a pluggable backend.

- MemoryStore: in-memory dicts (single instance only, local dev default).
- RedisStore: shared state via Redis (multi-instance safe, used when
  REDIS_URL is set — e.g. Render + Upstash).

Redis schema (all keys prefixed with ``tele:``):
- ``tele:rooms``            Set of active room ids
- ``tele:room:{roomId}``    Set of participant sids in the room
- ``tele:session:{sid}``    Hash {roomId, username, role, micEnabled, videoEnabled}
"""

import logging

try:
    from backend import config
except ImportError:  # allow `cd backend && python main.py`
    import config

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 24 * 60 * 60

ROOM_KEY_PREFIX = "tele:room:"
SESSION_KEY_PREFIX = "tele:session:"
ROOMS_INDEX_KEY = "tele:rooms"


def _to_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).lower() in ("1", "true", "yes", "on")


class MemoryStore:
    """Single-process in-memory store."""

    def __init__(self):
        self.room_participants: dict[str, list[str]] = {}
        self.user_sessions: dict[str, dict] = {}

    async def get_session(self, sid: str) -> dict | None:
        return self.user_sessions.get(sid)

    async def get_other_participant_in_room(self, room_id: str, current_sid: str) -> str | None:
        for sid in self.room_participants.get(room_id, []):
            if sid != current_sid:
                return sid
        return None

    async def get_room_participant_count(self, room_id: str) -> int:
        return len(self.room_participants.get(room_id, []))

    async def add_participant(self, room_id: str, sid: str, username: str, role: str) -> None:
        self.room_participants.setdefault(room_id, [])
        if sid not in self.room_participants[room_id]:
            self.room_participants[room_id].append(sid)
        self.user_sessions[sid] = {
            "roomId": room_id,
            "username": username,
            "role": role,
            "micEnabled": True,
            "videoEnabled": True,
        }

    async def remove_participant(self, sid: str) -> dict | None:
        session = self.user_sessions.pop(sid, None)
        if session is None:
            return None
        participants = self.room_participants.get(session["roomId"])
        if participants and sid in participants:
            participants.remove(sid)
            if not participants:
                del self.room_participants[session["roomId"]]
        return session

    async def update_media_state(
        self, sid: str, mic_enabled: bool | None, video_enabled: bool | None
    ) -> dict | None:
        session = self.user_sessions.get(sid)
        if session is None:
            return None
        if mic_enabled is not None:
            session["micEnabled"] = mic_enabled
        if video_enabled is not None:
            session["videoEnabled"] = video_enabled
        return session

    async def list_rooms(self) -> list[dict]:
        return [
            {
                "roomId": room_id,
                "participants": len(sids),
                "maxParticipants": config.MAX_PARTICIPANTS_PER_ROOM,
            }
            for room_id, sids in self.room_participants.items()
            if sids
        ]

    async def stats(self) -> dict:
        return {
            "activeRooms": len([s for s in self.room_participants.values() if s]),
            "activeConnections": len(self.user_sessions),
        }


class RedisStore:
    """Shared Redis-backed store (multi-instance safe). Requires the `redis` package."""

    def __init__(self, url: str):
        import redis.asyncio as redis

        self._redis = redis.from_url(url, decode_responses=True)

    def _room_key(self, room_id: str) -> str:
        return f"{ROOM_KEY_PREFIX}{room_id}"

    def _session_key(self, sid: str) -> str:
        return f"{SESSION_KEY_PREFIX}{sid}"

    async def get_session(self, sid: str) -> dict | None:
        data = await self._redis.hgetall(self._session_key(sid))
        if not data:
            return None
        return {
            "roomId": data.get("roomId", ""),
            "username": data.get("username", "Anonymous"),
            "role": data.get("role", "participant"),
            "micEnabled": _to_bool(data.get("micEnabled", "true")),
            "videoEnabled": _to_bool(data.get("videoEnabled", "true")),
        }

    async def get_other_participant_in_room(self, room_id: str, current_sid: str) -> str | None:
        members = await self._redis.smembers(self._room_key(room_id))
        for sid in members:
            if sid != current_sid:
                return sid
        return None

    async def get_room_participant_count(self, room_id: str) -> int:
        return await self._redis.scard(self._room_key(room_id))

    async def add_participant(self, room_id: str, sid: str, username: str, role: str) -> None:
        room_key = self._room_key(room_id)
        session_key = self._session_key(sid)
        async with self._redis.pipeline() as pipe:
            pipe.sadd(room_key, sid)
            pipe.expire(room_key, SESSION_TTL_SECONDS)
            pipe.sadd(ROOMS_INDEX_KEY, room_id)
            pipe.hset(
                session_key,
                mapping={
                    "roomId": room_id,
                    "username": username,
                    "role": role,
                    "micEnabled": "true",
                    "videoEnabled": "true",
                },
            )
            pipe.expire(session_key, SESSION_TTL_SECONDS)
            await pipe.execute()

    async def remove_participant(self, sid: str) -> dict | None:
        session = await self.get_session(sid)
        if session is None:
            return None
        room_key = self._room_key(session["roomId"])
        async with self._redis.pipeline() as pipe:
            pipe.srem(room_key, sid)
            pipe.delete(self._session_key(sid))
            await pipe.execute()
        if await self._redis.scard(room_key) == 0:
            async with self._redis.pipeline() as pipe:
                pipe.delete(room_key)
                pipe.srem(ROOMS_INDEX_KEY, session["roomId"])
                await pipe.execute()
        return session

    async def update_media_state(
        self, sid: str, mic_enabled: bool | None, video_enabled: bool | None
    ) -> dict | None:
        session = await self.get_session(sid)
        if session is None:
            return None
        mapping = {}
        if mic_enabled is not None:
            session["micEnabled"] = mic_enabled
            mapping["micEnabled"] = "true" if mic_enabled else "false"
        if video_enabled is not None:
            session["videoEnabled"] = "true" if video_enabled else "false"
            session["videoEnabled"] = video_enabled
        if mapping:
            await self._redis.hset(self._session_key(sid), mapping=mapping)
        return session

    async def list_rooms(self) -> list[dict]:
        rooms = []
        for room_id in await self._redis.smembers(ROOMS_INDEX_KEY):
            count = await self._redis.scard(self._room_key(room_id))
            if count > 0:
                rooms.append(
                    {
                        "roomId": room_id,
                        "participants": count,
                        "maxParticipants": config.MAX_PARTICIPANTS_PER_ROOM,
                    }
                )
        return sorted(rooms, key=lambda r: r["roomId"])

    async def stats(self) -> dict:
        room_ids = await self._redis.smembers(ROOMS_INDEX_KEY)
        # Session count via key scan (fine for signaling-scale keyspaces)
        session_count = 0
        async for _ in self._redis.scan_iter(f"{SESSION_KEY_PREFIX}*"):
            session_count += 1
        return {"activeRooms": len(room_ids), "activeConnections": session_count}


def create_store():
    if config.REDIS_URL:
        try:
            store = RedisStore(config.REDIS_URL)
            logger.info("→ Using Redis room store")
            return store
        except Exception as exc:
            logger.warning(f"⚠ Could not initialize Redis ({exc}); falling back to memory store")
    return MemoryStore()


store = create_store()
