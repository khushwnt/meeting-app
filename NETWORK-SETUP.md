# Network Access Setup Guide

## Your Network Configuration

- **Your Local IP:** `192.168.4.190`
- **Backend Port:** `5000`
- **Frontend Port:** `5173`

## Quick Start (Easiest)

Run the included batch file:

```bash
start-network.bat
```

This automatically:
1. Installs dependencies (if needed)
2. Starts the backend on your network IP
3. Starts the frontend with network access
4. Opens both in separate windows

---

## Manual Setup

### Step 1: Start Backend

```bash
cd backend
python app.py
```

The backend is already configured to bind to `0.0.0.0` (all network interfaces).

### Step 2: Start Frontend

```bash
npm run dev
```

Vite is configured to expose the dev server on your network.

---

## Windows Firewall Setup

When you first run the servers, Windows Firewall will likely block incoming connections. You'll see a popup like this:

```
Windows Security Alert
Windows Firewall has blocked some features of this app
```

**Click "Allow access"** for both Python and Node.js.

### If You Don't See the Popup (or Need to Manually Add Rules)

#### Option 1: Quick Allow (Development Only)

Open PowerShell as Administrator and run:

```powershell
# Allow Python (Flask backend) on port 5000
New-NetFirewallRule -DisplayName "Flask SocketIO" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow

# Allow Node.js (Vite frontend) on port 5173
New-NetFirewallRule -DisplayName "Vite Dev Server" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
```

#### Option 2: Manual Firewall Rule (GUI)

1. Press `Win + R`, type `wf.msc`, press Enter
2. Click **"Inbound Rules"** → **"New Rule..."**
3. Select **"Port"** → Next
4. Select **"TCP"**, enter `5000,5173` → Next
5. Select **"Allow the connection"** → Next
6. Check all profiles (Domain, Private, Public) → Next
7. Name: `Telemedicine App` → Finish

#### Option 3: Temporarily Disable Firewall (Not Recommended for Production)

For testing only:
1. Windows Security → Firewall & network protection
2. Turn off Windows Defender Firewall (temporarily)

---

## How Others Can Join

### Share This URL

Send this to anyone on your network (same Wi-Fi):

```
http://192.168.4.190:5173/?room=CONSULT-123
```

They can use any room name, but both participants must use the **same room ID**.

### Example Usage

**Doctor:**
- Opens: `http://192.168.4.190:5173/?room=APPT-001`
- Clicks "Join Consultation"
- Waits for patient

**Patient:**
- Opens: `http://192.168.4.190:5173/?room=APPT-001`
- Clicks "Join Consultation"
- Connects to doctor

---

## Troubleshooting

### "Cannot connect to server" / "Connection timeout"

**Check 1: Verify IP Address**
Your IP might have changed. Run:
```bash
ipconfig
```
Look for "IPv4 Address" under your active connection (Wi-Fi or Ethernet).

Update `SOCKET_SERVER_URL` in `src/VideoConsultation.jsx`:
```javascript
const SOCKET_SERVER_URL = 'http://YOUR-IP:5000';
```

**Check 2: Test Backend Connectivity**
From another device on the same network, open:
```
http://192.168.4.190:5000/health
```
You should see: `{"status": "healthy", ...}`

**Check 3: Test Frontend Connectivity**
From another device:
```
http://192.168.4.190:5173
```
You should see the telemedicine app.

### "Connection refused" or "ERR_CONNECTION_REFUSED"

The server isn't binding to your network interface. Verify:

1. Backend is running (check terminal output)
2. Vite config has `host: true`
3. No other app is using ports 5000 or 5173

To check for port conflicts:
```bash
# Windows
netstat -ano | findstr :5000
netstat -ano | findstr :5173
```

### Firewall Still Blocking

Temporarily disable firewall to test:
1. Windows Security → Firewall & network protection
2. Turn off firewall
3. Test connection
4. **Turn firewall back on** and add specific rules (see above)

### Works Locally But Not From Other Devices

1. **Check network profile:** Windows may treat your network as "Public" which has stricter firewall rules
   - Settings → Network & Internet → Wi-Fi/Ethernet
   - Change from "Public" to "Private"

2. **Check router isolation:** Some routers have "AP Isolation" that prevents devices from communicating
   - Log into your router admin panel
   - Look for "AP Isolation" or "Client Isolation"
   - Disable it

3. **Verify same network:** Ensure both devices are on the same Wi-Fi network

### Video Not Working (Black Screen)

WebRTC requires secure contexts (HTTPS) in some browsers. For local network testing:

**Chrome/Edge:**
1. Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Enable the flag
3. Add `http://192.168.4.190:5173` to the list
4. Restart browser

**Or use Firefox** (more permissive with localhost WebRTC)

---

## Dynamic IP Warning

Your IP address (`192.168.4.190`) is assigned by DHCP and **may change** when:
- You restart your router
- Your lease expires (usually 24 hours)
- You connect to a different network

If the IP changes:
1. Run `ipconfig` to get the new IP
2. Update `SOCKET_SERVER_URL` in `VideoConsultation.jsx`
3. Restart the frontend

### Make IP Static (Optional)

To prevent IP changes:

**Option 1: Router DHCP Reservation** (Recommended)
1. Log into your router (usually `192.168.4.1` or `192.168.1.1`)
2. Find "DHCP Reservation" or "Static Lease"
3. Add your computer's MAC address with desired IP
4. Save and reboot router

**Option 2: Windows Static IP**
1. Settings → Network & Internet → Wi-Fi/Ethernet
2. Hardware properties → Edit (IP assignment)
3. Manual → IPv4 → Enter static IP

---

## Production Deployment

For production (beyond local network):

1. **Deploy Backend** to a cloud server (AWS, Heroku, DigitalOcean)
2. **Deploy Frontend** to Vercel, Netlify, or same server
3. **Use HTTPS** (required for WebRTC in production)
4. **Add authentication** to protect consultations
5. **Use a TURN server** for NAT traversal

---

## Security Notes

⚠️ **Local network access is for development/testing only.**

Anyone on your Wi-Fi can access the app. For sensitive telemedicine:

1. **Add authentication** (username/password)
2. **Use room passwords**
3. **Deploy to a secure server** with HTTPS
4. **Don't use on public Wi-Fi** without proper security
