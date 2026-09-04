# Meeting Room Chat App

No-auth group chat: pick a display name, join a room, send **text messages**
and **WhatsApp-style voice notes**. A **FastAPI + python-socketio** backend
relays messages in real time and keeps recent history (in memory, or in Redis
when `REDIS_URL` is set).

## Stack

| Layer    | Tech                                                        |
|----------|-------------------------------------------------------------|
| Backend  | FastAPI + python-socketio + uvicorn, Redis history (`backend/`) |
| Frontend | React + Vite + Tailwind CSS + socket.io-client (`src/`)     |

## Local development

**1. Backend** (from project root):

```bash
pip install -r backend/requirements.txt
python -m backend.main
```

Server runs on `http://localhost:5000`. Health: `http://localhost:5000/health`

Optional local Redis (shared state + history across instances):

```bash
docker run -p 6379:6379 redis:7
REDIS_URL=redis://localhost:6379/0 python -m backend.main
```

**2. Frontend** (new terminal, from project root):

```bash
npm install
npm run dev
```

App runs on `http://localhost:5173`. It talks to the backend URL from
`VITE_SOCKET_URL`, falling back to `http://localhost:5000` locally.

**3. Test:** open the app in two windows, enter different names, join the same
room — send text and voice notes both ways. `?room=lounge` prefills the room.

Voice notes need microphone access over HTTPS (or localhost).

## Deploy: Vercel (frontend) + Render (backend)

### 1. Redis (free) — Upstash

Upstash free tier → create a database → copy the **TLS** endpoint
(`rediss://...`). This is your `REDIS_URL` (state + message history).

### 2. Backend — Render (Web Service inside a Project)

1. Render Dashboard → **New → Project** → Create → **New → Web Service** →
   select this repo, branch `main`.
2. Settings: **Runtime: Python 3** (not Node), Build:
   `pip install -r backend/requirements.txt`, Start:
   `uvicorn backend.main:socket_app --host 0.0.0.0 --port $PORT`,
   Health Check Path: `/health`, Instance: Free.
3. Env vars: `CORS_ORIGINS=https://<your-vercel-app>` (exact, no trailing
   slash), `REDIS_URL=<upstash endpoint>`, `PYTHON_VERSION=3.12.0`.

### 3. Frontend — Vercel

Import repo (Vite preset) → env var
`VITE_SOCKET_URL=https://<your-render-backend>.onrender.com` → Deploy.

> Render free sleeps when idle — first load after inactivity takes ~1 min.

## Project structure

```
├── backend/
│   ├── main.py           # FastAPI app, /health, /api/rooms, uvicorn runner
│   ├── signaling.py      # Socket.IO: join/leave, text, voice, typing, history
│   ├── rooms.py          # Room/user/message store: memory or Redis
│   ├── config.py         # Env-based settings
│   └── requirements.txt
├── src/
│   ├── ChatApp.jsx       # Lobby + chat room UI, socket wiring
│   ├── VoiceRecorder.jsx # Mic recording with live waveform + timer
│   ├── VoiceNote.jsx     # Voice-note playback bubble
│   └── App.jsx
└── .env.example
```

## API

- `GET /health` → `{"status": "healthy", ...}`
- `GET /api/rooms` → `{"rooms": [{"roomId", "participants", "maxParticipants"}]}`

Socket.IO — client → server: `join-room`, `leave-room`, `chat-message`,
`voice-message`, `typing`. Server → client: `room-joined`, `user-joined`,
`participant-left`, `room-users`, `chat-history`, `chat-message`,
`voice-message`, `typing`, `room-full`, `error`.

Limits (env-tunable): `MAX_HISTORY=100` messages/room (7-day TTL on Redis),
`MAX_TEXT_LENGTH=2000` chars, voice notes capped at ~2MB base64 (~several
minutes of Opus audio).

## Free database options (when you outgrow Redis history)

The app already persists recent history in the **Upstash Redis you run for
rooms** — no extra service needed to start. When you need permanent,
searchable, or large-scale storage:

| Option | Free tier | Best for |
|---|---|---|
| **Upstash Redis** (already used) | 10k commands/day | Recent history, presence, rate limits — start here |
| **Supabase** (Postgres + Auth + Storage) | 500MB DB, 1GB storage | Permanent chat history, user accounts later, audio file storage |
| **Neon** (serverless Postgres) | 512MB–3GB | Drop-in Postgres history table via SQLAlchemy |
| **MongoDB Atlas** | 512MB (M0) | Document-style messages (`{room, sender, type, payload, ts}`) |
| **Cloudflare D1** (SQLite) | 5GB | Tiny structured history with zero ops |
| **Turso** (SQLite edge) | 9GB | Same idea, generous free tier |

Rule of thumb: keep **hot/recent** messages in Redis (fast, TTL'd) and, if you
ever need archives, write through to **Supabase/Neon** and serve "load older"
from there. Voice audio at scale belongs in object storage (Supabase Storage
or Cloudinary free tier), with only metadata + URLs in the database.

## Production notes

- `CORS_ORIGINS` must list your exact frontend origin(s).
- Cap/restrict uploads further if the room is public (size + rate limits).
- Add auth + moderation before any public launch.
