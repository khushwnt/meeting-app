import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video as VideoIcon,
  VideoOff,
  PhoneOff,
  User,
  MonitorPlay,
  CheckCircle2,
  WifiOff,
  Loader2,
  AlertTriangle
} from 'lucide-react';
import { io } from 'socket.io-client';

/**
 * =============================================================================
 * TELEMEDICINE VIDEO CONSULTATION COMPONENT
 * =============================================================================
 *
 * This component handles:
 * 1. Socket.IO connection to the FastAPI signaling server
 * 2. WebRTC PeerConnection for peer-to-peer video/audio streaming
 * 3. Room management (join/leave)
 * 4. Media state broadcasting (mic/video toggle)
 *
 * WEBRTC HANDSHAKE FLOW:
 * ┌─────────────┐                          ┌─────────────┐
 * │   Doctor    │                          │   Patient   │
 * │   (Peer 1)  │                          │   (Peer 2)  │
 * └──────┬──────┘                          └──────┬──────┘
 *        │                                        │
 *        │  1. join-room(roomId)                  │
 *        │───────────────────────────────────────>│
 *        │                                        │
 *        │  2. room-joined (isFirst: false)       │
 *        │<───────────────────────────────────────│
 *        │                                        │
 *        │  3. Create OFFER                       │
 *        │     setLocalDescription(offer)         │
 *        │                                        │
 *        │  4. emit('offer', offer)               │
 *        │───────────────────────────────────────>│
 *        │                                        │
 *        │                                        │ 5. Receive OFFER
 *        │                                        │    setRemoteDescription(offer)
 *        │                                        │    Create ANSWER
 *        │                                        │    setLocalDescription(answer)
 *        │                                        │
 *        │  6. emit('answer', answer)             │
 *        │<───────────────────────────────────────│
 *        │                                        │
 *        │  7. Receive ANSWER                     │
 *        │     setRemoteDescription(answer)       │
 *        │                                        │
 *        │  8. ICE Candidates exchange (both ways)│
 *        │<══════════════════════════════════════>│
 *        │                                        │
 *        │  9. Connection established! 🎉         │
 *        │     Remote video stream available      │
 *        │                                        │
 * =============================================================================
 */

// Backend base URL (REST + Socket.IO live on the same server).
// Priority: VITE_SOCKET_URL env var (Vercel/Render deploys) → local dev fallback.
const getBackendUrl = () => {
  const envUrl = import.meta.env.VITE_SOCKET_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');

  const currentHost = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';

  // Local dev: frontend on :5173, backend on :5000
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    return 'http://localhost:5000';
  }

  // Same-host fallback (LAN testing): backend shares the frontend's host
  return `${protocol}://${currentHost}:5000`;
};

// Use auto-detected URL (recommended) or override with constant above
const ACTIVE_SOCKET_URL = getBackendUrl();

const VideoConsultation = () => {
  // =============================================================================
  // STATE MANAGEMENT
  // =============================================================================

  // Call states
  const [inCall, setInCall] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [hasRemoteParticipant, setHasRemoteParticipant] = useState(false);

  // Media states
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [stream, setStream] = useState(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaInitialized, setMediaInitialized] = useState(false);

  // Remote participant states
  const [remoteParticipant, setRemoteParticipant] = useState(null);
  const [remoteMicEnabled, setRemoteMicEnabled] = useState(true);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(true);

  // Error states
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [notice, setNotice] = useState('');

  // Room selection (lobby)
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || 'DEMO-ROOM-123';
  });
  const [availableRooms, setAvailableRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  // =============================================================================
  // REFS (Mutable values that don't trigger re-renders)
  // =============================================================================
  
  // Video element refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  
  // Socket.IO ref - persists across renders
  const socketRef = useRef(null);
  
  // WebRTC PeerConnection ref
  const peerConnectionRef = useRef(null);
  
  // Track if we've already created a peer connection for this session
  const peerConnectionInitialized = useRef(false);

  // =============================================================================
  // CONFIGURATION
  // =============================================================================

  // Fetch the list of active rooms for the lobby picker.
  const fetchRooms = async () => {
    setRoomsLoading(true);
    try {
      const res = await fetch(`${ACTIVE_SOCKET_URL}/api/rooms`);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      setAvailableRooms(Array.isArray(data.rooms) ? data.rooms : []);
    } catch {
      setAvailableRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  };

  // Refresh the room list while waiting in the lobby.
  useEffect(() => {
    if (inCall) return;
    fetchRooms();
    const timer = setInterval(fetchRooms, 5000);
    return () => clearInterval(timer);
  }, [inCall]);

  // Mock user info (in real app, get from auth context)
  const userInfo = {
    username: 'Dr. Smith',
    role: 'doctor'
    // In production: Get from your auth system
  };

  // WebRTC Configuration (STUN servers help discover public IP)
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
      // For production, add TURN servers for NAT traversal:
      // { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' }
    ]
  };

  // =============================================================================
  // MEDIA INITIALIZATION (User-Gesture Based)
  // =============================================================================

  /**
   * Initialize media devices - CALLED ON USER GESTURE
   * This is critical for mobile browsers which block auto-playing media
   * and require user interaction before granting camera/mic access.
   * 
   * Also handles secure context requirements (HTTPS).
   */
  const initializeMedia = async () => {
    if (mediaInitialized) {
      return { success: true };
    }

    setMediaLoading(true);
    setMediaError('');

    try {
      // Check for secure context (HTTPS)
      if (!window.isSecureContext) {
        // Continue anyway - some browsers allow localhost
      }

      // Check if navigator.mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Your browser does not support camera/microphone access. Please use a modern browser (Chrome, Firefox, Edge, Safari).');
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setStream(mediaStream);
      setMediaInitialized(true);
      setMediaLoading(false);
      return { success: true };

    } catch (err) {
      setMediaLoading(false);

      // Handle specific error types
      let errorMessage = '';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = 'Camera/microphone permission denied. Please allow access in your browser settings and refresh the page.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = 'No camera or microphone found. Please connect a camera and try again.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMessage = 'Camera or microphone is already in use by another application. Please close other apps and try again.';
      } else if (err.name === 'OverconstrainedError') {
        errorMessage = 'Camera resolution not supported. Please try a different device.';
      } else if (err.name === 'TypeError' && !window.isSecureContext) {
        // This is the key error for HTTP vs HTTPS
        errorMessage = 'Camera access requires a secure HTTPS connection. Please check your URL.';
      } else {
        errorMessage = `Could not access camera or microphone: ${err.message}. Please check permissions and ensure you are using HTTPS.`;
      }

      setMediaError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  /**
   * Cleanup media stream on component unmount
   */
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      // Close peer connection
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      // Disconnect socket
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [stream]);

  /**
   * Attach local stream to video element whenever it changes
   */
  useEffect(() => {
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = stream;
    }
  }, [inCall, stream, videoEnabled]);

  // =============================================================================
  // SOCKET.IO CONNECTION
  // =============================================================================

  /**
   * Initialize Socket.IO connection
   * This connects to the FastAPI signaling server
   */
  const connectToSignalingServer = () => {
    return new Promise((resolve, reject) => {
      try {
        
        // Create Socket.IO connection
        const socket = io(ACTIVE_SOCKET_URL, {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          timeout: 10000
        });

        socketRef.current = socket;

        // ─────────────────────────────────────────────────────────────────────
        // SOCKET EVENT LISTENERS
        // ─────────────────────────────────────────────────────────────────────

        // Connection established
        socket.on('connect', () => {
          setIsConnected(true);
          setConnectionError('');
          resolve(socket);
        });

        // Connection error
        socket.on('connect_error', (err) => {
          let errorMsg = 'Could not connect to the consultation server. ';

          if (err && err.message && err.message.includes('certificate')) {
            errorMsg += 'There is a problem with the secure connection. Please reload and try again.';
          } else {
            errorMsg += 'Please check your internet connection and try again.';
          }

          setConnectionError(errorMsg);
          setIsConnected(false);
          reject(err);
        });

        // Successfully joined room
        socket.on('room-joined', () => {
          setIsConnecting(false);
        });

        // Another user joined the room
        socket.on('user-joined', (data) => {
          setHasRemoteParticipant(true);
          setRemoteParticipant({
            username: data.username,
            role: data.role,
            sid: data.sid
          });
          
          // If we're already in the call, initiate WebRTC handshake
          if (inCall && peerConnectionRef.current) {
            createOffer();
          }
        });

        // Received WebRTC OFFER from peer
        socket.on('offer', async (data) => {
          await handleOffer(data.offer);
        });

        // Received WebRTC ANSWER from peer
        socket.on('answer', async (data) => {
          await handleAnswer(data.answer);
        });

        // Received ICE candidate from peer
        socket.on('ice-candidate', async (data) => {
          await handleIceCandidate(data.candidate);
        });

        // Participant's media state changed (mic/video toggle)
        socket.on('media-state-changed', (data) => {
          setRemoteMicEnabled(data.micEnabled);
          setRemoteVideoEnabled(data.videoEnabled);
        });

        // Received initial state of existing participant
        socket.on('participant-state', (data) => {
          setRemoteParticipant(prev => ({
            ...prev,
            username: data.username
          }));
          setRemoteMicEnabled(data.micEnabled);
          setRemoteVideoEnabled(data.videoEnabled);
        });

        // Participant left the room
        socket.on('participant-left', (data) => {
          setHasRemoteParticipant(false);
          setRemoteParticipant(null);
          
          // Reset remote video
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
          }
          
          // Reset peer connection
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
            peerConnectionInitialized.current = false;
          }
          
          setNotice(`${data.leftUser} has ${data.reason === 'disconnected' ? 'disconnected' : 'left'} the consultation.`);
        });

        // Room is full (max 2 participants)
        socket.on('room-full', (data) => {
          setError(data.message);
          setIsConnecting(false);
        });

        // Generic error from server
        socket.on('error', (data) => {
          setError(data.message);
        });

        // Disconnection handler
        socket.on('disconnect', () => {
          setIsConnected(false);
        });

        // Connection timeout
        socket.on('connect_timeout', () => {
          setConnectionError('Connection timed out. Please check your network.');
          setIsConnecting(false);
        });

      } catch (err) {
        reject(err);
      }
    });
  };

  // =============================================================================
  // WEBRTC PEER CONNECTION
  // =============================================================================

  /**
   * Create and initialize the RTCPeerConnection
   * This is the core WebRTC object that handles peer-to-peer communication
   */
  const createPeerConnection = () => {
    // Don't create multiple peer connections
    if (peerConnectionInitialized.current) {
      return peerConnectionRef.current;
    }


    // Create new PeerConnection with ICE server config
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;
    peerConnectionInitialized.current = true;

    // ─────────────────────────────────────────────────────────────────────
    // PEER CONNECTION EVENT HANDLERS
    // ─────────────────────────────────────────────────────────────────────

    /**
     * ICE Connection State Change
     * Tracks the connection status (connecting, connected, disconnected, failed)
     */
    pc.oniceconnectionstatechange = () => {
      
      switch (pc.iceConnectionState) {
        case 'connected':
          break;
        case 'disconnected':
        case 'failed':
          setConnectionError('Connection lost. Please rejoin.');
          break;
        case 'closed':
          break;
        default:
          break;
      }
    };

    /**
     * ICE Candidate Handler
     * When we discover a new network path, send it to the remote peer
     * 
     * ICE CANDIDATES ARE:
     * - Host candidates: Local IP addresses
     * - Server-reflexive: Public IP (discovered via STUN)
     * - Relay: Through TURN server (for restrictive NATs)
     */
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit('ice-candidate', {
          candidate: event.candidate
        });
      }
    };

    /**
     * Track Event Handler
     * Called when the remote peer adds a media track (video/audio)
     * This is how we receive the remote video stream!
     */
    pc.ontrack = (event) => {
      
      const remoteStream = event.streams[0];
      
      // Attach remote stream to video element
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      
      setHasRemoteParticipant(true);
    };

    /**
     * Connection State Change (Modern API)
     * More detailed connection state tracking
     */
    pc.onconnectionstatechange = () => {
    };

    /**
     * Negotiation Needed
     * Triggered when the connection needs to be renegotiated
     * (e.g., adding/removing tracks)
     */
    pc.onnegotiationneeded = async () => {
      // In simple cases, we handle this manually via createOffer
    };

    // Add local media tracks to the peer connection
    if (stream) {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
    }

    return pc;
  };

  /**
   * Create and send WebRTC OFFER
   * Called by the first participant (usually the doctor)
   */
  const createOffer = async () => {
    try {
      const pc = createPeerConnection();
      if (!pc) return;


      // Create SDP offer (Session Description Protocol)
      const offer = await pc.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true
      });

      // Set local description (our offer)
      await pc.setLocalDescription(offer);

      // Send offer to remote peer via signaling server
      socketRef.current?.emit('offer', {
        offer: pc.localDescription
      });

    } catch {
      setError('Failed to initialize video call. Please try again.');
    }
  };

  /**
   * Handle incoming WebRTC OFFER
   * Called when we receive an offer from the remote peer
   */
  const handleOffer = async (offer) => {
    try {
      const pc = createPeerConnection();
      if (!pc) return;


      // Set the remote description (their offer)
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Create SDP answer
      const answer = await pc.createAnswer();

      // Set local description (our answer)
      await pc.setLocalDescription(answer);

      // Send answer back to remote peer
      socketRef.current?.emit('answer', {
        answer: pc.localDescription
      });

    } catch {
      setError('Failed to accept video call. Please try again.');
    }
  };

  /**
   * Handle incoming WebRTC ANSWER
   * Called when we receive an answer from the remote peer
   */
  const handleAnswer = async (answer) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc) {
        return;
      }


      // Set the remote description (their answer)
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

    } catch {
      setError('Failed to complete video call setup.');
    }
  };

  /**
   * Handle incoming ICE candidate
   * Called when we receive network info from the remote peer
   */
  const handleIceCandidate = async (candidate) => {
    const pc = peerConnectionRef.current;
    if (!pc || !candidate) return;

    // Add the remote ICE candidate to our peer connection.
    // Failures here are routine (e.g. duplicate candidates) and safe to ignore.
    await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  };

  // =============================================================================
  // USER ACTIONS
  // =============================================================================

  /**
   * Join the consultation room
   * This connects to the signaling server and joins the specified room
   * 
   * IMPORTANT: Media is initialized FIRST (on user gesture) before joining.
   * This satisfies mobile browser user-gesture requirements.
   */
  const joinCall = async () => {
    try {
      setError('');
      setConnectionError('');
      setNotice('');

      const targetRoom = (roomId || '').trim() || 'DEMO-ROOM-123';
      setRoomId(targetRoom);

      // Step 0: Initialize media FIRST (user gesture already happened via button click)
      const mediaResult = await initializeMedia();
      
      if (!mediaResult.success) {
        // Media initialization failed - show error but let user decide to continue
      }

      setIsConnecting(true);

      // Step 1: Connect to signaling server
      const socket = await connectToSignalingServer();

      // Step 2: Join the room
      socket.emit('join-room', {
        roomId: targetRoom,
        username: userInfo.username,
        role: userInfo.role
      });

      // Step 3: Update UI state
      setInCall(true);

      // Step 4: Initialize peer connection (ready for handshake)
      // The actual offer/answer exchange happens when another user joins
      createPeerConnection();


    } catch {
      setError('Failed to connect to the consultation room.');
      setIsConnecting(false);
    }
  };

  /**
   * Leave the consultation room
   */
  const leaveCall = () => {

    // Notify server
    socketRef.current?.emit('leave-room', { roomId });

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
      peerConnectionInitialized.current = false;
    }

    // Reset states
    setInCall(false);
    setNotice('');
    setHasRemoteParticipant(false);
    setRemoteParticipant(null);
    setRemoteMicEnabled(true);
    setRemoteVideoEnabled(true);
    
    // Clear remote video
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

  };

  /**
   * Toggle microphone on/off
   */
  const toggleMic = () => {
    if (stream) {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        const newState = audioTrack.enabled;
        setMicEnabled(newState);
        
        // Broadcast state change to remote peer
        socketRef.current?.emit('media-state-change', {
          micEnabled: newState
        });
        
      }
    }
  };

  /**
   * Toggle camera on/off
   */
  const toggleVideo = () => {
    if (stream) {
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        const newState = videoTrack.enabled;
        setVideoEnabled(newState);
        
        // Broadcast state change to remote peer
        socketRef.current?.emit('media-state-change', {
          videoEnabled: newState
        });
        
      }
    }
  };

  // =============================================================================
  // UI: LOBBY / WAITING ROOM
  // =============================================================================
  if (!inCall) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <div className="max-w-4xl w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row">

          {/* Left Side - Video Preview */}
          <div className="w-full md:w-3/5 bg-slate-900 relative aspect-video md:aspect-auto flex items-center justify-center">
            {stream && videoEnabled ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
            ) : (
              <div className="flex flex-col items-center text-slate-400">
                {mediaError ? (
                  <>
                    <AlertTriangle size={48} className="mb-4 text-yellow-500" />
                    <p className="text-center px-4 text-sm">{mediaError}</p>
                  </>
                ) : mediaLoading ? (
                  <>
                    <Loader2 className="animate-spin" size={48} className="mb-4" />
                    <p>Requesting camera access...</p>
                  </>
                ) : (
                  <>
                    <VideoOff size={48} className="mb-4" />
                    <p>Camera is off</p>
                  </>
                )}
              </div>
            )}

            {/* Preview Controls */}
            {stream && (
              <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex gap-4 bg-slate-900/50 p-2 rounded-full backdrop-blur-sm">
                <button
                  onClick={toggleMic}
                  className={`p-3 rounded-full transition ${
                    micEnabled
                      ? 'bg-slate-700 text-white hover:bg-slate-600'
                      : 'bg-red-500 text-white hover:bg-red-600'
                  }`}
                >
                  {micEnabled ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-3 rounded-full transition ${
                    videoEnabled
                      ? 'bg-slate-700 text-white hover:bg-slate-600'
                      : 'bg-red-500 text-white hover:bg-red-600'
                  }`}
                >
                  {videoEnabled ? <VideoIcon size={20} /> : <VideoOff size={20} />}
                </button>
              </div>
            )}
          </div>

          {/* Right Side - Join Info */}
          <div className="w-full md:w-2/5 p-8 flex flex-col justify-center">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Ready to join?</h2>
              <p className="text-slate-500 text-sm mb-3">
                Enter a room name to start a new consultation, or pick an active room below.
              </p>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1">
                Room name
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="e.g. CONSULT-123"
                maxLength={64}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Active Rooms */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Active rooms
                </p>
                <button
                  onClick={fetchRooms}
                  disabled={roomsLoading}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:text-slate-400"
                >
                  {roomsLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {availableRooms.length === 0 ? (
                <p className="text-sm text-slate-400">
                  {roomsLoading ? 'Looking for active rooms…' : 'No active rooms right now. Enter a name above to start one.'}
                </p>
              ) : (
                <ul className="space-y-2 max-h-40 overflow-y-auto">
                  {availableRooms.map((room) => {
                    const isFull = room.participants >= room.maxParticipants;
                    const isSelected = room.roomId === roomId;
                    return (
                      <li key={room.roomId}>
                        <button
                          onClick={() => setRoomId(room.roomId)}
                          disabled={isFull}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 text-blue-800'
                              : isFull
                                ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-blue-400 hover:bg-blue-50/50'
                          }`}
                        >
                          <span className="font-mono truncate">{room.roomId}</span>
                          <span className="text-xs ml-2 flex-shrink-0">
                            {isFull ? 'Full' : `${room.participants}/${room.maxParticipants}`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Media Error Display */}
            {mediaError && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-lg mb-6 text-sm">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold mb-1">Camera/Microphone Issue</p>
                    <p>{mediaError}</p>
                  </div>
                </div>
              </div>
            )}

            {error && !mediaError ? (
              <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6 text-sm">
                {error}
              </div>
            ) : null}

            {/* Status Indicators */}
            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-3 text-slate-600">
                <CheckCircle2 size={18} className="text-green-500" />
                <span>Network stable</span>
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <CheckCircle2
                  size={18}
                  className={micEnabled && stream ? "text-green-500" : mediaInitialized ? "text-yellow-500" : "text-slate-300"}
                />
                <span>Microphone {stream ? (micEnabled ? 'detected' : 'muted') : 'not initialized'}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <CheckCircle2
                  size={18}
                  className={videoEnabled && stream ? "text-green-500" : mediaInitialized ? "text-yellow-500" : "text-slate-300"}
                />
                <span>Camera {stream ? (videoEnabled ? 'detected' : 'off') : 'not initialized'}</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              {/* Test Camera Button - Only show if media not initialized */}
              {!mediaInitialized && (
                <button
                  onClick={initializeMedia}
                  disabled={mediaLoading}
                  className="w-full py-3 px-4 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-100 text-slate-700 font-semibold rounded-lg shadow-sm transition-colors flex justify-center items-center gap-2 border border-slate-300"
                >
                  {mediaLoading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Requesting Access...
                    </>
                  ) : (
                    <>
                      <MonitorPlay size={20} />
                      Test Camera
                    </>
                  )}
                </button>
              )}

              {/* Join Consultation Button */}
              <button
                onClick={joinCall}
                disabled={isConnecting}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold rounded-lg shadow-sm transition-colors flex justify-center items-center gap-2"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="animate-spin" size={20} />
                    Connecting...
                  </>
                ) : (
                  'Join Consultation'
                )}
              </button>
            </div>

            {connectionError && (
              <p className="mt-4 text-sm text-red-600 text-center">
                {connectionError}
              </p>
            )}

            {/* Secure Context Warning */}
            {!window.isSecureContext && (
              <p className="mt-4 text-xs text-amber-600 text-center bg-amber-50 p-2 rounded">
                Camera access needs a secure (HTTPS) connection.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =============================================================================
  // UI: ACTIVE CALL ROOM
  // =============================================================================
  return (
    <div className="h-screen w-full bg-slate-950 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 bg-slate-900 border-b border-slate-800 text-white">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
          <span className="font-medium text-slate-200">
            {isConnected ? 'Live Consultation' : 'Connecting...'}
          </span>
        </div>
        <div className="bg-slate-800 px-3 py-1 rounded-md text-sm font-mono text-slate-300">
          ID: {roomId}
        </div>
      </header>

      {/* Main Video Area */}
      <main className="flex-1 relative p-4 flex items-center justify-center">
        {/* Remote Video (Doctor/Patient) */}
        <div className="w-full h-full max-w-6xl max-h-full bg-slate-800 rounded-2xl overflow-hidden relative shadow-2xl border border-slate-700">

          {/* Notice Banner (e.g. participant left) */}
          {notice && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 bg-slate-900/90 backdrop-blur-sm px-4 py-2 rounded-lg text-white text-sm flex items-center gap-3">
              <span>{notice}</span>
              <button
                onClick={() => setNotice('')}
                className="text-slate-400 hover:text-white font-bold"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {/* Remote Video Element */}
          {hasRemoteParticipant && remoteVideoEnabled ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {hasRemoteParticipant ? (
                <>
                  <VideoOff size={80} className="text-slate-600 mb-4" />
                  <p className="text-slate-400 text-lg">
                    {remoteParticipant?.username || 'Participant'}'s camera is off
                  </p>
                </>
              ) : (
                <>
                  <User size={80} className="text-slate-600 mb-4" />
                  <p className="text-slate-400 text-lg">
                    Waiting for {remoteParticipant ? 'connection...' : 'other participant to join...'}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Remote Participant Status Overlay */}
          {hasRemoteParticipant && (
            <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-sm px-4 py-2 rounded-lg text-white flex items-center gap-3">
              <User size={20} className="text-blue-400" />
              <span className="font-medium">
                {remoteParticipant?.username || 'Participant'}
              </span>
              <div className="flex gap-2">
                {!remoteMicEnabled && (
                  <div className="bg-red-500 p-1.5 rounded" title="Microphone muted">
                    <MicOff size={16} />
                  </div>
                )}
                {!remoteVideoEnabled && (
                  <div className="bg-red-500 p-1.5 rounded" title="Camera off">
                    <VideoOff size={16} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Connection Status */}
          {!isConnected && (
            <div className="absolute top-4 right-4 bg-yellow-500/90 backdrop-blur-sm px-4 py-2 rounded-lg text-white flex items-center gap-2">
              <WifiOff size={18} />
              <span>Reconnecting...</span>
            </div>
          )}

          {/* Local Video (Picture-in-Picture) */}
          <div className="absolute bottom-6 right-6 w-48 aspect-video bg-slate-900 rounded-lg overflow-hidden shadow-lg border-2 border-slate-700 z-10 transition-all hover:scale-105">
            {videoEnabled ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-slate-800">
                <User size={32} className="text-slate-500" />
              </div>
            )}
            <div className="absolute bottom-2 right-2 flex gap-1">
              {!micEnabled && (
                <div className="bg-red-500 text-white p-1 rounded-md">
                  <MicOff size={12} />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Control Bar */}
      <footer className="h-24 bg-slate-900 flex items-center justify-center gap-4 px-6 pb-4 pt-2">
        <button
          onClick={toggleMic}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
            micEnabled
              ? 'bg-slate-700 text-white hover:bg-slate-600'
              : 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]'
          }`}
          title={micEnabled ? "Mute Microphone" : "Unmute Microphone"}
        >
          {micEnabled ? <Mic size={24} /> : <MicOff size={24} />}
        </button>

        <button
          onClick={toggleVideo}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
            videoEnabled
              ? 'bg-slate-700 text-white hover:bg-slate-600'
              : 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]'
          }`}
          title={videoEnabled ? "Turn Off Camera" : "Turn On Camera"}
        >
          {videoEnabled ? <VideoIcon size={24} /> : <VideoOff size={24} />}
        </button>

        <button
          onClick={leaveCall}
          className="w-16 h-16 rounded-full flex items-center justify-center bg-red-600 text-white hover:bg-red-700 transition-all shadow-lg hover:shadow-red-900/50"
          title="Leave Call"
        >
          <PhoneOff size={28} />
        </button>
      </footer>
    </div>
  );
};

export default VideoConsultation;
