# Telemedicine WebRTC Signaling Server

A production-ready WebRTC signaling server built with Flask-SocketIO for telemedicine video consultations.

## Architecture Overview

```
┌─────────────────┐                          ┌─────────────────┐
│   React Frontend│                          │  Flask Backend  │
│   (Video UI)    │◄──── Socket.IO ─────────►│  (Signaling)    │
│                 │     (WebSocket)          │                 │
└────────┬────────┘                          └────────┬────────┘
         │                                           │
         │                                           │
         └────────────── WebRTC Media ───────────────┘
                    (Peer-to-Peer Direct)
```

**Key Concept:** The signaling server ONLY relays connection metadata (SDP offers/answers, ICE candidates). The actual video/audio media flows **directly** between peers and never touches the server.

---

## Prerequisites

- **Python 3.8+** installed
- **Node.js 16+** installed
- **npm** (comes with Node.js)

---

## Setup Instructions

### Step 1: Install Python Dependencies

Open a terminal in the project root and run:

```bash
cd backend
pip install -r requirements.txt
```

**What gets installed:**
- `Flask` - Web framework
- `Flask-SocketIO` - WebSocket support for real-time signaling
- `Flask-CORS` - Cross-Origin Resource Sharing for React frontend
- `python-socketio` - Core Socket.IO library

### Step 2: Install Node.js Dependencies

In the project root:

```bash
npm install socket.io-client
```

**What gets installed:**
- `socket.io-client` - React client for Socket.IO connections

---

## Running the Application

### Terminal 1: Start the Backend (Flask-SocketIO)

```bash
cd backend
python app.py
```

You should see:
```
╔═══════════════════════════════════════════════════════════╗
║     TELEMEDICINE WEBRTC SIGNALING SERVER                  ║
║                                                           ║
║  Server running on: http://localhost:5000                 ║
║  Socket.IO endpoint: ws://localhost:5000                  ║
║                                                           ║
║  Health check: http://localhost:5000/health               ║
║  Debug rooms: http://localhost:5000/debug/rooms           ║
╚═══════════════════════════════════════════════════════════╝
```

### Terminal 2: Start the Frontend (React + Vite)

```bash
npm run dev
```

You should see:
```
VITE ready in XXX ms
➜  Local:   http://localhost:5173/
```

---

## Testing the Video Call

### Open Two Browser Windows

1. **Window 1 (Doctor):** Open `http://localhost:5173/?room=TEST-123`
2. **Window 2 (Patient):** Open `http://localhost:5173/?room=TEST-123`

Both windows must use the **same room ID** to connect to each other.

### Expected Flow

1. **First person joins:**
   - Sees "Waiting for other participant to join..."
   - Camera preview is visible in bottom-right corner

2. **Second person joins:**
   - WebRTC handshake begins automatically
   - After ~2-5 seconds, remote video appears
   - Both participants can see/hear each other

3. **During call:**
   - Toggle mic/camera buttons work instantly
   - Remote participant sees muted/off indicators
   - Picture-in-picture shows your own video

4. **When someone leaves:**
   - Remaining participant gets an alert
   - Remote video disappears
   - Can continue waiting for new participant

---

## How WebRTC Signaling Works

### The Handshake Sequence

```
Doctor (Peer 1)                          Patient (Peer 2)
     │                                         │
     │  1. join-room("TEST-123")               │
     │────────────────────────────────────────>│
     │                                         │
     │  2. room-joined (isFirst: false)        │
     │<────────────────────────────────────────│
     │                                         │
     │  3. Create OFFER                        │
     │     (SDP: "I want to send video/audio") │
     │                                         │
     │  4. emit('offer', offer)                │
     │────────────────────────────────────────>│
     │                                         │
     │                                         │ 5. Receive OFFER
     │                                         │    setRemoteDescription(offer)
     │                                         │    Create ANSWER
     │                                         │    (SDP: "OK, send it!")
     │                                         │
     │  6. emit('answer', answer)              │
     │<────────────────────────────────────────│
     │                                         │
     │  7. Receive ANSWER                      │
     │     setRemoteDescription(answer)        │
     │                                         │
     │  8. ICE Candidates exchange (both ways) │
     │<═══════════════════════════════════════>│
     │     (Network paths: "Try this IP:port") │
     │                                         │
     │  9. Connection established! 🎉          │
     │     Media flows directly (P2P)          │
     │                                         │
```

### Key Components

| Component | Purpose |
|-----------|---------|
| **SDP Offer/Answer** | Session description: codecs, resolution, media types |
| **ICE Candidates** | Network connection info (IP addresses, ports) |
| **STUN Server** | Discovers your public IP address (Google provides free ones) |
| **TURN Server** | Relays media when direct P2P fails (needed for restrictive NATs) |

---

## Socket.IO Events Reference

### Client → Server Events

| Event | Payload | Description |
|-------|---------|-------------|
| `join-room` | `{ roomId, username, role }` | Join a consultation room |
| `leave-room` | `{ roomId }` | Leave the current room |
| `offer` | `{ offer }` | Send WebRTC offer to peer |
| `answer` | `{ answer }` | Send WebRTC answer to peer |
| `ice-candidate` | `{ candidate }` | Send ICE candidate to peer |
| `media-state-change` | `{ micEnabled, videoEnabled }` | Broadcast media toggle state |

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `room-joined` | `{ roomId, isFirst, participantCount }` | Confirmation of joining room |
| `user-joined` | `{ username, role, sid }` | Another user joined the room |
| `participant-left` | `{ leftUser, reason }` | Someone left the room |
| `offer` | `{ offer, fromUsername }` | Received WebRTC offer |
| `answer` | `{ answer, fromUsername }` | Received WebRTC answer |
| `ice-candidate` | `{ candidate, from }` | Received ICE candidate |
| `media-state-changed` | `{ username, micEnabled, videoEnabled }` | Peer toggled mic/camera |
| `room-full` | `{ message }` | Room already has 2 participants |
| `error` | `{ message }` | Generic error from server |

---

## Troubleshooting

### "Could not connect to signaling server"

**Fix:** Ensure the Flask backend is running on port 5000:
```bash
cd backend
python app.py
```

### "No camera/microphone access"

**Fix:** 
- Check browser permissions (click the lock icon in address bar)
- Ensure no other app is using the camera
- Try Chrome/Edge (best WebRTC support)

### "Waiting for other participant..." (never connects)

**Possible causes:**
1. Different room IDs - both users must use the same `?room=XXX` parameter
2. Firewall blocking WebSocket - check port 5000 is open
3. Browser compatibility - use Chrome/Edge/Firefox (not Safari on iOS without HTTPS)

### "ICE connection failed"

**Fix:** This usually means NAT traversal failed. For production, add a TURN server:

```javascript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { 
      urls: 'turn:your-turn-server.com', 
      username: 'user', 
      credential: 'pass' 
    }
  ]
};
```

Free TURN servers:
- [Twilio TURN](https://www.twilio.com/studio)
- [Xirsys](https://xirsys.com/pricing/)

---

## Production Deployment

### Backend (Flask-SocketIO)

For production, use **Gunicorn** with **eventlet** for better performance:

```bash
pip install gunicorn eventlet
gunicorn -k eventlet -w 1 -b 0.0.0.0:5000 app:app
```

**Important:** 
- Set `cors_allowed_origins` to your production domain
- Use Redis for multi-server deployments (Socket.IO needs sticky sessions)
- Add authentication to room joining

### Frontend (React)

Build for production:

```bash
npm run build
```

Deploy the `dist/` folder to your hosting (Vercel, Netlify, etc.)

Update `SOCKET_SERVER_URL` in `VideoConsultation.jsx` to your production backend URL.

---

## Security Considerations

⚠️ **This is a development setup. For production:**

1. **Add Authentication:** Verify user identity before allowing room access
2. **Use HTTPS/WSS:** Encrypt all traffic (required for WebRTC in some browsers)
3. **Rate Limiting:** Prevent abuse of signaling endpoints
4. **Room Passwords:** Add password protection for consultations
5. **Logging:** Log all room events for compliance (HIPAA, etc.)
6. **TURN Credentials:** Use time-limited TURN credentials

---

## File Structure

```
telemedicine-app/
├── backend/
│   ├── app.py                 # Flask-SocketIO signaling server
│   └── requirements.txt       # Python dependencies
├── src/
│   ├── App.jsx                # Main React app (wrapper)
│   ├── VideoConsultation.jsx  # Video call component with WebRTC
│   └── ...
├── package.json               # Node.js dependencies
└── README.md                  # This file
```

---

## Next Steps

1. **Add Authentication:** Integrate with your existing user system
2. **Add Recording:** Use MediaRecorder API to record consultations
3. **Add Chat:** Implement text chat alongside video
4. **Add Screen Sharing:** Use `navigator.mediaDevices.getDisplayMedia()`
5. **Add Waiting Room:** Let doctors admit patients from a waiting queue
6. **Integrate Third-Party:** Swap custom WebRTC for Daily.co/Agora if needed

---

## Resources

- [WebRTC Basics](https://webrtc.org/getting-started/overview)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [Flask-SocketIO Documentation](https://flask-socketio.readthedocs.io/)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
