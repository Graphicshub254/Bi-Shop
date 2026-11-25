import { describe, it, expect, beforeEach, vi } from 'vitest';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
});

import { useAvatarStore } from './avatar-store';

describe('useAvatarStore', () => {
  beforeEach(() => {
    storage.clear();
    useAvatarStore.setState({
      enabled: true,
      renderer: '2d',
      style2d: 'hologram',
      accentColor: '#38bdf8',
      vrmModelUrl: '',
      vrmModelName: '',
      live2dModelUrl: '',
      live2dSdkUrl: '',
      expressionOverride: null,
    });
  });

  it('toggles avatar panel visibility and persists to localStorage', () => {
    useAvatarStore.getState().toggleEnabled();
    expect(useAvatarStore.getState().enabled).toBe(false);
    const saved = JSON.parse(storage.get('openjarvis-avatar-settings') || '{}');
    expect(saved.enabled).toBe(false);
  });

  it('switches renderer modes and 2D styles', () => {
    useAvatarStore.getState().setRenderer('vrm');
    expect(useAvatarStore.getState().renderer).toBe('vrm');

    useAvatarStore.getState().setRenderer('live2d');
    expect(useAvatarStore.getState().renderer).toBe('live2d');

    useAvatarStore.getState().setStyle2d('anime');
    expect(useAvatarStore.getState().style2d).toBe('anime');

    useAvatarStore.getState().setStyle2d('minimal');
    expect(useAvatarStore.getState().style2d).toBe('minimal');
  });

  it('does not persist ephemeral blob URLs for VRM models', () => {
    useAvatarStore.getState().setVrmModel('blob:http://127.0.0.1:5173/abc', 'avatar.vrm');
    expect(useAvatarStore.getState().vrmModelUrl).toBe('blob:http://127.0.0.1:5173/abc');
    const saved = JSON.parse(storage.get('openjarvis-avatar-settings') || '{}');
    expect(saved.vrmModelUrl).toBe('');
  });
});
