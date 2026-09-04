import { useEffect, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';

/**
 * WhatsApp-style voice recorder.
 * Auto-starts on mount. Live waveform on canvas, timer, discard + send.
 * Props: onSend({ blob, duration, mimeType }), onDiscard()
 */
const MAX_SECONDS = 120;

const pickMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''];
  for (const t of candidates) {
    if (!t) return '';
    try {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      continue;
    }
  }
  return '';
};

const formatClock = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const VoiceRecorder = ({ onSend, onDiscard }) => {
  const [elapsed, setElapsed] = useState(0);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mimeRef = useRef('');
  const startTimeRef = useRef(0);
  const stoppedRef = useRef(false);
  const modeRef = useRef(null); // null | 'send' | 'discard' — decided when stopping
  const onSendRef = useRef(onSend);
  const onDiscardRef = useRef(onDiscard);
  onSendRef.current = onSend;
  onDiscardRef.current = onDiscard;

  const finish = (send) => {
    if (modeRef.current) return;
    modeRef.current = send ? 'send' : 'discard';
    stoppedRef.current = true;
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop(); // onstop below delivers the result
      } else {
        cleanup();
        onDiscardRef.current();
      }
    } catch {
      cleanup();
      onDiscardRef.current();
    }
  };

  const cleanup = () => {
    stoppedRef.current = true;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    let timerId;
    let rafId;
    let audioCtx = null;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stoppedRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        mimeRef.current = pickMimeType();
        const recorder = new MediaRecorder(stream, mimeRef.current ? { mimeType: mimeRef.current } : undefined);
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: mimeRef.current || 'audio/webm' });
          const duration = (Date.now() - startTimeRef.current) / 1000;
          cleanup();
          if (modeRef.current === 'send' && blob.size > 0) {
            onSendRef.current({ blob, duration, mimeType: mimeRef.current || blob.type || 'audio/webm' });
          } else {
            onDiscardRef.current();
          }
        };
        recorderRef.current = recorder;
        startTimeRef.current = Date.now();
        recorder.start();

        timerId = setInterval(() => {
          const s = (Date.now() - startTimeRef.current) / 1000;
          setElapsed(s);
          if (s >= MAX_SECONDS) finish(true);
        }, 250);

        // Live waveform
        try {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const canvas = canvasRef.current;
          const draw = () => {
            if (stoppedRef.current) return;
            rafId = requestAnimationFrame(draw);
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i++) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const level = Math.min(1, Math.sqrt(sum / data.length) * 3);
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);
            const bars = 28;
            const gap = 3;
            const bw = (width - gap * (bars - 1)) / bars;
            ctx.fillStyle = '#ef4444';
            for (let i = 0; i < bars; i++) {
              const decay = 1 - Math.abs(i - bars / 2) / (bars / 2);
              const h = Math.max(3, level * height * (0.3 + 0.7 * decay));
              const x = i * (bw + gap);
              ctx.fillRect(x, (height - h) / 2, bw, h);
            }
          };
          draw();
        } catch {
          /* waveform optional */
        }
      } catch {
        cleanup();
        onDiscard();
      }
    };

    start();
    return () => {
      clearInterval(timerId);
      cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
      if (!modeRef.current) {
        // Unmounted mid-recording (e.g. navigated away) → treat as discard.
        modeRef.current = 'discard';
        try {
          if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
            return; // onstop will discard
          }
        } catch {
          /* ignore */
        }
        cleanup();
      } else {
        cleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex items-center gap-2 bg-white rounded-full pl-3 pr-2 py-2 shadow border border-slate-200">
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
      <span className="text-sm font-mono text-slate-700 w-10">{formatClock(elapsed)}</span>
      <canvas ref={canvasRef} width={150} height={28} className="flex-1 h-7 min-w-0" />
      <button
        onClick={() => finish(false)}
        className="p-2.5 rounded-full text-slate-500 hover:bg-slate-100"
        title="Discard"
      >
        <Trash2 size={20} />
      </button>
      <button
        onClick={() => finish(true)}
        className="p-2.5 rounded-full bg-green-500 text-white hover:bg-green-600"
        title="Send"
      >
        <Send size={20} />
      </button>
    </div>
  );
};

export default VoiceRecorder;
