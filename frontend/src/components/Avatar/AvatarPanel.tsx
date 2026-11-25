import { lazy, Suspense } from 'react';
import { X, Sparkles, Volume2, VolumeX, Mic, MicOff, Square } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useTts } from '../../hooks/useTts';
import { useLiveVoice } from '../../hooks/useLiveVoice';
import {
  useAvatarStore,
  type Avatar2DStyle,
  type AvatarExpression,
  type AvatarRendererMode,
} from '../../lib/avatar-store';
import { useAvatarDriver } from '../../hooks/useAvatarDriver';
import { Avatar2DRenderer } from './Avatar2DRenderer';

const AvatarVrmRenderer = lazy(() =>
  import('./AvatarVrmRenderer').then((m) => ({ default: m.AvatarVrmRenderer })),
);
const AvatarLive2DRenderer = lazy(() =>
  import('./AvatarLive2DRenderer').then((m) => ({ default: m.AvatarLive2DRenderer })),
);

const RENDERER_TABS: { id: AvatarRendererMode; label: string }[] = [
  { id: '2d', label: '2D' },
  { id: 'vrm', label: 'VRM 3D' },
  { id: 'live2d', label: 'Live2D' },
];

const STYLE_2D_OPTIONS: { id: Avatar2DStyle; label: string }[] = [
  { id: 'hologram', label: 'Hologram' },
  { id: 'anime', label: 'Anime' },
  { id: 'minimal', label: 'Minimal' },
];

const EXPRESSION_OPTIONS: { id: AvatarExpression | null; label: string }[] = [
  { id: null, label: 'Auto' },
  { id: 'happy', label: 'Happy' },
  { id: 'thinking', label: 'Think' },
  { id: 'surprised', label: 'Wow' },
];

const ACCENT_SWATCHES = ['#38bdf8', '#a78bfa', '#34d399', '#fb7185', '#f59e0b'];

export function AvatarPanel() {
  const enabled = useAvatarStore((s) => s.enabled);
  const renderer = useAvatarStore((s) => s.renderer);
  const style2d = useAvatarStore((s) => s.style2d);
  const accentColor = useAvatarStore((s) => s.accentColor);
  const vrmModelUrl = useAvatarStore((s) => s.vrmModelUrl);
  const vrmModelName = useAvatarStore((s) => s.vrmModelName);
  const live2dModelUrl = useAvatarStore((s) => s.live2dModelUrl);
  const live2dSdkUrl = useAvatarStore((s) => s.live2dSdkUrl);
  const expressionOverride = useAvatarStore((s) => s.expressionOverride);

  const setEnabled = useAvatarStore((s) => s.setEnabled);
  const setRenderer = useAvatarStore((s) => s.setRenderer);
  const setStyle2d = useAvatarStore((s) => s.setStyle2d);
  const setAccentColor = useAvatarStore((s) => s.setAccentColor);
  const setVrmModel = useAvatarStore((s) => s.setVrmModel);
  const setLive2dModelUrl = useAvatarStore((s) => s.setLive2dModelUrl);
  const setLive2dSdkUrl = useAvatarStore((s) => s.setLive2dSdkUrl);
  const setExpressionOverride = useAvatarStore((s) => s.setExpressionOverride);

  const voiceAutoplay = useAppStore((s) => s.settings.voiceAutoplay);
  const voiceOutputEnabled = useAppStore((s) => s.settings.voiceOutputEnabled);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const tts = useTts();
  const voiceOn = voiceOutputEnabled && voiceAutoplay;

  const toggleVoice = () => {
    const next = !voiceOn;
    if (!next) tts.stop();
    updateSettings({ voiceOutputEnabled: next, voiceAutoplay: next });
  };

  const driver = useAvatarDriver();
  const liveVoice = useLiveVoice();

  if (!enabled) return null;

  const statusLabel =
    driver.activity === 'speaking'
      ? 'Speaking'
      : driver.activity === 'thinking'
        ? 'Thinking'
        : liveVoice.listening
          ? 'Listening'
          : 'Idle';

  return (
    <aside
      aria-label="Bi-Shop Avatar Panel"
      className="hidden md:flex flex-col w-[290px] h-full shrink-0 overflow-hidden"
      style={{
        background: 'var(--color-sidebar)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderLeft: '1px solid var(--color-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={15} style={{ color: accentColor }} />
          <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--color-text)' }}>
            Bi-Shop Avatar
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
            style={{
              background: `color-mix(in srgb, ${accentColor} 18%, transparent)`,
              color: accentColor,
            }}
          >
            {statusLabel}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleVoice}
            className="p-1 rounded-md cursor-pointer transition-colors"
            style={{ color: voiceOn ? accentColor : 'var(--color-text-secondary)' }}
            title={voiceOn ? 'Auto-speak ON (click to mute)' : 'Auto-speak OFF (click to enable)'}
            aria-label={voiceOn ? 'Mute auto-speak' : 'Enable auto-speak'}
          >
            {voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button
            onClick={() => setEnabled(false)}
            className="p-1 rounded-md cursor-pointer transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Hide Avatar Panel"
            aria-label="Hide Avatar Panel"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Renderer Mode Switcher */}
      <div className="px-3 pt-2.5 shrink-0">
        <div
          className="grid grid-cols-3 gap-1 p-1 rounded-lg"
          style={{ background: 'var(--color-bg-secondary)' }}
        >
          {RENDERER_TABS.map((tab) => {
            const active = renderer === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setRenderer(tab.id)}
                className="py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
                style={{
                  background: active ? 'var(--color-bg-tertiary)' : 'transparent',
                  color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2D Style Selector */}
      {renderer === '2d' && (
        <div className="px-3 pt-2 shrink-0 flex items-center gap-1">
          {STYLE_2D_OPTIONS.map((opt) => {
            const active = style2d === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setStyle2d(opt.id)}
                className="flex-1 py-1 rounded-md text-[11px] cursor-pointer transition-colors"
                style={{
                  background: active
                    ? `color-mix(in srgb, ${accentColor} 18%, transparent)`
                    : 'transparent',
                  color: active ? accentColor : 'var(--color-text-secondary)',
                  border: active
                    ? `1px solid color-mix(in srgb, ${accentColor} 45%, transparent)`
                    : '1px solid var(--color-border)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Avatar Stage */}
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-hidden">
        {renderer === '2d' && (
          <Avatar2DRenderer style2d={style2d} accentColor={accentColor} driver={driver} />
        )}
        {renderer === 'vrm' && (
          <Suspense
            fallback={
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Loading 3D engine...
              </div>
            }
          >
            <AvatarVrmRenderer
              modelUrl={vrmModelUrl}
              modelName={vrmModelName}
              accentColor={accentColor}
              driver={driver}
              onSelectFile={(file) => {
                const url = URL.createObjectURL(file);
                setVrmModel(url, file.name);
              }}
              onSetUrl={(url) => setVrmModel(url, url.split('/').pop() || 'Remote VRM')}
            />
          </Suspense>
        )}
        {renderer === 'live2d' && (
          <Suspense
            fallback={
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Loading Live2D slot...
              </div>
            }
          >
            <AvatarLive2DRenderer
              modelUrl={live2dModelUrl}
              sdkUrl={live2dSdkUrl}
              accentColor={accentColor}
              driver={driver}
              onSetModelUrl={setLive2dModelUrl}
              onSetSdkUrl={setLive2dSdkUrl}
            />
          </Suspense>
        )}
      </div>

      {/* Footer Controls: Live Talk + Expression + Accent Color */}
      <div
        className="px-3 py-2.5 flex flex-col gap-2 shrink-0"
        style={{ borderTop: '1px solid var(--color-border)' }}
      >
        {/* Hands-Free Live Talk Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={liveVoice.toggle}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
            style={{
              background: liveVoice.active ? '#ef4444' : accentColor,
              color: liveVoice.active ? '#ffffff' : '#0f172a',
            }}
            title="Start or stop hands-free back-and-forth voice conversation"
          >
            {liveVoice.active ? <MicOff size={13} /> : <Mic size={13} />}
            <span>
              {liveVoice.active
                ? liveVoice.listening
                  ? 'Listening… (Stop)'
                  : 'Live Talk On (Stop)'
                : 'Live Talk'}
            </span>
          </button>
          {tts.isSpeaking && (
            <button
              onClick={tts.stop}
              className="p-1.5 rounded-lg cursor-pointer"
              style={{
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
              }}
              title="Interrupt Bi-Shop"
              aria-label="Interrupt Bi-Shop"
            >
              <Square size={12} />
            </button>
          )}
        </div>

        {(liveVoice.transcript || liveVoice.error) && (
          <div
            className="px-2 py-1 rounded text-[11px] truncate"
            style={{
              background: 'var(--color-bg-secondary)',
              color: liveVoice.error ? 'var(--color-error)' : 'var(--color-text-secondary)',
            }}
          >
            {liveVoice.error ?? `"${liveVoice.transcript}"`}
          </div>
        )}

        <div className="flex items-center gap-1">
          {EXPRESSION_OPTIONS.map((opt) => {
            const active = expressionOverride === opt.id;
            return (
              <button
                key={opt.label}
                onClick={() => setExpressionOverride(opt.id)}
                className="flex-1 py-1 rounded text-[10px] cursor-pointer transition-colors"
                style={{
                  background: active ? 'var(--color-bg-tertiary)' : 'transparent',
                  color: active ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            Accent
          </span>
          <div className="flex items-center gap-1.5">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                onClick={() => setAccentColor(swatch)}
                aria-label={`Set avatar accent ${swatch}`}
                className="w-4 h-4 rounded-full cursor-pointer transition-transform"
                style={{
                  background: swatch,
                  transform: accentColor === swatch ? 'scale(1.2)' : 'scale(1)',
                  outline: accentColor === swatch ? '2px solid var(--color-text)' : 'none',
                  outlineOffset: '1px',
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
