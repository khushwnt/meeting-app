import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';

/** Playable voice-note bubble. Props: audioUrl (object URL), duration (sec, may be 0). */
const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const VoiceNote = ({ audioUrl, duration, own }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration || 0);

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    const onTime = () => setCurrent(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setTotal(audio.duration);
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrent(0);
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnded);
      audioRef.current = null;
    };
  }, [audioUrl]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  const seek = (e) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Number(e.target.value);
    setCurrent(audio.currentTime);
  };

  return (
    <div className="flex items-center gap-2 min-w-0 w-56">
      <button
        onClick={toggle}
        className={`p-2 rounded-full flex-shrink-0 ${
          own ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
        }`}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>
      <input
        type="range"
        min={0}
        max={Number.isFinite(total) && total > 0 ? total : 0}
        step={0.1}
        value={Math.min(current, total || 0)}
        onChange={seek}
        className="flex-1 min-w-0 accent-green-600 h-1 cursor-pointer"
      />
      <span className={`text-xs font-mono flex-shrink-0 ${own ? 'text-green-900' : 'text-slate-500'}`}>
        {formatTime(playing || current > 0 ? current : total)}
      </span>
    </div>
  );
};

export default VoiceNote;
