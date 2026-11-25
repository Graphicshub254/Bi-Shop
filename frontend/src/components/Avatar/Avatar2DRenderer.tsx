import type { Avatar2DStyle } from '../../lib/avatar-store';
import type { AvatarDriverState } from '../../hooks/useAvatarDriver';

interface Avatar2DRendererProps {
  style2d: Avatar2DStyle;
  accentColor: string;
  driver: AvatarDriverState;
}

function HologramAvatar({ accentColor, driver }: { accentColor: string; driver: AvatarDriverState }) {
  const { activity, mouthOpen, breath } = driver;
  const coreScale = 1 + breath * 0.03 + mouthOpen * 0.14;
  const ringSpeed = activity === 'thinking' ? '3.5s' : activity === 'speaking' ? '6s' : '18s';
  const bars = [0.45, 0.8, 1.0, 0.85, 0.55, 0.9, 0.5];

  return (
    <svg viewBox="0 0 240 240" className="w-full h-full max-w-[230px] max-h-[230px] select-none" role="img" aria-label="Bi-Shop Hologram Avatar">
      <defs>
        <radialGradient id="jarvisCoreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accentColor} stopOpacity="0.9" />
          <stop offset="55%" stopColor={accentColor} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accentColor} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ambient halo */}
      <circle cx="120" cy="120" r={95 + mouthOpen * 10} fill="url(#jarvisCoreGlow)" opacity={0.45 + mouthOpen * 0.35} />

      {/* Outer dashed orbital ring */}
      <g style={{ transformOrigin: '120px 120px', animation: `spin ${ringSpeed} linear infinite` }}>
        <circle
          cx="120"
          cy="120"
          r="86"
          fill="none"
          stroke={accentColor}
          strokeWidth="1.5"
          strokeDasharray="10 8 3 8"
          opacity="0.65"
        />
      </g>

      {/* Counter-rotating inner tech ring */}
      <g style={{ transformOrigin: '120px 120px', animation: `spin ${ringSpeed} linear infinite reverse` }}>
        <circle
          cx="120"
          cy="120"
          r="68"
          fill="none"
          stroke={accentColor}
          strokeWidth="2.5"
          strokeDasharray="28 14 8 14"
          opacity="0.85"
        />
      </g>

      {/* Core sphere */}
      <g style={{ transform: `translate(120px, 120px) scale(${coreScale}) translate(-120px, -120px)` }}>
        <circle cx="120" cy="120" r="44" fill={accentColor} fillOpacity="0.16" stroke={accentColor} strokeWidth="2" />
        <circle cx="120" cy="120" r="28" fill={accentColor} fillOpacity="0.25" />

        {/* Voice-reactive equalizer bars */}
        {bars.map((weight, i) => {
          const x = 90 + i * 10;
          const baseH = activity === 'thinking' ? 10 + Math.abs(Math.sin(breath * 3 + i)) * 12 : 6;
          const h = baseH + mouthOpen * weight * 30;
          return (
            <rect
              key={i}
              x={x - 2}
              y={120 - h / 2}
              width="4"
              height={h}
              rx="2"
              fill={accentColor}
              opacity={0.75 + mouthOpen * 0.25}
            />
          );
        })}
      </g>
    </svg>
  );
}

function AnimeAvatar({ accentColor, driver }: { accentColor: string; driver: AvatarDriverState }) {
  const { activity, expression, mouthOpen, blink, breath } = driver;
  const bobY = breath * 3;
  const eyeScaleY = Math.max(0.08, 1 - blink);
  const mouthHeight = activity === 'speaking' ? 4 + mouthOpen * 16 : expression === 'surprised' ? 11 : 3;
  const mouthWidth = activity === 'speaking' ? 18 + mouthOpen * 8 : expression === 'happy' ? 24 : 16;

  return (
    <svg viewBox="0 0 240 260" className="w-full h-full max-w-[230px] max-h-[250px] select-none" role="img" aria-label="Anime Companion Avatar">
      <defs>
        <linearGradient id="animeHair" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        <linearGradient id="animeJacket" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>

      {/* Soft aura behind character */}
      <circle cx="120" cy="128" r={88 + mouthOpen * 6} fill={accentColor} opacity={activity === 'thinking' ? 0.2 : 0.1} />

      <g transform={`translate(0, ${bobY.toFixed(2)})`}>
        {/* Back hair */}
        <path d="M58 118 C52 178, 62 215, 76 226 L164 226 C178 215, 188 178, 182 118 C178 62, 152 40, 120 40 C88 40, 62 62, 58 118 Z" fill="url(#animeHair)" />

        {/* Shoulders / collar */}
        <path d="M58 244 C64 205, 88 194, 120 194 C152 194, 176 205, 182 244 Z" fill="url(#animeJacket)" stroke={accentColor} strokeWidth="1.5" strokeOpacity="0.6" />
        <path d="M104 196 L120 218 L136 196" fill="none" stroke={accentColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

        {/* Neck */}
        <rect x="108" y="172" width="24" height="28" rx="10" fill="#fde2cc" />

        {/* Face */}
        <path d="M76 112 C76 76, 94 62, 120 62 C146 62, 164 76, 164 112 C164 152, 144 178, 120 180 C96 178, 76 152, 76 112 Z" fill="#ffead9" />

        {/* Blush */}
        <ellipse cx="90" cy="138" rx="9" ry="4.5" fill="#fb7185" opacity={expression === 'happy' ? 0.35 : 0.18} />
        <ellipse cx="150" cy="138" rx="9" ry="4.5" fill="#fb7185" opacity={expression === 'happy' ? 0.35 : 0.18} />

        {/* Left & Right Eyes */}
        {[97, 143].map((cx, idx) => (
          <g key={idx} transform={`translate(${cx}, 122) scale(1, ${eyeScaleY.toFixed(3)})`}>
            <ellipse cx="0" cy="0" rx="11" ry="13" fill="#ffffff" />
            <ellipse cx="0" cy="1" rx="7.5" ry="10" fill={accentColor} />
            <circle cx="0" cy="2" r="4.2" fill="#0f172a" />
            <circle cx="-3" cy="-3.5" r="2.8" fill="#ffffff" />
            <circle cx="3" cy="4" r="1.4" fill="#ffffff" opacity="0.85" />
            <path d="M-12 -8 Q0 -16 12 -8" fill="none" stroke="#0f172a" strokeWidth="2.8" strokeLinecap="round" />
          </g>
        ))}

        {/* Eyebrows */}
        <path
          d={expression === 'thinking' ? 'M84 102 Q97 97 108 103' : 'M84 103 Q97 98 108 102'}
          fill="none"
          stroke="#1e293b"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d={expression === 'thinking' ? 'M132 100 Q143 93 156 99' : 'M132 102 Q143 98 156 103'}
          fill="none"
          stroke="#1e293b"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Nose */}
        <path d="M120 134 L118 140 L121 141" fill="none" stroke="#d4a285" strokeWidth="1.5" strokeLinecap="round" />

        {/* Mouth */}
        {activity === 'speaking' || expression === 'surprised' ? (
          <ellipse
            cx="120"
            cy={154 + mouthHeight * 0.15}
            rx={mouthWidth / 2}
            ry={mouthHeight / 2}
            fill="#9f1239"
            stroke="#4c0519"
            strokeWidth="1.5"
          />
        ) : expression === 'happy' ? (
          <path d="M108 152 Q120 163 132 152" fill="none" stroke="#7c2d12" strokeWidth="2.4" strokeLinecap="round" />
        ) : (
          <path d="M112 154 Q120 158 128 154" fill="none" stroke="#7c2d12" strokeWidth="2.2" strokeLinecap="round" />
        )}

        {/* Front bangs + tech hair clip */}
        <path
          d="M66 108 C68 62, 92 44, 120 44 C148 44, 172 62, 174 108 C164 88, 154 78, 145 96 C138 78, 126 72, 120 94 C112 72, 100 78, 94 96 C86 78, 76 88, 66 108 Z"
          fill="url(#animeHair)"
        />
        <rect x="148" y="74" width="14" height="4.5" rx="2.2" transform="rotate(24 155 76)" fill={accentColor} />

        {/* Thinking indicator dots */}
        {activity === 'thinking' && (
          <g fill={accentColor}>
            <circle cx="176" cy="72" r="3" opacity="0.5" />
            <circle cx="185" cy="64" r="4" opacity="0.75" />
            <circle cx="196" cy="54" r="5" opacity="0.95" />
          </g>
        )}
      </g>
    </svg>
  );
}

function MinimalAvatar({ accentColor, driver }: { accentColor: string; driver: AvatarDriverState }) {
  const { activity, expression, mouthOpen, blink, breath } = driver;
  const eyeH = Math.max(2, 16 * (1 - blink));
  const mouthW = 28 + mouthOpen * 22;
  const mouthH = activity === 'speaking' ? 5 + mouthOpen * 16 : 4;

  return (
    <svg viewBox="0 0 240 240" className="w-full h-full max-w-[210px] max-h-[210px] select-none" role="img" aria-label="Minimalist Expressive Avatar">
      <g transform={`translate(0, ${(breath * 3).toFixed(2)})`}>
        <rect
          x="36"
          y="40"
          width="168"
          height="160"
          rx="42"
          fill="var(--color-bg-secondary)"
          stroke={accentColor}
          strokeWidth={activity === 'speaking' ? 2.5 : 1.5}
          strokeOpacity={activity === 'idle' ? 0.5 : 0.95}
        />

        {/* Eyes */}
        <rect x="76" y={102 - eyeH / 2} width="22" height={eyeH} rx="8" fill={accentColor} />
        <rect x="142" y={102 - eyeH / 2} width="22" height={eyeH} rx="8" fill={accentColor} />

        {/* Mouth */}
        {expression === 'happy' && activity !== 'speaking' ? (
          <path d="M96 146 Q120 162 144 146" fill="none" stroke={accentColor} strokeWidth="4" strokeLinecap="round" />
        ) : (
          <rect
            x={120 - mouthW / 2}
            y={148 - mouthH / 2}
            width={mouthW}
            height={mouthH}
            rx={mouthH / 2}
            fill={accentColor}
            opacity="0.9"
          />
        )}
      </g>
    </svg>
  );
}

export function Avatar2DRenderer({ style2d, accentColor, driver }: Avatar2DRendererProps) {
  return (
    <div className="w-full h-full flex items-center justify-center p-2">
      {style2d === 'hologram' && <HologramAvatar accentColor={accentColor} driver={driver} />}
      {style2d === 'anime' && <AnimeAvatar accentColor={accentColor} driver={driver} />}
      {style2d === 'minimal' && <MinimalAvatar accentColor={accentColor} driver={driver} />}
    </div>
  );
}
