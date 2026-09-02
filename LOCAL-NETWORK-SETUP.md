# Local Network WebRTC Setup Guide

This guide explains how to run your telemedicine app across your local network with proper HTTPS support for camera/microphone access.

## The Problem

Browsers require a **Secure Context (HTTPS)** for `navigator.mediaDevices.getUserMedia()` when accessing from non-localhost addresses. When you access `http://192.168.x.x:5173` from your phone:
- The browser blocks camera/mic permission prompts
- `getUserMedia()` fails silently or throws errors
- WebRTC cannot function

## Solution Overview

1. **Frontend (Vite)**: Enable HTTPS with self-signed certificate
2. **Backend (Flask)**: Enable HTTPS/WSS with self-signed certificate
3. **React Code**: Handle errors gracefully, initialize media on user gesture

---

## Step 1: Install Dependencies

```bash
npm install
```

This installs `selfsigned` for generating SSL certificates.

---

## Step 2: Generate SSL Certificates

### Frontend (Vite)

The certificate is auto-generated with your network IPs. Just run:

```bash
npm install
```

This creates:
- `cert.pem` - SSL certificate (includes your network IPs)
- `key.pem` - Private key

To regenerate (e.g., if your IP changed):
```bash
del cert.pem key.pem
npm install
```

### Backend (Flask)

```bash
cd backend
generate-cert.bat
```

Or manually:
```bash
cd backend
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
```

> **Note**: Your browser will show a security warning for self-signed certificates. Click "Proceed" or "Accept Risk" to continue.

---

## Step 3: Start the Backend (Flask-SocketIO)

### For Local Network Testing (HTTPS):

```bash
cd backend
python app.py --ssl
```

The server will run on:
- `https://localhost:5000`
- `https://YOUR-IP:5000`
- WebSocket endpoint: `wss://YOUR-IP:5000`

### For Localhost Only (HTTP):

```bash
python app.py
```

---

## Step 4: Start the Frontend (Vite + React)

```bash
npm run dev
```

The Vite config automatically enables HTTPS if cert files exist. It will show:
```
  ➜  Local: https://localhost:5173/
  ➜  Network: https://192.168.x.x:5173/
```

### Access from Other Devices

1. Find your machine's IP address (already included in cert):
   ```bash
   # Windows
   ipconfig
   ```

2. On your mobile/other device, access:
   ```
   https://192.168.x.x:5173
   ```

3. Accept the SSL certificate warning in your browser

---

## Step 5: Update Socket.IO Server URL

In `src/VideoConsultation.jsx`, update the `SOCKET_SERVER_URL` to match your backend:

```javascript
// For HTTPS backend (network testing):
const SOCKET_SERVER_URL = 'https://192.168.4.190:5000';

// For HTTP backend (localhost only):
const SOCKET_SERVER_URL = 'http://localhost:5000';
```

> **Important**: Match the protocol! If backend uses HTTPS, frontend must use `https://`.

---

## React Code Changes Summary

### 1. User-Gesture Media Initialization

Media is now initialized when the user clicks "Join Consultation" or "Test Camera", not on page load. This satisfies mobile browser requirements.

### 2. Comprehensive Error Handling

The app now handles these specific errors:

| Error | Message |
|-------|---------|
| `NotAllowedError` | Permission denied - check browser settings |
| `NotFoundError` | No camera/mic found |
| `NotReadableError` | Device in use by another app |
| `TypeError` (no secure context) | **Requires HTTPS** |

### 3. Secure Context Detection

The UI shows warnings when running on HTTP:
```javascript
if (!window.isSecureContext) {
  // Show warning: "Camera access requires HTTPS"
}
```

---

## WebRTC Debugging Checklist

### ✅ Same Wi-Fi Network
- Both devices must be on the same network
- Check firewall settings (allow ports 5000 and 5173)

### ✅ HTTPS for Non-Localelhost
- `localhost` works with HTTP
- `192.168.x.x` requires HTTPS for camera access

### ✅ STUN/TURN Servers

**STUN** (Session Traversal Utilities for NAT):
- Helps discover public IP address
- Already configured: `stun:stun.l.google.com:19302`
- Works for most same-network calls

**TURN** (Traversal Using Relays around NAT):
- Required when direct P2P connection fails
- Needed for different networks (not same Wi-Fi)
- Add to `rtcConfig` in `VideoConsultation.jsx`:

```javascript
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com',
      username: 'your-username',
      credential: 'your-password'
    }
  ]
};
```

**Free TURN Services for Testing:**
- [OpenRelay](https://www.metered.ca/tools/openrelay/)
- [Twilio Network Traversal](https://www.twilio.com/stun) (paid, but reliable)

### ✅ Firewall Configuration

**Windows Firewall:**
```bash
# Allow Python (Flask)
netsh advfirewall firewall add rule name="Flask" dir=in action=allow program="C:\Python39\python.exe" enable=yes

# Allow Node.js (Vite)
netsh advfirewall firewall add rule name="Node.js" dir=in action=allow program="C:\Program Files\nodejs\node.exe" enable=yes
```

**Or temporarily disable firewall for testing** (not recommended for production)

### ✅ Browser Permissions

**Mobile Browsers:**
- Safari iOS: Settings → Safari → Camera/Microphone → Allow
- Chrome Android: Site Settings → Camera/Microphone → Allow
- Must be HTTPS (except localhost)

**Desktop Browsers:**
- Click the lock icon in address bar
- Allow Camera/Microphone

### ✅ ICE Connection States

Check browser console for ICE states:
```
connected    ✓ Success
disconnected ✗ Connection lost
failed       ✗ NAT traversal failed (need TURN)
closed       ℹ Connection closed normally
```

### ✅ Common Issues

| Issue | Solution |
|-------|----------|
| Camera permission not requested | Must use HTTPS for non-localhost |
| "Not a secure context" warning | Access via `https://` not `http://` |
| ICE connection fails | Add TURN server |
| Remote video black screen | Check if both peers joined same room |
| Socket connection refused | Check backend is running, CORS configured |

---

## Quick Start Commands

### Terminal 1 - Backend:
```bash
cd backend
python app.py --ssl
```

### Terminal 2 - Frontend:
```bash
npm run dev
```

### Access URLs:
- **Localhost**: `https://localhost:5173`
- **Network**: `https://YOUR-IP:5173`

---

## Production Checklist

For production deployment:

1. **Use Real SSL Certificates**
   - Let's Encrypt (free)
   - Cloudflare
   - Your domain registrar

2. **Add TURN Servers**
   - coturn (self-hosted)
   - Twilio (managed)

3. **Restrict CORS Origins**
   ```python
   CORS(app, origins=["https://yourdomain.com"])
   socketio = SocketIO(app, cors_allowed_origins="https://yourdomain.com")
   ```

4. **Use Environment Variables**
   - Don't hardcode IPs or credentials

5. **Enable Authentication**
   - Protect rooms with passwords or user accounts

---

## Troubleshooting

### "Camera access requires a secure HTTPS connection"
- You're accessing via HTTP
- Use `https://YOUR-IP:5173` not `http://YOUR-IP:5173`

### SSL Certificate Warning
- Normal for self-signed certificates
- Click "Proceed" or "Accept Risk"

### Backend Connection Refused
- Ensure Flask is running: `python app.py --ssl`
- Check IP address in `SOCKET_SERVER_URL`
- Verify firewall allows port 5000

### Mobile Can't Access
- Both devices on same Wi-Fi
- Firewall allows incoming connections
- Using correct IP address (check with `ipconfig`)

### Video Works Locally But Not on Network
- HTTPS is required for non-localhost
- Check STUN/TURN configuration
- Verify ICE candidates are being exchanged
