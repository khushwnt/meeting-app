"""
================================================================================
TELEMEDICINE WEBRTC SIGNALING SERVER
================================================================================
This Flask-SocketIO server handles WebRTC signaling for video consultations.

FEATURES:
- Room Management: Join/leave rooms with max 2 participants
- WebRTC Signaling: Relay offers, answers, and ICE candidates
- State Broadcasting: Broadcast mic/camera toggle states
- Disconnection Handling: Gracefully handle unexpected disconnects

HOW WEBRTC SIGNALING WORKS:
1. Patient joins room -> waits for Doctor
2. Doctor joins room -> creates OFFER -> sends to Patient
3. Patient receives OFFER -> creates ANSWER -> sends to Doctor
4. Both peers exchange ICE CANDIDATES (network connection info)
5. Peer-to-peer connection established (video/audio flows directly)

The server ONLY relays signaling messages. Media never touches the server!
================================================================================
"""

from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
from flask_cors import CORS
import logging
from datetime import datetime

# =============================================================================
# FLASK APP CONFIGURATION
# =============================================================================

app = Flask(__name__)

# Enable CORS for React frontend (adjust origin for production)
# Updated to include HTTPS origins for secure context
CORS(app, origins=["https://localhost:5173", "http://localhost:5173", "https://192.168.*", "http://192.168.*", "*"])

# SocketIO configuration
# - cors_allowed_origins: Allow connections from React dev server
# - async_mode: 'eventlet' or 'gevent' for production, 'threading' for dev
# - logger: Enable SocketIO logging for debugging
socketio = SocketIO(
    app,
    cors_allowed_origins="*",  # Restrict this in production!
    async_mode="threading",
    logger=True,
    engineio_logger=True,
    allow_unsafe_werkzeug=True  # Required for Flask 2.0+
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# SERVER-SIDE STATE (In-Memory)
# =============================================================================
# In production, use Redis for multi-server deployments

# Track room participants: { roomId: [sid1, sid2] }
room_participants = {}

# Track user info: { sid: { roomId, username, role, micEnabled, videoEnabled } }
user_sessions = {}


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def get_other_participant_in_room(room_id, current_sid):
    """
    Get the socket ID of the other participant in a room.
    Returns None if no other participant exists.
    """
    if room_id not in room_participants:
        return None
    
    for sid in room_participants[room_id]:
        if sid != current_sid:
            return sid
    return None


def get_room_participant_count(room_id):
    """Get the number of participants in a room."""
    return len(room_participants.get(room_id, []))


# =============================================================================
# SOCKET.IO EVENT HANDLERS
# =============================================================================

@socketio.on('connect')
def handle_connect():
    """
    Called when a client successfully connects to the WebSocket.
    Log the connection for debugging.
    """
    sid = request.sid
    logger.info(f"✓ Client connected: {sid}")


@socketio.on('disconnect')
def handle_disconnect():
    """
    Called when a client disconnects (gracefully or unexpectedly).
    CRITICAL: Clean up room state and notify other participant.
    """
    sid = request.sid
    
    logger.info(f"✗ Client disconnected: {sid}")
    
    # Check if user was in a room
    if sid in user_sessions:
        user_info = user_sessions[sid]
        room_id = user_info['roomId']
        
        # Remove from room participants
        if room_id in room_participants:
            room_participants[room_id].remove(sid)
            
            # Notify the other participant that user left
            other_sid = get_other_participant_in_room(room_id, sid)
            if other_sid:
                socketio.emit('participant-left', {
                    'leftUser': user_info.get('username', 'Participant'),
                    'reason': 'disconnected'
                }, room=other_sid)
                logger.info(f"→ Notified {other_sid} that {sid} left room {room_id}")
            
            # Clean up empty room
            if not room_participants[room_id]:
                del room_participants[room_id]
                logger.info(f"→ Room {room_id} is now empty, cleaned up")
        
        # Remove user session
        del user_sessions[sid]
    
    # Leave any Socket.IO rooms (cleanup)
    for room in rooms(sid):
        leave_room(room)


@socketio.on('join-room')
def handle_join_room(data):
    """
    Handle a user joining a consultation room.
    
    EXPECTED DATA:
    {
        roomId: string,      // e.g., "CONSULT-123"
        username: string,    // e.g., "Dr. Smith" or "Patient John"
        role: string         // e.g., "doctor" or "patient"
    }
    
    RESPONSES:
    - 'room-full': Emitted if room already has 2 participants
    - 'room-joined': Emitted to the joining user with room state
    - 'user-joined': Broadcast to other participant
    """
    sid = request.sid
    
    # Validate input
    room_id = data.get('roomId')
    username = data.get('username', 'Anonymous')
    role = data.get('role', 'participant')
    
    if not room_id:
        socketio.emit('error', {'message': 'Room ID is required'}, room=sid)
        return
    
    logger.info(f"→ User '{username}' ({role}) attempting to join room: {room_id}")
    
    # CHECK: Is room already full? (Max 2 participants)
    current_count = get_room_participant_count(room_id)
    
    if current_count >= 2:
        logger.warning(f"✗ Room {room_id} is full. Rejecting {username}.")
        socketio.emit('room-full', {
            'message': 'This consultation room is already full (max 2 participants)'
        }, room=sid)
        return
    
    # Join the Socket.IO room (for targeted messaging)
    join_room(room_id)
    
    # Update server state
    if room_id not in room_participants:
        room_participants[room_id] = []
    room_participants[room_id].append(sid)
    
    # Store user session info
    user_sessions[sid] = {
        'roomId': room_id,
        'username': username,
        'role': role,
        'micEnabled': True,   # Default state
        'videoEnabled': True  # Default state
    }
    
    # Get the other participant (if exists)
    other_sid = get_other_participant_in_room(room_id, sid)
    
    # Determine if this user is the first or second to join
    is_first = other_sid is None
    
    logger.info(f"✓ User '{username}' joined room {room_id}. Participants: {room_participants[room_id]}")
    
    # Send confirmation to the joining user
    socketio.emit('room-joined', {
        'roomId': room_id,
        'username': username,
        'role': role,
        'isFirst': is_first,
        'participantCount': current_count + 1
    }, room=sid)
    
    # If there's another participant, notify them
    if other_sid:
        socketio.emit('user-joined', {
            'username': username,
            'role': role,
            'sid': sid  # Send SID for WebRTC peer connection
        }, room=other_sid)
        
        # Send existing participant's state to the new joiner
        other_user = user_sessions.get(other_sid, {})
        socketio.emit('participant-state', {
            'username': other_user.get('username', 'Participant'),
            'micEnabled': other_user.get('micEnabled', True),
            'videoEnabled': other_user.get('videoEnabled', True)
        }, room=sid)
        
        logger.info(f"→ Notified {other_sid} about new participant {username}")


@socketio.on('leave-room')
def handle_leave_room(data=None):
    """
    Handle a user gracefully leaving a room.
    
    EXPECTED DATA (optional):
    { roomId: string }
    """
    sid = request.sid
    
    if sid not in user_sessions:
        return
    
    user_info = user_sessions[sid]
    room_id = data.get('roomId') if data else user_info['roomId']
    username = user_info.get('username', 'Anonymous')
    
    logger.info(f"→ User '{username}' leaving room {room_id}")
    
    # Notify other participant
    other_sid = get_other_participant_in_room(room_id, sid)
    if other_sid:
        socketio.emit('participant-left', {
            'leftUser': username,
            'reason': 'left-gracefully'
        }, room=other_sid)
    
    # Clean up state
    leave_room(room_id)
    
    if room_id in room_participants:
        room_participants[room_id].remove(sid)
        if not room_participants[room_id]:
            del room_participants[room_id]
    
    del user_sessions[sid]


# =============================================================================
# WEBRTC SIGNALING EVENT HANDLERS
# =============================================================================

@socketio.on('offer')
def handle_offer(data):
    """
    Relay WebRTC OFFER from one peer to another.
    
    FLOW:
    1. Doctor (usually) creates an offer after joining
    2. Server relays offer to Patient
    3. Patient creates answer in response
    
    EXPECTED DATA:
    {
        offer: RTCSessionDescriptionInit,  // SDP offer
        to: string                         // Target peer's SID (optional)
    }
    """
    sid = request.sid
    
    if sid not in user_sessions:
        logger.warning(f"✗ Offer received from user not in a room: {sid}")
        return
    
    room_id = user_sessions[sid]['roomId']
    other_sid = get_other_participant_in_room(room_id, sid)
    
    if not other_sid:
        logger.warning(f"✗ No other participant to send offer to in room {room_id}")
        return
    
    logger.info(f"→ Relaying OFFER from {sid} to {other_sid}")
    
    socketio.emit('offer', {
        'offer': data.get('offer'),
        'from': sid,
        'fromUsername': user_sessions[sid].get('username', 'Participant')
    }, room=other_sid)


@socketio.on('answer')
def handle_answer(data):
    """
    Relay WEBRTC ANSWER from one peer to another.
    
    FLOW:
    1. Patient receives offer and creates answer
    2. Server relays answer back to Doctor
    3. Doctor sets answer and connection is established
    
    EXPECTED DATA:
    {
        answer: RTCSessionDescriptionInit,  // SDP answer
        to: string                          // Target peer's SID (optional)
    }
    """
    sid = request.sid
    
    if sid not in user_sessions:
        return
    
    room_id = user_sessions[sid]['roomId']
    other_sid = get_other_participant_in_room(room_id, sid)
    
    if not other_sid:
        return
    
    logger.info(f"→ Relaying ANSWER from {sid} to {other_sid}")
    
    socketio.emit('answer', {
        'answer': data.get('answer'),
        'from': sid,
        'fromUsername': user_sessions[sid].get('username', 'Participant')
    }, room=other_sid)


@socketio.on('ice-candidate')
def handle_ice_candidate(data):
    """
    Relay ICE CANDIDATE between peers.
    
    WHAT ARE ICE CANDIDATES?
    - Network connection information (IP addresses, ports, protocols)
    - Multiple candidates are sent as they're discovered
    - Peers try each candidate until connection succeeds
    
    EXPECTED DATA:
    {
        candidate: RTCIceCandidateInit,  // ICE candidate info
        to: string                       // Target peer's SID (optional)
    }
    """
    sid = request.sid
    
    if sid not in user_sessions:
        return
    
    room_id = user_sessions[sid]['roomId']
    other_sid = get_other_participant_in_room(room_id, sid)
    
    if not other_sid:
        return
    
    # Forward ICE candidate to the other peer
    socketio.emit('ice-candidate', {
        'candidate': data.get('candidate'),
        'from': sid
    }, room=other_sid)


# =============================================================================
# MEDIA STATE BROADCASTING
# =============================================================================

@socketio.on('media-state-change')
def handle_media_state_change(data):
    """
    Broadcast media state changes (mic/video toggle) to other participant.
    
    CRITICAL FOR UI: Allows showing "User muted" or "Camera off" indicators.
    
    EXPECTED DATA:
    {
        micEnabled: boolean,    // true = unmuted, false = muted
        videoEnabled: boolean   // true = camera on, false = camera off
    }
    """
    sid = request.sid
    
    if sid not in user_sessions:
        return
    
    user_info = user_sessions[sid]
    room_id = user_info['roomId']
    
    # Update server state
    if 'micEnabled' in data:
        user_sessions[sid]['micEnabled'] = data['micEnabled']
    if 'videoEnabled' in data:
        user_sessions[sid]['videoEnabled'] = data['videoEnabled']
    
    # Broadcast to other participant
    other_sid = get_other_participant_in_room(room_id, sid)
    if other_sid:
        socketio.emit('media-state-changed', {
            'username': user_info.get('username', 'Participant'),
            'micEnabled': user_sessions[sid]['micEnabled'],
            'videoEnabled': user_sessions[sid]['videoEnabled']
        }, room=other_sid)
        
        logger.info(f"→ Broadcast media state from {sid}: mic={data.get('micEnabled')}, video={data.get('videoEnabled')}")


# =============================================================================
# HEALTH CHECK & DEBUG ENDPOINTS
# =============================================================================

@app.route('/health')
def health_check():
    """Health check endpoint for monitoring."""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'activeRooms': len(room_participants),
        'activeConnections': len(user_sessions)
    })


@app.route('/debug/rooms')
def debug_rooms():
    """Debug endpoint to see active rooms (development only)."""
    return jsonify({
        'rooms': room_participants,
        'sessions': {sid: {k: v for k, v in info.items() if k != 'sid'} 
                     for sid, info in user_sessions.items()}
    })


# =============================================================================
# RUN SERVER
# =============================================================================

if __name__ == '__main__':
    """
    Run the signaling server.

    DEVELOPMENT (HTTP - localhost only):
        python app.py

    DEVELOPMENT (HTTPS - for network testing):
        python app.py --ssl
        
    PRODUCTION (with gevent for better performance):
        pip install gevent gevent-websocket
        python app.py (with async_mode='gevent' above)
    """
    import sys
    import os
    
    use_ssl = '--ssl' in sys.argv
    
    print("""
    ╔═══════════════════════════════════════════════════════════╗
    ║     TELEMEDICINE WEBRTC SIGNALING SERVER                  ║
    ║                                                           ║
    """)
    
    if use_ssl:
        # Check if cert files exist, if not, provide instructions
        cert_path = os.path.join(os.path.dirname(__file__), 'cert.pem')
        key_path = os.path.join(os.path.dirname(__file__), 'key.pem')
        
        if not os.path.exists(cert_path) or not os.path.exists(key_path):
            print("    ⚠ SSL certificates not found!")
            print("    Run this command to generate them:")
            print("    openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes")
            print("    Or use the provided generate-cert.bat script (Windows)")
            print("""
    ╚═══════════════════════════════════════════════════════════╝
    """)
            sys.exit(1)
        
        print(f"    🔒 HTTPS Mode Enabled")
        print(f"    Server running on: https://localhost:5000")
        print(f"    Socket.IO endpoint: wss://localhost:5000")
        print(f"    Network access: https://<YOUR-IP>:5000")
        print(f"""
    ╚═══════════════════════════════════════════════════════════╝
    """)
        
        socketio.run(
            app,
            host='0.0.0.0',
            port=5000,
            debug=True,
            allow_unsafe_werkzeug=True,
            ssl_context=(cert_path, key_path)
        )
    else:
        print(f"    📡 HTTP Mode (localhost only for WebRTC)")
        print(f"    Server running on: http://localhost:5000")
        print(f"    Socket.IO endpoint: ws://localhost:5000")
        print(f"    ⚠ For network testing, run with: python app.py --ssl")
        print(f"""
    ╚═══════════════════════════════════════════════════════════╝
    """)
        
        socketio.run(
            app,
            host='0.0.0.0',
            port=5000,
            debug=True,
            allow_unsafe_werkzeug=True
        )
