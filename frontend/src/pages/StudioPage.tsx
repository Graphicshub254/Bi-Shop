import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Clapperboard,
  Languages,
  Globe,
  Mic,
  MonitorPlay,
  Square,
  Sparkles,
  Send,
} from 'lucide-react';
import { getBase } from '../lib/api';
import { useAvatarStore } from '../lib/avatar-store';

type StudioTab = 'dubber' | 'shotcraft' | 'osint';
type AudioSourceMode = 'tab' | 'mic';

interface SubtitleEntry {
  id: number;
  role: 'original' | 'dub';
  text: string;
}

const LANGUAGES = ['English', 'Swahili', 'Japanese', 'Spanish', 'French', 'Korean', 'Hindi', 'Arabic'];
const VOICES = [
  { id: 'Charon', label: 'Charon (Deep / Calm)' },
  { id: 'Fenrir', label: 'Fenrir (Bold / Dramatic)' },
  { id: 'Aoede', label: 'Aoede (Warm / Expressive)' },
  { id: 'Kore', label: 'Kore (Clear / Bright)' },
  { id: 'Puck', label: 'Puck (Energetic)' },
];

function floatToInt16Pcm(input: Float32Array, inputRate: number, targetRate = 16000): ArrayBuffer {
  const ratio = inputRate / targetRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = Math.min(input.length - 1, Math.floor(i * ratio));
    const s = Math.max(-1, Math.min(1, input[idx]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm.buffer;
}

function buildDubWsUrl(targetLang: string, voice: string): string {
  const params = new URLSearchParams({
    mode: 'dub',
    target_lang: targetLang,
    voice,
  });
  const base = getBase();
  if (base && (base.startsWith('http://') || base.startsWith('https://'))) {
    return `${base.replace(/^http/, 'ws')}/v1/live-voice?${params.toString()}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/v1/live-voice?${params.toString()}`;
}

export function StudioPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<StudioTab>('dubber');

  // ── Live Dubber state ──
  const [sourceMode, setSourceMode] = useState<AudioSourceMode>('tab');
  const [targetLang, setTargetLang] = useState('English');
  const [voice, setVoice] = useState('Charon');
  const [dubbing, setDubbing] = useState(false);
  const [dubStatus, setDubStatus] = useState('Ready — pick a browser tab (movie/anime) or mic');
  const [dubError, setDubError] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayRef = useRef<number>(0);
  const subIdRef = useRef<number>(1);

  // ── ShotCraft state ──
  const [projectTitle, setProjectTitle] = useState('');
  const [projectFormat, setProjectFormat] = useState('Anime Episode');
  const [projectConcept, setProjectConcept] = useState('');

  // ── OSINT / Market state ──
  const [targetEntity, setTargetEntity] = useState('');
  const [intelFocus, setIntelFocus] = useState('Full Geospatial & Catalyst Brief');

  const stopDubbing = useCallback(() => {
    if (procRef.current) {
      procRef.current.onaudioprocess = null;
      try { procRef.current.disconnect(); } catch {}
      procRef.current = null;
    }
    if (micCtxRef.current) {
      void micCtxRef.current.close().catch(() => {});
      micCtxRef.current = null;
    }
    if (playCtxRef.current) {
      void playCtxRef.current.close().catch(() => {});
      playCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onerror = null;
      wsRef.current.onclose = null;
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    useAvatarStore.getState().setLiveAudio(false, 0);
    setDubbing(false);
    setDubStatus('Stopped');
  }, []);

  useEffect(() => () => stopDubbing(), [stopDubbing]);

  const startDubbing = async () => {
    setDubError(null);
    setSubtitles([]);
    setDubStatus('Capturing audio source…');

    try {
      let stream: MediaStream;
      if (sourceMode === 'tab') {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        if (stream.getAudioTracks().length === 0) {
          stream.getTracks().forEach((t) => t.stop());
          setDubError('No audio track shared — check "Share tab audio" in the browser picker.');
          setDubStatus('Ready');
          return;
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      const micCtx = new AudioCtx();
      const playCtx = new AudioCtx({ sampleRate: 24000 });
      micCtxRef.current = micCtx;
      playCtxRef.current = playCtx;
      nextPlayRef.current = playCtx.currentTime;

      const ws = new WebSocket(buildDubWsUrl(targetLang, voice));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      setDubbing(true);
      setDubStatus(`Connecting live dubber → ${targetLang}…`);

      stream.getAudioTracks()[0].onended = () => stopDubbing();

      ws.onopen = () => {
        const audioOnlyStream = new MediaStream(stream.getAudioTracks());
        const source = micCtx.createMediaStreamSource(audioOnlyStream);
        const proc = micCtx.createScriptProcessor(4096, 1, 1);
        procRef.current = proc;

        proc.onaudioprocess = (ev) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const pcm = floatToInt16Pcm(ev.inputBuffer.getChannelData(0), micCtx.sampleRate, 16000);
          ws.send(pcm);
        };

        source.connect(proc);
        proc.connect(micCtx.destination);
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const msg = JSON.parse(ev.data) as {
              type: string;
              role?: string;
              text?: string;
              message?: string;
            };
            if (msg.type === 'ready') {
              setDubStatus(`Live dubbing active (${targetLang} · ${voice})`);
            } else if (msg.type === 'transcript' && msg.text) {
              const role = msg.role === 'user' ? 'original' : 'dub';
              const id = subIdRef.current++;
              setSubtitles((prev) => [...prev.slice(-24), { id, role, text: msg.text!.trim() }]);
            } else if (msg.type === 'error') {
              setDubError(msg.message || 'Dubbing stream error');
              stopDubbing();
            }
          } catch {}
          return;
        }

        if (ev.data instanceof ArrayBuffer && playCtxRef.current) {
          const pCtx = playCtxRef.current;
          if (pCtx.state === 'suspended') void pCtx.resume();
          const int16 = new Int16Array(ev.data);
          if (int16.length === 0) return;

          const float32 = new Float32Array(int16.length);
          let sumSq = 0;
          for (let i = 0; i < int16.length; i++) {
            const f = int16[i] / 32768;
            float32[i] = f;
            sumSq += f * f;
          }
          const level = Math.min(1, Math.sqrt(sumSq / int16.length) * 4.5);

          const buffer = pCtx.createBuffer(1, float32.length, 24000);
          buffer.copyToChannel(float32, 0);
          const node = pCtx.createBufferSource();
          node.buffer = buffer;
          node.connect(pCtx.destination);

          const startAt = Math.max(pCtx.currentTime + 0.015, nextPlayRef.current);
          node.start(startAt);
          nextPlayRef.current = startAt + buffer.duration;
          useAvatarStore.getState().setLiveAudio(true, Math.max(0.2, level));
          node.onended = () => {
            if (pCtx.currentTime >= nextPlayRef.current - 0.05) {
              useAvatarStore.getState().setLiveAudio(false, 0);
            }
          };
        }
      };

      ws.onerror = () => {
        setDubError('WebSocket connection failed — make sure `bishop serve` is running.');
        stopDubbing();
      };
    } catch (err) {
      setDubError(err instanceof Error ? err.message : 'Could not capture audio');
      stopDubbing();
    }
  };

  const launchChatPrompt = (prompt: string) => {
    navigate('/');
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('bishop:voice-send', { detail: { text: prompt } }));
    }, 180);
  };

  return (
    <div className="flex flex-col h-full w-full overflow-y-auto p-6">
      <div className="max-w-4xl w-full mx-auto flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <Clapperboard size={20} style={{ color: 'var(--color-accent)' }} />
              <span>Bi-Shop Studio</span>
            </h1>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              Real-time dubbing, film &amp; anime shotcraft, and geospatial OSINT market intelligence.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {[
              { id: 'dubber' as StudioTab, label: 'Live Dubber', icon: Languages },
              { id: 'shotcraft' as StudioTab, label: 'Script & ShotCraft', icon: Sparkles },
              { id: 'osint' as StudioTab, label: 'OSINT Market Intel', icon: Globe },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    background: active ? 'var(--color-bg-tertiary)' : 'transparent',
                    color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                  }}
                >
                  <Icon size={14} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── TAB 1: REAL-TIME DUBBER ── */}
        {tab === 'dubber' && (
          <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  Audio Source
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => setSourceMode('tab')}
                    disabled={dubbing}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs cursor-pointer"
                    style={{
                      background: sourceMode === 'tab' ? 'var(--color-accent-subtle)' : 'var(--color-bg-tertiary)',
                      color: sourceMode === 'tab' ? 'var(--color-accent)' : 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <MonitorPlay size={14} />
                    <span>Movie / Tab</span>
                  </button>
                  <button
                    onClick={() => setSourceMode('mic')}
                    disabled={dubbing}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs cursor-pointer"
                    style={{
                      background: sourceMode === 'mic' ? 'var(--color-accent-subtle)' : 'var(--color-bg-tertiary)',
                      color: sourceMode === 'mic' ? 'var(--color-accent)' : 'var(--color-text)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <Mic size={14} />
                    <span>Microphone</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  Target Language
                </label>
                <select
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  disabled={dubbing}
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  Dub Voice
                </label>
                <select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  disabled={dubbing}
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none"
                  style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                >
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={dubbing ? stopDubbing : () => void startDubbing()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                style={{
                  background: dubbing ? '#ef4444' : 'var(--color-accent)',
                  color: dubbing ? '#ffffff' : '#0f172a',
                }}
              >
                {dubbing ? <Square size={13} /> : <Languages size={14} />}
                <span>{dubbing ? 'Stop Live Dubbing' : 'Start Live Dubbing'}</span>
              </button>
              <span className="text-xs" style={{ color: dubError ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                {dubError ?? dubStatus}
              </span>
            </div>

            {/* Live Subtitle Feed */}
            <div
              className="rounded-xl p-3 min-h-[220px] max-h-[340px] overflow-y-auto flex flex-col gap-2"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            >
              {subtitles.length === 0 ? (
                <div className="text-xs text-center my-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                  Live translated subtitles will stream here as the movie, show, or anime plays.
                  <br />
                  Tip: When choosing a browser tab, make sure &ldquo;Share tab audio&rdquo; is toggled ON.
                </div>
              ) : (
                subtitles.map((s) => (
                  <div key={s.id} className="text-xs flex gap-2">
                    <span
                      className="uppercase text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 h-fit"
                      style={{
                        background: s.role === 'dub' ? 'var(--color-accent-subtle)' : 'var(--color-bg-tertiary)',
                        color: s.role === 'dub' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      }}
                    >
                      {s.role === 'dub' ? targetLang : 'SRC'}
                    </span>
                    <span style={{ color: 'var(--color-text)' }}>{s.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── TAB 2: SCRIPT & SHOTCRAFT ── */}
        {tab === 'shotcraft' && (
          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="Show / Film / Episode title…"
                className="px-3 py-2 rounded-lg text-xs outline-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
              <select
                value={projectFormat}
                onChange={(e) => setProjectFormat(e.target.value)}
                className="px-3 py-2 rounded-lg text-xs outline-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                <option>Anime Episode</option>
                <option>Short Film</option>
                <option>YouTube Explainer / Motion Graphics</option>
                <option>Product Commercial</option>
              </select>
            </div>
            <textarea
              rows={4}
              value={projectConcept}
              onChange={(e) => setProjectConcept(e.target.value)}
              placeholder="Describe the premise, characters, visual mood, or target length…"
              className="px-3 py-2 rounded-lg text-xs outline-none resize-none"
              style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
            <button
              onClick={() =>
                launchChatPrompt(
                  `Using your shotcraft-studio and artcraft-director skills, create a complete screenplay treatment, scene breakdown, cinematic shot list (framing, camera movement, lighting, duration, SFX), and visual design system for a ${projectFormat} titled "${projectTitle || 'Untitled'}": ${projectConcept || 'a cyberpunk thriller opening sequence'}.`,
                )
              }
              className="self-start flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              style={{ background: 'var(--color-accent)', color: '#0f172a' }}
            >
              <Send size={13} />
              <span>Generate Script, Shot List &amp; Design Spec</span>
            </button>
          </div>
        )}

        {/* ── TAB 3: OSINT & MARKET INTEL ── */}
        {tab === 'osint' && (
          <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                value={targetEntity}
                onChange={(e) => setTargetEntity(e.target.value)}
                placeholder="Company, ticker, commodity, or region (e.g. NVDA, TSLA, Red Sea)…"
                className="px-3 py-2 rounded-lg text-xs outline-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
              <select
                value={intelFocus}
                onChange={(e) => setIntelFocus(e.target.value)}
                className="px-3 py-2 rounded-lg text-xs outline-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              >
                <option>Full Geospatial &amp; Catalyst Brief</option>
                <option>Supply Chain, Ports &amp; Shipping Flows</option>
                <option>Corporate Aviation &amp; M&amp;A Signals</option>
                <option>Facility Activity &amp; Earnings Proxies</option>
              </select>
            </div>
            <button
              onClick={() =>
                launchChatPrompt(
                  `Using your osint-market-intel and founder-board skills (plus web_search), run a "${intelFocus}" analysis on "${targetEntity || 'TSLA'}". Structure it as Signal -> Corroboration -> Bull/Bear Interpretation -> Key Risk/Invalidation levels.`,
                )
              }
              className="self-start flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
              style={{ background: 'var(--color-accent)', color: '#0f172a' }}
            >
              <Globe size={13} />
              <span>Run OSINT Market Brief</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
