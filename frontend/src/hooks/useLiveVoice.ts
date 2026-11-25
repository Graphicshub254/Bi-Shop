import { useCallback, useEffect, useRef, useState } from 'react';
import { getBase } from '../lib/api';
import { useAvatarStore } from '../lib/avatar-store';
import { useTtsStore } from '../lib/tts';

export interface LiveVoiceState {
  supported: boolean;
  active: boolean;
  listening: boolean;
  transcript: string;
  error: string | null;
  toggle: () => void;
  stop: () => void;
}

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

function buildLiveVoiceWsUrl(): string {
  const base = getBase();
  if (base && (base.startsWith('http://') || base.startsWith('https://'))) {
    return base.replace(/^http/, 'ws') + '/v1/live-voice';
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/v1/live-voice`;
}

/**
 * Sub-second bidirectional J.A.R.V.I.S.-style voice loop powered by
 * Gemini Multimodal Live API over `WS /v1/live-voice`.
 *
 * Streams 16 kHz PCM from the microphone continuously, plays back 24 kHz PCM
 * responses with ~300-500ms latency, drives real-time Avatar lip-sync, and
 * supports instant mid-sentence barge-in / interruption.
 */
export function useLiveVoice(): LiveVoiceState {
  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof WebSocket !== 'undefined';

  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const speakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPlaybackQueue = useCallback(() => {
    for (const src of scheduledSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // Ignore already-ended nodes
      }
    }
    scheduledSourcesRef.current = [];
    if (playCtxRef.current) {
      nextPlayTimeRef.current = playCtxRef.current.currentTime;
    }
    if (speakingTimerRef.current) {
      clearTimeout(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    useAvatarStore.getState().setLiveAudio(false, 0);
  }, []);

  const teardown = useCallback(() => {
    clearPlaybackQueue();
    if (procRef.current) {
      procRef.current.onaudioprocess = null;
      try {
        procRef.current.disconnect();
      } catch {}
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
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    setListening(false);
    useAvatarStore.getState().setLiveAudio(false, 0);
  }, [clearPlaybackQueue]);

  useEffect(() => {
    if (!active) {
      teardown();
      return;
    }

    let cancelled = false;
    setError(null);
    setTranscript('Connecting to Bi-Shop Live…');

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

        const micCtx = new AudioCtx();
        const playCtx = new AudioCtx({ sampleRate: 24000 });
        micCtxRef.current = micCtx;
        playCtxRef.current = playCtx;
        nextPlayTimeRef.current = playCtx.currentTime;

        const ws = new WebSocket(buildLiveVoiceWsUrl());
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          const source = micCtx.createMediaStreamSource(stream);
          const proc = micCtx.createScriptProcessor(4096, 1, 1);
          procRef.current = proc;

          proc.onaudioprocess = (ev) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const input = ev.inputBuffer.getChannelData(0);
            const pcm = floatToInt16Pcm(input, micCtx.sampleRate, 16000);
            ws.send(pcm);
          };

          source.connect(proc);
          proc.connect(micCtx.destination);
        };

        ws.onmessage = (ev) => {
          if (cancelled) return;
          if (typeof ev.data === 'string') {
            try {
              const msg = JSON.parse(ev.data) as {
                type: string;
                message?: string;
                text?: string;
                role?: string;
              };
              if (msg.type === 'ready') {
                setListening(true);
                setTranscript('Live — speak anytime, Sir');
              } else if (msg.type === 'interrupted') {
                clearPlaybackQueue();
              } else if (msg.type === 'transcript' && msg.text) {
                setTranscript(msg.text.trim());
              } else if (msg.type === 'error') {
                setError(msg.message || 'Live voice error');
                setActive(false);
              }
            } catch {
              // Ignore malformed JSON control frames
            }
            return;
          }

          // Binary 24 kHz mono Int16 PCM audio from Gemini Live
          if (ev.data instanceof ArrayBuffer && playCtxRef.current) {
            const pCtx = playCtxRef.current;
            if (pCtx.state === 'suspended') {
              void pCtx.resume();
            }
            const int16 = new Int16Array(ev.data);
            if (int16.length === 0) return;

            const float32 = new Float32Array(int16.length);
            let sumSq = 0;
            for (let i = 0; i < int16.length; i++) {
              const f = int16[i] / 32768;
              float32[i] = f;
              sumSq += f * f;
            }
            const rms = Math.sqrt(sumSq / int16.length);
            const level = Math.min(1, rms * 4.5);

            const buffer = pCtx.createBuffer(1, float32.length, 24000);
            buffer.copyToChannel(float32, 0);

            const node = pCtx.createBufferSource();
            node.buffer = buffer;
            node.connect(pCtx.destination);

            const now = pCtx.currentTime;
            const startAt = Math.max(now + 0.015, nextPlayTimeRef.current);
            node.start(startAt);
            nextPlayTimeRef.current = startAt + buffer.duration;
            scheduledSourcesRef.current.push(node);

            useAvatarStore.getState().setLiveAudio(true, Math.max(0.18, level));

            node.onended = () => {
              scheduledSourcesRef.current = scheduledSourcesRef.current.filter((n) => n !== node);
              if (scheduledSourcesRef.current.length === 0) {
                if (speakingTimerRef.current) clearTimeout(speakingTimerRef.current);
                speakingTimerRef.current = setTimeout(() => {
                  if (scheduledSourcesRef.current.length === 0) {
                    useAvatarStore.getState().setLiveAudio(false, 0);
                  }
                }, 140);
              }
            };
          }
        };

        ws.onerror = () => {
          if (!cancelled) {
            setError('Live voice WebSocket error — restart `bishop serve`');
          }
        };

        ws.onclose = () => {
          if (!cancelled) {
            setListening(false);
          }
        };
      } catch {
        if (!cancelled) {
          setError('Microphone permission denied');
          setActive(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [active, clearPlaybackQueue, teardown]);

  const stop = useCallback(() => {
    setActive(false);
    setTranscript('');
    setError(null);
    teardown();
  }, [teardown]);

  const toggle = useCallback(() => {
    if (!supported) {
      setError('Live Talk requires microphone + WebSocket support');
      return;
    }
    useTtsStore.getState().stop();
    setActive((prev) => !prev);
  }, [supported]);

  return { supported, active, listening, transcript, error, toggle, stop };
}
