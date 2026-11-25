import { useEffect, useRef, useState } from 'react';
import { Upload, Box, AlertCircle } from 'lucide-react';
import type { AvatarDriverState } from '../../hooks/useAvatarDriver';

interface AvatarVrmRendererProps {
  modelUrl: string;
  modelName: string;
  accentColor: string;
  driver: AvatarDriverState;
  onSelectFile: (file: File) => void;
  onSetUrl: (url: string) => void;
}

export function AvatarVrmRenderer({
  modelUrl,
  modelName,
  accentColor,
  driver,
  onSelectFile,
  onSetUrl,
}: AvatarVrmRendererProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const driverRef = useRef(driver);
  driverRef.current = driver;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(modelUrl.startsWith('blob:') ? '' : modelUrl);

  useEffect(() => {
    if (!modelUrl || !containerRef.current) return;

    let cancelled = false;
    let rafId = 0;
    let cleanup: (() => void) | undefined;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');

        if (cancelled || !containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth || 260;
        const height = container.clientHeight || 260;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 20);
        camera.position.set(0, 1.38, 1.65);
        camera.lookAt(0, 1.32, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
        keyLight.position.set(1.2, 2.0, 2.0);
        scene.add(keyLight);
        scene.add(new THREE.AmbientLight(0xffffff, 0.7));

        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        const gltf = await loader.loadAsync(modelUrl);
        if (cancelled) {
          renderer.dispose();
          return;
        }

        const vrm = gltf.userData.vrm;
        if (!vrm) {
          throw new Error('Selected file is not a valid VRM model.');
        }

        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        vrm.scene.rotation.y = Math.PI;
        scene.add(vrm.scene);

        setLoading(false);

        const clock = new THREE.Clock();
        const resizeObserver = new ResizeObserver(() => {
          if (!containerRef.current) return;
          const w = containerRef.current.clientWidth || 260;
          const h = containerRef.current.clientHeight || 260;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        });
        resizeObserver.observe(container);

        const animate = () => {
          rafId = requestAnimationFrame(animate);
          const delta = clock.getDelta();
          const d = driverRef.current;

          if (vrm.expressionManager) {
            vrm.expressionManager.setValue('aa', d.mouthOpen);
            vrm.expressionManager.setValue('blink', d.blink);
            vrm.expressionManager.setValue('happy', d.expression === 'happy' ? 0.55 : 0);
            vrm.expressionManager.setValue('surprised', d.expression === 'surprised' ? 0.7 : 0);
          }

          if (vrm.humanoid) {
            const head = vrm.humanoid.getNormalizedBoneNode('head');
            if (head) {
              head.rotation.y = d.breath * 0.05;
              head.rotation.x = d.activity === 'thinking' ? -0.06 : d.breath * 0.02;
            }
          }

          vrm.update(delta);
          renderer.render(scene, camera);
        };
        animate();

        cleanup = () => {
          cancelAnimationFrame(rafId);
          resizeObserver.disconnect();
          renderer.dispose();
          if (containerRef.current) containerRef.current.innerHTML = '';
        };
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setError(err instanceof Error ? err.message : 'Failed to load VRM model.');
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      cleanup?.();
    };
  }, [modelUrl]);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-3 gap-2">
      {modelUrl ? (
        <div className="relative w-full flex-1 min-h-[200px] rounded-xl overflow-hidden" style={{ background: 'var(--color-bg-secondary)' }}>
          <div ref={containerRef} className="w-full h-full" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Loading VRM model...
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center text-xs gap-1.5" style={{ color: 'var(--color-error)' }}>
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}
          {modelName && !loading && !error && (
            <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded text-[10px] truncate max-w-[85%]" style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}>
              {modelName}
            </div>
          )}
        </div>
      ) : (
        <div
          className="w-full flex-1 min-h-[180px] rounded-xl border border-dashed flex flex-col items-center justify-center p-4 text-center gap-2"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          <Box size={28} style={{ color: accentColor }} />
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
            VRM 3D VTuber Ready
          </p>
          <p className="text-[11px] leading-relaxed">
            Load any <code>.vrm</code> avatar (from VRoid Studio or VRoid Hub) for 3D blinking & lip-sync.
          </p>
        </div>
      )}

      <div className="w-full flex flex-col gap-1.5">
        <label
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
          style={{ background: accentColor, color: '#0f172a' }}
        >
          <Upload size={13} />
          <span>{modelUrl ? 'Switch .vrm file' : 'Load local .vrm file'}</span>
          <input
            type="file"
            accept=".vrm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onSelectFile(file);
            }}
          />
        </label>

        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (urlInput.trim()) onSetUrl(urlInput.trim());
          }}
        >
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Or paste .vrm URL..."
            className="flex-1 min-w-0 px-2 py-1 rounded-md text-[11px]"
            style={{
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}
          />
          <button
            type="submit"
            className="px-2 py-1 rounded-md text-[11px] cursor-pointer"
            style={{
              background: 'var(--color-bg-tertiary)',
              color: 'var(--color-text)',
            }}
          >
            Load
          </button>
        </form>
      </div>
    </div>
  );
}
