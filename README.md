# Telemedicine Video Consultation App

Peer-to-peer video consultations with WebRTC. A **FastAPI + python-socketio**
signaling server relays connection metadata (SDP offers/answers, ICE candidates)
while audio/video streams flow directly between peers — media never touches the server.

## Stack

| Layer    | Tech                                                              |
|----------|-------------------------------------------------------------------|
| Backend  | FastAPI + python-socketio + uvicorn, Redis-backed rooms (`backend/`) |
| Frontend | React + Vite + Tailwind CSS + socket.io-client (`src/`)           |

## Local development

**1. Backend** (from project root):

```bash
pip install -r backend/requirements.txt
python -m backend.main
```

Server runs on `http://localhost:5000`. Health check: `http://localhost:5000/health`

Optional local Redis (enables the shared room store + lobby across instances):

```bash
docker run -p 6379:6379 redis:7
REDIS_URL=redis://localhost:6379/0 python -m backend.main
```

**2. Frontend** (new terminal, from project root):

```bash
npm install
npm run dev
```

App runs on `http://localhost:5173`. The frontend talks to the backend URL from
`VITE_SOCKET_URL`, falling back to `http://localhost:5000` locally.

**3. Test a call:** open the app in two browser windows, pick (or type) the same
room name, and click **Join Consultation** in each. `?room=CONSULT-123` still
prefills the room input.

## Deploy: Vercel (frontend) + Render (backend)

### 1. Redis (free) — Upstash

1. Create a free Redis database at [upstash.com](https://upstash.com).
2. Copy the **TLS** endpoint, e.g. `rediss://default:xxxx@xxx.upstash.io:6379`.
   This becomes your `REDIS_URL`.

### 2. Backend — Render (Web Service inside a Project)

1. Render Dashboard → **New → Project** → name it (e.g. `telemedicine`) → Create.
2. Inside the project → **New → Web Service** → connect GitHub → select this repo, branch `main`.
3. Configure the service:
   - **Name:** `telemedicine-signaling`
   - **Region:** closest to your users (e.g. Singapore for India)
   - **Runtime:** **Python 3** (change this manually — the repo's root
     `package.json` can make Render pick Node instead)
   - **Build Command:** `pip install -r backend/requirements.txt`
   - **Start Command:** `uvicorn backend.main:socket_app --host 0.0.0.0 --port $PORT`
   - **Health Check Path:** `/health`
   - **Instance Type:** Free
   - **Environment variables:**
     - `CORS_ORIGINS` → `https://placeholder.vercel.app` for now (you'll
       replace it with the real Vercel URL in step 4)
     - `REDIS_URL` → your Upstash TLS endpoint (`rediss://...`)
     - `PYTHON_VERSION` → `3.12.0`
4. Deploy. Note the backend URL, e.g. `https://telemedicine-signaling.onrender.com`.

### 3. Frontend — Vercel

1. Import this repo in Vercel (framework preset: **Vite**).
2. Add environment variable: `VITE_SOCKET_URL=https://<your-render-backend>.onrender.com`
3. Deploy. Open `https://your-app.vercel.app` in two windows to test a call.

> Render free instances sleep when idle — the first load after inactivity can
> take ~1 minute while the backend wakes up.

## Project structure

```
telemedicine-app/
├── backend/
│   ├── main.py           # FastAPI app, /health, /api/rooms, uvicorn runner
│   ├── signaling.py      # Socket.IO handlers (rooms, WebRTC relay, media state)
│   ├── rooms.py          # Room store: in-memory or Redis (via REDIS_URL)
│   ├── config.py         # Env-based settings (PORT, CORS, REDIS_URL)
│   ├── generate-cert.py  # Self-signed certs for local HTTPS testing
│   └── requirements.txt  # Python dependencies
├── src/
│   ├── VideoConsultation.jsx  # Lobby + video call UI, WebRTC, Socket.IO client
│   ├── App.jsx
│   └── main.jsx
└── .env.example          # All environment variables
```

## API

- `GET /health` → `{"status": "healthy", ...}`
- `GET /api/rooms` → `{"rooms": [{"roomId", "participants", "maxParticipants"}]}`

Socket.IO events — client → server: `join-room`, `leave-room`, `offer`,
`answer`, `ice-candidate`, `media-state-change`. Server → client:
`room-joined`, `user-joined`, `participant-left`, `participant-state`,
`offer`, `answer`, `ice-candidate`, `media-state-changed`, `room-full`, `error`.

Rooms support a maximum of 2 participants (`MAX_PARTICIPANTS_PER_ROOM`).

## Production notes

- `CORS_ORIGINS` must list your exact frontend origin(s) — never leave `*` in production.
- For calls across different networks/NATs, add a **TURN server** to `rtcConfig`
  in `VideoConsultation.jsx` (STUN alone often fails off-LAN).
- Add authentication before allowing room access for real consultations.
- Use real TLS everywhere (Vercel/Render provide this automatically).
