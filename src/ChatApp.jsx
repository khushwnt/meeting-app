import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  Send,
  Users,
  MessageCircle,
  RefreshCw,
  LogOut
} from 'lucide-react';
import { io } from 'socket.io-client';
import VoiceRecorder from './VoiceRecorder';
import VoiceNote from './VoiceNote';

/**
 * Meeting-room chat: no auth, just pick a display name and join a room.
 * Text messages + WhatsApp-style voice notes, live typing indicators,
 * online user list, and recent history for late joiners.
 */

// Backend base URL: VITE_SOCKET_URL (Vercel/Render) → local dev fallback.
const getBackendUrl = () => {
  const envUrl = import.meta.env.VITE_SOCKET_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const currentHost = window.location.hostname;
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  if (currentHost === 'localhost' || currentHost === '127.0.0.1') {
    return 'http://localhost:5000';
  }
  return `${protocol}://${currentHost}:5000`;
};
const BACKEND_URL = getBackendUrl();

const newId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const base64ToObjectUrl = (base64, mimeType) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mimeType || 'audio/webm' }));
};

const withAudioUrl = (msg) => {
  if (msg.type === 'voice' && msg.audio && !msg.audioUrl) {
    try {
      return { ...msg, audioUrl: base64ToObjectUrl(msg.audio, msg.mimeType) };
    } catch {
      return msg;
    }
  }
  return msg;
};

const formatClock = (timestamp) => {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const ChatApp = () => {
  // Lobby state
  const [username, setUsername] = useState(() => localStorage.getItem('chat-username') || '');
  const [roomId, setRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('room') || '';
  });
  const [availableRooms, setAvailableRooms] = useState([]);
  const [roomsLoading, setRoomsLoading] = useState(false);

  // Auth state (Google OAuth; guest name fallback when server allows it)
  const [authRequired, setAuthRequired] = useState(null); // null = loading
  const [googleClientId, setGoogleClientId] = useState('');
  const [authUser, setAuthUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('chat-user') || 'null');
    } catch {
      return null;
    }
  });
  const googleButtonRef = useRef(null);

  // Room state
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [text, setText] = useState('');
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);

  // Errors / notices
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const socketRef = useRef(null);
  const typingTimeouts = useRef({});
  const typingEmitState = useRef(false);
  const typingEmitTimer = useRef(null);
  const messagesEndRef = useRef(null);
  const joinedRef = useRef(false);

  // ------------------------------------------------------------------
  // Lobby: active room list
  // ------------------------------------------------------------------
  const fetchRooms = async () => {
    setRoomsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/rooms`);
      if (!res.ok) throw new Error('bad status');
      const data = await res.json();
      setAvailableRooms(Array.isArray(data.rooms) ? data.rooms : []);
    } catch {
      setAvailableRooms([]);
    } finally {
      setRoomsLoading(false);
    }
  };

  useEffect(() => {
    if (joined) return;
    fetchRooms();
    const timer = setInterval(fetchRooms, 5000);
    return () => clearInterval(timer);
  }, [joined]);

  // Ask the backend whether Google sign-in is required (+ client id).
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/config`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setAuthRequired(Boolean(data.authRequired));
        setGoogleClientId(data.googleClientId || '');
      })
      .catch(() => {
        // Backend unreachable — leave auth undecided; join will surface the error.
      });
  }, [joined]);

  // Render the Google sign-in button once GIS + client id are ready.
  useEffect(() => {
    if (joined || !authRequired || !googleClientId) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (window.google?.accounts?.id) {
        clearInterval(timer);
        try {
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: handleGoogleCredential
          });
          if (googleButtonRef.current) {
            googleButtonRef.current.innerHTML = '';
            window.google.accounts.id.renderButton(googleButtonRef.current, {
              theme: 'filled_blue',
              size: 'large',
              width: 280
            });
          }
        } catch {
          /* GIS unavailable */
        }
      } else if (attempts > 40) {
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [joined, authRequired, googleClientId, authUser]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  // Disconnect socket on unmount
  useEffect(() => {
    const pendingTyping = typingTimeouts.current;
    return () => {
      if (socketRef.current) {
        try {
          socketRef.current.emit('leave-room', {});
        } catch {
          /* ignore */
        }
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      Object.values(pendingTyping).forEach(clearTimeout);
      if (typingEmitTimer.current) clearTimeout(typingEmitTimer.current);
    };
  }, []);

  const addMessage = (msg) => {
    const full = withAudioUrl(msg);
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === full.id);
      if (idx === -1) return [...prev, full];
      // Server echo of our own optimistic message: replace it so the
      // `pending` flag clears and the server timestamp/stamp applies.
      const next = [...prev];
      const oldUrl = next[idx].audioUrl;
      next[idx] = { ...full, audioUrl: next[idx].audioUrl || full.audioUrl };
      if (oldUrl && oldUrl !== next[idx].audioUrl && oldUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(oldUrl);
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  const flagTyping = (name) => {
    setTypingUsers((prev) => (prev.includes(name) ? prev : [...prev, name]));
    if (typingTimeouts.current[name]) clearTimeout(typingTimeouts.current[name]);
    typingTimeouts.current[name] = setTimeout(() => {
      setTypingUsers((prev) => prev.filter((u) => u !== name));
    }, 4000);
  };

  // ------------------------------------------------------------------
  // Google sign-in
  // ------------------------------------------------------------------
  const handleGoogleCredential = async (response) => {
    setError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: response.credential })
      });
      if (!res.ok) throw new Error('verification failed');
      const data = await res.json();
      localStorage.setItem('chat-token', data.token);
      localStorage.setItem('chat-user', JSON.stringify(data.user));
      setAuthUser(data.user);
    } catch {
      setError('Google sign-in failed. Try again.');
    }
  };

  const signOut = () => {
    leave();
    localStorage.removeItem('chat-token');
    localStorage.removeItem('chat-user');
    setAuthUser(null);
  };

  // ------------------------------------------------------------------
  // Join / leave
  // ------------------------------------------------------------------
  const join = (e) => {
    if (e) e.preventDefault();
    if (authRequired && !authUser) {
      setError('Please sign in with Google first.');
      return;
    }
    const name = authUser?.name || (username || '').trim().slice(0, 32) || 'Anonymous';
    const targetRoom = (roomId || '').trim() || 'lounge';
    setUsername(name);
    localStorage.setItem('chat-username', name);
    setRoomId(targetRoom);
    setError('');
    setNotice('');
    setJoining(true);

    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
      auth: authUser ? { token: localStorage.getItem('chat-token') || '' } : undefined
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId: targetRoom, username: name });
    });

    socket.on('connect_error', (err) => {
      const msg = String(err?.message || '');
      if (msg.includes('rejected') || msg.includes('unauthorized')) {
        // Session token expired/revoked — force re-sign-in.
        localStorage.removeItem('chat-token');
        localStorage.removeItem('chat-user');
        setAuthUser(null);
        setError('Your session expired. Please sign in again.');
      } else {
        setError('Could not connect to the chat server. Check your connection and try again.');
      }
      setJoining(false);
    });

    socket.on('room-joined', () => {
      setJoining(false);
      setJoined(true);
      joinedRef.current = true;
      setMessages([]);
      setUsers([]);
      setTypingUsers([]);
    });

    socket.on('user-joined', (data) => {
      setNotice(`${data.username} joined the room.`);
    });

    socket.on('participant-left', (data) => {
      setNotice(`${data.leftUser} left the room.`);
    });

    socket.on('room-users', (data) => {
      setUsers(Array.isArray(data.users) ? data.users : []);
    });

    socket.on('chat-history', (data) => {
      const history = Array.isArray(data.messages) ? data.messages : [];
      setMessages(history.map(withAudioUrl));
    });

    socket.on('chat-message', (data) => addMessage(data));
    socket.on('voice-message', (data) => addMessage(data));

    socket.on('typing', (data) => {
      if (data && data.isTyping && data.username) flagTyping(data.username);
    });

    socket.on('room-full', (data) => {
      setError(data.message || 'This room is full. Try another one.');
      setJoining(false);
      socket.disconnect();
      socketRef.current = null;
    });

    socket.on('error', (data) => {
      if (data && data.message) setError(data.message);
    });

    socket.on('disconnect', () => {
      if (joinedRef.current) setNotice('Disconnected. Trying to reconnect…');
    });
  };

  const leave = () => {
    try {
      socketRef.current?.emit('leave-room', {});
    } catch {
      /* ignore */
    }
    socketRef.current?.disconnect();
    socketRef.current = null;
    joinedRef.current = false;
    typingEmitState.current = false;
    if (typingEmitTimer.current) clearTimeout(typingEmitTimer.current);
    setJoined(false);
    setMessages([]);
    setUsers([]);
    setTypingUsers([]);
    setText('');
    setRecording(false);
    setNotice('');
    fetchRooms();
  };

  // ------------------------------------------------------------------
  // Sending
  // ------------------------------------------------------------------
  const sendText = (e) => {
    if (e) e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !socketRef.current) return;
    const msg = {
      id: newId(),
      roomId,
      sender: (username || 'Anonymous'),
      type: 'text',
      text: trimmed.slice(0, 2000),
      timestamp: Date.now(),
      pending: true
    };
    addMessage(msg); // optimistic
    socketRef.current.emit('chat-message', { id: msg.id, text: msg.text });
    setText('');
    emitTyping(false);
  };

  const sendVoice = async ({ blob, duration, mimeType }) => {
    setRecording(false);
    if (!socketRef.current || !blob || blob.size === 0) return;
    setSending(true);
    try {
      const audio = await blobToBase64(blob);
      const msg = {
        id: newId(),
        roomId,
        sender: (username || 'Anonymous'),
        type: 'voice',
        audio,
        audioUrl: URL.createObjectURL(blob),
        mimeType,
        duration: Math.round(duration * 10) / 10,
        timestamp: Date.now(),
        pending: true
      };
      addMessage(msg); // optimistic
      socketRef.current.emit('voice-message', {
        id: msg.id,
        audio,
        mimeType,
        duration: msg.duration
      });
    } catch {
      setError('Could not send the voice note. Try again.');
    } finally {
      setSending(false);
    }
  };

  const emitTyping = (isTyping) => {
    if (!socketRef.current) return;
    if (isTyping === typingEmitState.current && isTyping) return; // already signalled
    typingEmitState.current = isTyping;
    socketRef.current.emit('typing', { isTyping });
    if (typingEmitTimer.current) clearTimeout(typingEmitTimer.current);
    if (isTyping) {
      typingEmitTimer.current = setTimeout(() => {
        typingEmitState.current = false;
        socketRef.current?.emit('typing', { isTyping: false });
      }, 3000);
    }
  };

  const handleTextChange = (e) => {
    setText(e.target.value);
    emitTyping(e.target.value.trim().length > 0);
  };

  // ------------------------------------------------------------------
  // LOBBY
  // ------------------------------------------------------------------
  if (!joined) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-[#111b21] rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-[#075e54] px-6 py-5 text-white">
            <div className="flex items-center gap-2">
              <MessageCircle size={24} />
              <h1 className="text-xl font-bold">Meeting Rooms</h1>
            </div>
            <p className="text-sm text-emerald-100/80 mt-1">
              No sign-up. Pick a name, join a room, chat.
            </p>
          </div>

          <form onSubmit={join} className="p-6 space-y-4">
            {authRequired ? (
              authUser ? (
                <div className="flex items-center gap-3 bg-[#202c33] border border-[#2a3942] rounded-lg px-3 py-2">
                  {authUser.picture && (
                    <img
                      src={authUser.picture}
                      alt={authUser.name}
                      className="w-9 h-9 rounded-full"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate">{authUser.name}</p>
                    <p className="text-xs text-slate-400 truncate">{authUser.email}</p>
                  </div>
                  <button
                    type="button"
                    onClick={signOut}
                    className="text-xs text-slate-400 hover:text-slate-200 flex-shrink-0"
                  >
                    Switch
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">
                    Sign in to join
                  </p>
                  <div ref={googleButtonRef} className="flex justify-center min-h-[44px]" />
                </div>
              )
            ) : authRequired === false ? (
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  Your name
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. Alex"
                  maxLength={32}
                  className="w-full px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center">Loading…</p>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Room name
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="e.g. lounge (new names create rooms)"
                maxLength={64}
                className="w-full px-3 py-2 bg-[#202c33] border border-[#2a3942] rounded-lg font-mono text-sm text-slate-100 placeholder:text-slate-500 placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                  Active rooms
                </p>
                <button
                  type="button"
                  onClick={fetchRooms}
                  disabled={roomsLoading}
                  className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-slate-500 flex items-center gap-1"
                >
                  <RefreshCw size={12} className={roomsLoading ? 'animate-spin' : ''} />
                  {roomsLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {availableRooms.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {roomsLoading ? 'Looking for active rooms…' : 'No active rooms. Type a name above to start one.'}
                </p>
              ) : (
                <ul className="space-y-2 max-h-44 overflow-y-auto">
                  {availableRooms.map((room) => {
                    const isFull = room.participants >= room.maxParticipants;
                    const isSelected = room.roomId === roomId.trim();
                    return (
                      <li key={room.roomId}>
                        <button
                          type="button"
                          onClick={() => setRoomId(room.roomId)}
                          disabled={isFull}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                              : isFull
                                ? 'border-[#2a3942] bg-[#202c33] text-slate-600 cursor-not-allowed'
                                : 'border-[#2a3942] bg-[#202c33] text-slate-200 hover:border-emerald-600'
                          }`}
                        >
                          <span className="font-mono truncate">{room.roomId}</span>
                          <span className="text-xs ml-2 flex-shrink-0 flex items-center gap-1">
                            <Users size={12} />
                            {isFull ? 'Full' : `${room.participants}/${room.maxParticipants}`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={joining || (authRequired && !authUser)}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white font-semibold rounded-lg transition-colors"
            >
              {joining ? 'Joining…' : 'Join Room'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // CHAT ROOM
  // ------------------------------------------------------------------
  const myName = authUser?.name || (username || 'Anonymous').trim() || 'Anonymous';

  return (
    <div className="h-screen w-full bg-[#0b141a] flex flex-col font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#202c33] text-white">
        <div className="min-w-0">
          <p className="font-semibold truncate">#{roomId}</p>
          <p className="text-xs text-slate-400 truncate">
            {users.length > 0
              ? `${users.length} online: ${users.map((u) => u.username).slice(0, 4).join(', ')}${users.length > 4 ? '…' : ''}`
              : 'Connecting…'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {authUser?.picture && (
            <img
              src={authUser.picture}
              alt={authUser.name}
              title={authUser.name}
              className="w-8 h-8 rounded-full"
              referrerPolicy="no-referrer"
            />
          )}
          {authUser && (
            <button
              onClick={signOut}
              className="px-3 py-1.5 rounded-lg bg-[#2a3942] hover:bg-[#374045] text-sm"
              title="Sign out"
            >
              Sign out
            </button>
          )}
          <button
            onClick={leave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2a3942] hover:bg-[#374045] text-sm"
            title="Leave room"
          >
            <LogOut size={16} />
            Leave
          </button>
        </div>
      </header>

      {notice && (
        <div className="bg-[#182229] text-center text-xs text-amber-200/90 px-4 py-1.5">
          {notice}
        </div>
      )}
      {error && (
        <div className="bg-red-500/15 text-center text-xs text-red-300 px-4 py-1.5">
          {error}
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-[#0b141a]">
        {messages.length === 0 && (
          <p className="text-center text-sm text-slate-500 mt-8">
            No messages yet. Say hi! 👋
          </p>
        )}
        {messages.map((msg) => {
          const own = msg.sender === myName;
          const senderPic = !own
            ? users.find((u) => u.username === msg.sender)?.picture
            : null;
          return (
            <div key={msg.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 shadow ${
                  own ? 'bg-[#005c4b] text-white rounded-br-sm' : 'bg-[#202c33] text-slate-100 rounded-bl-sm'
                }`}
              >
                {!own && (
                  <p className="text-xs font-semibold text-emerald-400 mb-0.5 flex items-center gap-1.5">
                    {senderPic && (
                      <img
                        src={senderPic}
                        alt={msg.sender}
                        className="w-4 h-4 rounded-full"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    {msg.sender}
                  </p>
                )}
                {msg.type === 'voice' ? (
                  <VoiceNote audioUrl={msg.audioUrl} duration={msg.duration} own={own} />
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                )}
                <p className={`text-[10px mt-1 text-right ${own ? 'text-emerald-100/70' : 'text-slate-500'}`}>
                  {msg.pending ? 'sending… ' : ''}{formatClock(msg.timestamp)}
                </p>
              </div>
            </div>
          );
        })}
        {typingUsers.length > 0 && (
          <p className="text-xs text-slate-400 italic px-1">
            {typingUsers.length === 1
              ? `${typingUsers[0]} is typing…`
              : `${typingUsers.join(', ')} are typing…`}
          </p>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Composer */}
      <footer className="px-3 py-2 bg-[#202c33]">
        {recording ? (
          <VoiceRecorder
            onSend={sendVoice}
            onDiscard={() => setRecording(false)}
          />
        ) : (
          <form onSubmit={sendText} className="flex items-center gap-2">
            <input
              type="text"
              value={text}
              onChange={handleTextChange}
              onBlur={() => emitTyping(false)}
              placeholder="Type a message"
              maxLength={2000}
              className="flex-1 min-w-0 px-4 py-2.5 bg-[#2a3942] rounded-full text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            {text.trim() ? (
              <button
                type="submit"
                className="p-2.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-500 flex-shrink-0"
                title="Send"
              >
                <Send size={20} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
                    setError('Voice notes need microphone access over HTTPS.');
                    return;
                  }
                  setRecording(true);
                }}
                disabled={sending}
                className="p-2.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-500 disabled:bg-slate-600 flex-shrink-0"
                title="Record voice note"
              >
                <Mic size={20} />
              </button>
            )}
          </form>
        )}
      </footer>
    </div>
  );
};

export default ChatApp;
