# ✅ SETUP COMPLETE - Quick Start Guide

## Your Configuration

Both frontend and backend are now configured for HTTPS with self-signed certificates.

---

## Starting the Servers

### Option 1: Use the Start Script (Recommended)
```bash
start-all.bat
```

This automatically starts both servers.

### Option 2: Manual Start

**Terminal 1 - Backend:**
```bash
cd backend
python app.py --ssl
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

---

## Access URLs

### On This Computer (Localhost):
- **Frontend:** https://localhost:5173
- **Backend:** https://localhost:5000

### On Mobile/Other Devices (Network):
- **Frontend:** https://192.168.4.190:5173
- **Backend:** https://192.168.4.190:5000

---

## First Time Setup

### 1. Accept SSL Certificate Warning
When you first access the site, your browser will show a warning:
- **Chrome:** Click "Advanced" → "Proceed to site"
- **Firefox:** Click "Advanced" → "Accept the Risk and Continue"
- **Safari:** Click "Show Details" → "Visit this website"

This is normal for self-signed certificates.

### 2. Update Socket.IO URL (if needed)

In `src/VideoConsultation.jsx`, line 72:
```javascript
// Change to your actual IP if different
const SOCKET_SERVER_URL = 'https://192.168.4.190:5000';
```

Your current IP: **192.168.4.190**

---

## Troubleshooting

### "Could not connect to signaling server"

**Check 1: Is backend running?**
```bash
# Should show Flask running on https://0.0.0.0:5000
# Look for the Flask terminal window
```

**Check 2: Are you using HTTPS?**
- Frontend: `https://192.168.4.190:5173` ✓
- Backend: `https://192.168.4.190:5000` ✓
- Both must use HTTPS for network access

**Check 3: Firewall**
Windows may block the connection. Allow Python when prompted.

### Camera Not Working on Mobile

1. **Must use HTTPS** - HTTP won't work on mobile
2. **Accept SSL certificate** - Don't skip the warning
3. **Grant permissions** - Allow camera/mic when prompted

### Can't Access from Mobile

1. **Same Wi-Fi?** - Both devices must be on the same network
2. **Correct IP?** - Use `ipconfig` to verify your IP
3. **Firewall?** - Temporarily disable to test

---

## Regenerate Certificates (if IP changes)

If your IP address changes, regenerate certificates:

**Frontend:**
```bash
del cert.pem key.pem
npm install
```

**Backend:**
```bash
cd backend
python generate-cert.py
```

Then restart both servers.

---

## Testing Checklist

- [ ] Backend running: `python app.py --ssl`
- [ ] Frontend running: `npm run dev`
- [ ] Access via HTTPS (not HTTP)
- [ ] Accept SSL certificate warning
- [ ] Camera permission granted
- [ ] Can see local video preview
- [ ] Can join consultation room

---

## Current Status

✅ Frontend certificates: `cert.pem`, `key.pem` (root folder)
✅ Backend certificates: `backend/cert.pem`, `backend/key.pem`
✅ Vite config: Auto-enables HTTPS when certs exist
✅ Flask config: `--ssl` flag enables HTTPS
✅ React code: User-gesture media initialization
✅ Error handling: Specific messages for each error type

---

## Next Steps

1. Open https://localhost:5173 in your browser
2. Click "Test Camera" to verify camera works
3. Click "Join Consultation" to enter the room
4. On mobile: Open https://192.168.4.190:5173
5. Accept certificate warning
6. Join the same room ID

---

## Support

See `LOCAL-NETWORK-SETUP.md` for detailed documentation.
