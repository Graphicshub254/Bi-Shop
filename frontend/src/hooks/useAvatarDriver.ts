import { useEffect, useState } from 'react';
import { useAppStore } from '../lib/store';
import { useTtsStore } from '../lib/tts';
import { useAvatarStore, type AvatarExpression } from '../lib/avatar-store';

export type AvatarActivity = 'idle' | 'thinking' | 'speaking';

export interface AvatarDriverState {
  activity: AvatarActivity;
  expression: AvatarExpression;
  /** Normalized mouth openness in [0, 1] for lip-sync animation. */
  mouthOpen: number;
  /** Blink amount in [0, 1] where 1 is fully closed. */
  blink: number;
  /** Subtle idle breathing / hover wave in [-1, 1]. */
  breath: number;
}

/**
 * Drives avatar animation state from OpenJarvis chat streaming + TTS playback.
 * Runs a lightweight requestAnimationFrame loop only while mounted.
 */
export function useAvatarDriver(): AvatarDriverState {
  const isStreaming = useAppStore((s) => s.streamState.isStreaming);
  const streamPhase = useAppStore((s) => s.streamState.phase);
  const ttsState = useTtsStore((s) => s.state);
  const expressionOverride = useAvatarStore((s) => s.expressionOverride);
  const liveSpeaking = useAvatarStore((s) => s.liveSpeaking);
  const liveAudioLevel = useAvatarStore((s) => s.liveAudioLevel);

  const isTtsSpeaking = ttsState === 'speaking' || liveSpeaking;
  const isThinking = (isStreaming && !isTtsSpeaking && streamPhase !== 'generating') || ttsState === 'loading';
  const isSpeaking = isTtsSpeaking || (isStreaming && !isThinking);

  const activity: AvatarActivity = isSpeaking
    ? 'speaking'
    : isThinking
      ? 'thinking'
      : 'idle';

  const expression: AvatarExpression =
    expressionOverride ??
    (activity === 'thinking'
      ? 'thinking'
      : activity === 'speaking'
        ? 'happy'
        : 'neutral');

  const [frame, setFrame] = useState({ mouthOpen: 0, blink: 0, breath: 0 });

  useEffect(() => {
    let rafId = 0;
    let nextBlinkAt = performance.now() + 2200 + Math.random() * 2500;
    let lastCommit = 0;

    const tick = (now: number) => {
      // Cap React state updates to ~30fps to stay light on low-spec CPUs
      if (now - lastCommit >= 33) {
        lastCommit = now;

        const t = now / 1000;
        const breath = Math.sin(t * 1.6);

        // Periodic natural blink (~150ms duration)
        let blink = 0;
        if (now >= nextBlinkAt) {
          const elapsed = now - nextBlinkAt;
          if (elapsed < 150) {
            blink = Math.sin((elapsed / 150) * Math.PI);
          } else {
            nextBlinkAt = now + 2600 + Math.random() * 3200;
          }
        }

        // Real-time PCM amplitude when Gemini Live Voice is speaking;
        // smooth multi-harmonic cadence for text/TTS playback.
        let mouthOpen = 0;
        const liveLvl = useAvatarStore.getState().liveAudioLevel;
        if (useAvatarStore.getState().liveSpeaking && liveLvl > 0.01) {
          mouthOpen = Math.min(1, liveLvl);
        } else if (activity === 'speaking') {
          const wave =
            0.45 +
            0.3 * Math.sin(t * 14.5) +
            0.18 * Math.sin(t * 23.1 + 1.1) +
            0.12 * Math.cos(t * 7.3);
          mouthOpen = Math.max(0.08, Math.min(1, wave));
        }

        setFrame({ mouthOpen, blink, breath });
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [activity]);

  return {
    activity,
    expression,
    mouthOpen: frame.mouthOpen,
    blink: frame.blink,
    breath: frame.breath,
  };
}
