import { create } from 'zustand';
import { synthesizeSpeech, fetchTtsHealth } from './api';
import { toSpeakableText } from './message-text';

export type TtsState = 'idle' | 'loading' | 'speaking';

/**
 * Voice output is a single shared resource: one utterance at a time, for the
 * whole app. The state lives in one store rather than per component, because a
 * per-component hook would give every message its own audio element -- two
 * replies would then talk over each other, and autoplay would make that the
 * normal case rather than the exception.
 */
interface TtsStore {
  state: TtsState;
  /** id of the message currently loading or speaking, if any. */
  speakingId: string | null;
  error: string | null;
  /** Message whose read-aloud attempt failed, if any. */
  errorId: string | null;
  /** null until the health probe has answered. */
  available: boolean | null;
  /** Last message spoken by autoplay, so a re-render never repeats it. */
  autoSpokenId: string | null;
  speak: (id: string, text: string) => Promise<void>;
  /** Queue a streaming sentence for low-latency sequential playback with prefetch. */
  enqueue: (id: string, text: string) => void;
  stop: () => void;
  ensureHealth: () => Promise<void>;
  markAutoSpoken: (id: string) => void;
}

// Playback handles are not render state -- keeping them out of the store avoids
// re-rendering every subscriber when an audio element is swapped.
let audio: HTMLAudioElement | null = null;
let objectUrl: string | null = null;
let controller: AbortController | null = null;
let token = 0;
let healthProbe: Promise<void> | null = null;

interface QueuedChunk {
  id: string;
  ac: AbortController;
  blobPromise: Promise<Blob>;
}
let chunkQueue: QueuedChunk[] = [];
let drainingQueue = false;

function clearQueue(): void {
  for (const item of chunkQueue) {
    item.ac.abort();
  }
  chunkQueue = [];
  drainingQueue = false;
}

/** Only a stream ending in the active conversation may trigger autoplay. */
export function shouldAutoplayFinishedReply(
  previousStreamingConversationId: string | null,
  activeId: string | null,
  streamIsActive: boolean,
  lastMessage: { id: string; role: string } | undefined,
  autoSpokenId: string | null,
): boolean {
  return previousStreamingConversationId !== null
    && previousStreamingConversationId === activeId
    && !streamIsActive
    && lastMessage !== undefined
    && lastMessage.role === 'assistant'
    && lastMessage.id !== autoSpokenId;
}

function teardown(): void {
  if (audio) {
    // Detach first: clearing src re-runs the media load algorithm, which fails
    // on an empty source and dispatches an `error` event. With the handler
    // still attached that surfaces as a bogus "Playback failed" after every
    // successful utterance.
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (controller) {
    controller.abort();
    controller = null;
  }
}

export const useTtsStore = create<TtsStore>((set, get) => ({
  state: 'idle',
  speakingId: null,
  error: null,
  errorId: null,
  available: null,
  autoSpokenId: null,

  ensureHealth: () => {
    if (healthProbe) return healthProbe;
    healthProbe = fetchTtsHealth()
      .then((health) => {
        set({ available: health.available });
        if (!health.available) healthProbe = null;
      })
      .catch(() => {
        set({ available: false });
        healthProbe = null;
      });
    return healthProbe;
  },

  markAutoSpoken: (id: string) => set({ autoSpokenId: id }),

  speak: async (id: string, text: string) => {
    const trimmed = toSpeakableText(text);
    if (!trimmed) return;

    // Bump before teardown so a synthesis still in flight is both aborted and
    // fenced off by the token, even if the abort loses the race.
    token += 1;
    const mine = token;
    clearQueue();
    teardown();
    set({ state: 'loading', speakingId: id, error: null, errorId: null });

    const ac = new AbortController();
    controller = ac;

    try {
      const blob = await synthesizeSpeech(trimmed, { signal: ac.signal });
      if (mine !== token) return;

      const url = URL.createObjectURL(blob);
      objectUrl = url;
      const el = new Audio(url);
      audio = el;

      el.onended = () => {
        if (mine !== token) return;
        teardown();
        set({ state: 'idle', speakingId: null });
      };
      el.onerror = () => {
        if (mine !== token) return;
        teardown();
        set({ state: 'idle', speakingId: null, error: 'Playback failed', errorId: id });
      };

      await el.play();
      if (mine === token) set({ state: 'speaking', speakingId: id });
    } catch (err) {
      if (mine !== token) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      teardown();
      set({
        state: 'idle',
        speakingId: null,
        error: err instanceof Error ? err.message : 'Speech synthesis failed',
        errorId: id,
      });
    }
  },

  enqueue: (id: string, text: string) => {
    const trimmed = toSpeakableText(text);
    if (!trimmed) return;

    const ac = new AbortController();
    // Kick off synthesis immediately so the next sentence is already fetched
    // while the current sentence is still playing.
    const blobPromise = synthesizeSpeech(trimmed, { signal: ac.signal });
    chunkQueue.push({ id, ac, blobPromise });

    if (drainingQueue) return;
    drainingQueue = true;
    const sessionToken = token;

    if (get().state === 'idle') {
      set({ state: 'loading', speakingId: id, error: null, errorId: null });
    }

    const drain = async () => {
      while (chunkQueue.length > 0) {
        if (sessionToken !== token) return;
        const next = chunkQueue.shift()!;
        try {
          const blob = await next.blobPromise;
          if (sessionToken !== token) return;

          teardown();
          const url = URL.createObjectURL(blob);
          objectUrl = url;
          const el = new Audio(url);
          audio = el;

          await new Promise<void>((resolve, reject) => {
            el.onended = () => resolve();
            el.onerror = () => reject(new Error('Playback failed'));
            el.play()
              .then(() => {
                if (sessionToken === token) {
                  set({ state: 'speaking', speakingId: next.id });
                }
              })
              .catch(reject);
          });
        } catch (err) {
          if (sessionToken !== token) return;
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // Skip a failed chunk rather than locking the voice queue
        }
      }

      if (sessionToken === token) {
        teardown();
        drainingQueue = false;
        set({ state: 'idle', speakingId: null });
      }
    };

    void drain();
  },

  stop: () => {
    token += 1;
    clearQueue();
    teardown();
    set({ state: 'idle', speakingId: null, error: null, errorId: null });
  },
}));

/** Test seam: reset module-level playback handles between cases. */
export function __resetTtsForTests(): void {
  clearQueue();
  teardown();
  token = 0;
  healthProbe = null;
  useTtsStore.setState({
    state: 'idle',
    speakingId: null,
    error: null,
    errorId: null,
    available: null,
    autoSpokenId: null,
  });
}
