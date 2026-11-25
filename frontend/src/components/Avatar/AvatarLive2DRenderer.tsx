import { useState } from 'react';
import { Sparkles, ExternalLink } from 'lucide-react';
import type { AvatarDriverState } from '../../hooks/useAvatarDriver';

interface AvatarLive2DRendererProps {
  modelUrl: string;
  sdkUrl: string;
  accentColor: string;
  driver: AvatarDriverState;
  onSetModelUrl: (url: string) => void;
  onSetSdkUrl: (url: string) => void;
}

/**
 * Live2D Cubism renderer slot.
 * Because Live2D Cubism Core is proprietary, OpenJarvis keeps the repository
 * Apache-2.0 clean and lets users point to their own Cubism Core script +
 * `.model3.json` model URL (e.g. served locally or from Open-LLM-VTuber).
 */
export function AvatarLive2DRenderer({
  modelUrl,
  sdkUrl,
  accentColor,
  driver,
  onSetModelUrl,
  onSetSdkUrl,
}: AvatarLive2DRendererProps) {
  const [localModel, setLocalModel] = useState(modelUrl);
  const [localSdk, setLocalSdk] = useState(sdkUrl);
  const hasCubismCore = typeof window !== 'undefined' && 'Live2DCubismCore' in window;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-2.5">
      <div
        className="w-full flex-1 min-h-[175px] rounded-xl border border-dashed flex flex-col items-center justify-center p-4 text-center gap-2"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
      >
        <Sparkles size={26} style={{ color: accentColor }} />
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
          Live2D Cubism Slot
        </p>
        <p className="text-[11px] leading-relaxed">
          {hasCubismCore && modelUrl
            ? `Cubism Core detected — ready to drive ${modelUrl} (mouth: ${Math.round(driver.mouthOpen * 100)}%).`
            : 'Provide your Live2D Cubism Core script & .model3.json URL to render a Live2D VTuber model directly inside Bi-Shop.'}
        </p>
        <a
          href="https://www.live2d.com/en/sdk/download/web/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] underline"
          style={{ color: accentColor }}
        >
          <span>Live2D Web SDK</span>
          <ExternalLink size={11} />
        </a>
      </div>

      <form
        className="w-full flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          onSetModelUrl(localModel.trim());
          onSetSdkUrl(localSdk.trim());
        }}
      >
        <input
          type="text"
          value={localModel}
          onChange={(e) => setLocalModel(e.target.value)}
          placeholder="Model URL (e.g. /live2d/shizuku.model3.json)"
          className="w-full px-2 py-1 rounded-md text-[11px]"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
        <input
          type="text"
          value={localSdk}
          onChange={(e) => setLocalSdk(e.target.value)}
          placeholder="Cubism Core JS URL (optional)"
          className="w-full px-2 py-1 rounded-md text-[11px]"
          style={{
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        />
        <button
          type="submit"
          className="w-full px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
          style={{ background: accentColor, color: '#0f172a' }}
        >
          Save Live2D Config
        </button>
      </form>
    </div>
  );
}
