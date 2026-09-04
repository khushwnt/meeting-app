"""Room, session, and message state with a pluggable backend.

- MemoryStore: in-memory dicts (single instance only, local dev default).
- RedisStore: shared state via Redis (multi-instance safe, used when
  REDIS_URL is set — e.g. Render + Upstash). Doubles as free message
  history storage (recent messages per room, capped + expiring).

Redis schema (all keys prefixed with ``tele:``):
- ``tele:rooms``            Set of active room ids
- ``tele:room:{roomId}``    Set of participant sids in the room
- ``tele:session:{sid}``    Hash {roomId, username}
- ``tele:history:{roomId}`` List of recent message JSON blobs (newest at tail)
"""

import json
import logging

try:
    from backend import config
except ImportError:  # allow `cd backend && python main.py`
    import config

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 24 * 60 * 60
HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60

ROOM_KEY_PREFIX = "tele:room:"
SESSION_KEY_PREFIX = "tele:session:"
HISTORY_KEY_PREFIX = "tele:history:"
ROOMS_INDEX_KEY = "tele:rooms"


class MemoryStore:
    """Single-process in-memory store."""

    def __init__(self):
        self.room_participants: dict[str, list[str]] = {}
        self.user_sessions: dict[str, dict] = {}
        self.message_history: dict[str, list[dict]] = {}

    async def get_session(self, sid: str) -> dict | None:
        return self.user_sessions.get(sid)

    async def get_other_participant_in_room(self, room_id: str, current_sid: str) -> str | None:
        for sid in self.room_participants.get(room_id, []):
            if sid != current_sid:
                return sid
        return None

    async def get_room_participant_count(self, room_id: str) -> int:
        return len(self.room_participants.get(room_id, []))

    async def get_room_users(self, room_id: str) -> list[dict]:
        users = []
        for sid in self.room_participants.get(room_id, []):
            session = self.user_sessions.get(sid)
            if session:
                users.append({"username": session.get("username", "Anonymous")})
        return sorted(users, key=lambda u: u["username"].lower())

    async def add_participant(self, room_id: str, sid: str, username: str) -> None:
        self.room_participants.setdefault(room_id, [])
        if sid not in self.room_participants[room_id]:
            self.room_participants[room_id].append(sid)
        self.user_sessions[sid] = {"roomId": room_id, "username": username}

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

    async def add_message(self, room_id: str, message: dict) -> None:
        history = self.message_history.setdefault(room_id, [])
        history.append(message)
        if len(history) > config.MAX_HISTORY:
            del history[: -config.MAX_HISTORY]

    async def get_history(self, room_id: str) -> list[dict]:
        return list(self.message_history.get(room_id, []))

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

    def _history_key(self, room_id: str) -> str:
        return f"{HISTORY_KEY_PREFIX}{room_id}"

    async def get_session(self, sid: str) -> dict | None:
        data = await self._redis.hgetall(self._session_key(sid))
        if not data:
            return None
        return {"roomId": data.get("roomId", ""), "username": data.get("username", "Anonymous")}

    async def get_other_participant_in_room(self, room_id: str, current_sid: str) -> str | None:
        members = await self._redis.smembers(self._room_key(room_id))
        for sid in members:
            if sid != current_sid:
                return sid
        return None

    async def get_room_participant_count(self, room_id: str) -> int:
        return await self._redis.scard(self._room_key(room_id))

    async def get_room_users(self, room_id: str) -> list[dict]:
        members = await self._redis.smembers(self._room_key(room_id))
        users = []
        for sid in members:
            session = await self.get_session(sid)
            if session:
                users.append({"username": session.get("username", "Anonymous")})
        return sorted(users, key=lambda u: u["username"].lower())

    async def add_participant(self, room_id: str, sid: str, username: str) -> None:
        room_key = self._room_key(room_id)
        session_key = self._session_key(sid)
        async with self._redis.pipeline() as pipe:
            pipe.sadd(room_key, sid)
            pipe.expire(room_key, SESSION_TTL_SECONDS)
            pipe.sadd(ROOMS_INDEX_KEY, room_id)
            pipe.hset(session_key, mapping={"roomId": room_id, "username": username})
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

    async def add_message(self, room_id: str, message: dict) -> None:
        history_key = self._history_key(room_id)
        async with self._redis.pipeline() as pipe:
            pipe.rpush(history_key, json.dumps(message))
            pipe.ltrim(history_key, -config.MAX_HISTORY, -1)
            pipe.expire(history_key, HISTORY_TTL_SECONDS)
            await pipe.execute()

    async def get_history(self, room_id: str) -> list[dict]:
        raw = await self._redis.lrange(self._history_key(room_id), 0, -1)
        messages = []
        for item in raw:
            try:
                messages.append(json.loads(item))
            except (ValueError, TypeError):
                continue
        return messages

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
