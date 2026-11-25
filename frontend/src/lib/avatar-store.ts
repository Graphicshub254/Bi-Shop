import { create } from 'zustand';

export type AvatarRendererMode = '2d' | 'vrm' | 'live2d';
export type Avatar2DStyle = 'hologram' | 'anime' | 'minimal';
export type AvatarExpression = 'neutral' | 'happy' | 'thinking' | 'surprised';

const AVATAR_STORAGE_KEY = 'openjarvis-avatar-settings';

interface PersistedAvatarSettings {
  enabled: boolean;
  renderer: AvatarRendererMode;
  style2d: Avatar2DStyle;
  accentColor: string;
  vrmModelUrl: string;
  vrmModelName: string;
  live2dModelUrl: string;
  live2dSdkUrl: string;
}

const DEFAULT_SETTINGS: PersistedAvatarSettings = {
  enabled: true,
  renderer: '2d',
  style2d: 'hologram',
  accentColor: '#38bdf8',
  vrmModelUrl: '',
  vrmModelName: '',
  live2dModelUrl: '',
  live2dSdkUrl: '',
};

function loadAvatarSettings(): PersistedAvatarSettings {
  try {
    const raw = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PersistedAvatarSettings>;
    // Never persist ephemeral blob: URLs across page reloads
    const vrmModelUrl = parsed.vrmModelUrl?.startsWith('blob:') ? '' : (parsed.vrmModelUrl ?? '');
    const vrmModelName = vrmModelUrl ? (parsed.vrmModelName ?? '') : '';
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      vrmModelUrl,
      vrmModelName,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveAvatarSettings(state: PersistedAvatarSettings): void {
  try {
    const toSave: PersistedAvatarSettings = {
      enabled: state.enabled,
      renderer: state.renderer,
      style2d: state.style2d,
      accentColor: state.accentColor,
      vrmModelUrl: state.vrmModelUrl.startsWith('blob:') ? '' : state.vrmModelUrl,
      vrmModelName: state.vrmModelUrl.startsWith('blob:') ? '' : state.vrmModelName,
      live2dModelUrl: state.live2dModelUrl.startsWith('blob:') ? '' : state.live2dModelUrl,
      live2dSdkUrl: state.live2dSdkUrl,
    };
    localStorage.setItem(AVATAR_STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Ignore storage quota/security errors
  }
}

export interface AvatarStore extends PersistedAvatarSettings {
  expressionOverride: AvatarExpression | null;
  liveSpeaking: boolean;
  liveAudioLevel: number;
  toggleEnabled: () => void;
  setEnabled: (enabled: boolean) => void;
  setRenderer: (renderer: AvatarRendererMode) => void;
  setStyle2d: (style: Avatar2DStyle) => void;
  setAccentColor: (color: string) => void;
  setVrmModel: (url: string, name?: string) => void;
  setLive2dModelUrl: (url: string) => void;
  setLive2dSdkUrl: (url: string) => void;
  setExpressionOverride: (expression: AvatarExpression | null) => void;
  setLiveAudio: (speaking: boolean, level: number) => void;
}

const initial = loadAvatarSettings();

export const useAvatarStore = create<AvatarStore>((set, get) => ({
  ...initial,
  expressionOverride: null,
  liveSpeaking: false,
  liveAudioLevel: 0,

  toggleEnabled: () => {
    const next = !get().enabled;
    set({ enabled: next });
    saveAvatarSettings({ ...get(), enabled: next });
  },

  setEnabled: (enabled) => {
    set({ enabled });
    saveAvatarSettings({ ...get(), enabled });
  },

  setRenderer: (renderer) => {
    set({ renderer });
    saveAvatarSettings({ ...get(), renderer });
  },

  setStyle2d: (style2d) => {
    set({ style2d });
    saveAvatarSettings({ ...get(), style2d });
  },

  setAccentColor: (accentColor) => {
    set({ accentColor });
    saveAvatarSettings({ ...get(), accentColor });
  },

  setVrmModel: (vrmModelUrl, vrmModelName = '') => {
    const prev = get().vrmModelUrl;
    if (prev && prev.startsWith('blob:') && prev !== vrmModelUrl) {
      URL.revokeObjectURL(prev);
    }
    set({ vrmModelUrl, vrmModelName });
    saveAvatarSettings({ ...get(), vrmModelUrl, vrmModelName });
  },

  setLive2dModelUrl: (live2dModelUrl) => {
    set({ live2dModelUrl });
    saveAvatarSettings({ ...get(), live2dModelUrl });
  },

  setLive2dSdkUrl: (live2dSdkUrl) => {
    set({ live2dSdkUrl });
    saveAvatarSettings({ ...get(), live2dSdkUrl });
  },

  setExpressionOverride: (expressionOverride) => set({ expressionOverride }),
  setLiveAudio: (liveSpeaking, liveAudioLevel) => set({ liveSpeaking, liveAudioLevel }),
}));
