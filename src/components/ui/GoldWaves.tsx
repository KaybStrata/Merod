/** Flowing champagne light lines for page headers (decorative; no planetary imagery). */
export function GoldWaves({ className = "" }: { className?: string }) {
  const lines = Array.from({ length: 14 }, (_, i) => i);
  return (
    <svg aria-hidden className={`pointer-events-none absolute select-none ${className}`} viewBox="0 0 900 260" preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id="gw-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d6b37a" stopOpacity="0" /><stop offset="0.35" stopColor="#e6c896" stopOpacity="0.55" />
          <stop offset="0.7" stopColor="#f6e7c8" stopOpacity="0.9" /><stop offset="1" stopColor="#d6b37a" stopOpacity="0.1" />
        </linearGradient>
        <filter id="gw-blur"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <g className="gold-waves">
        {lines.map((i) => (
          <path key={i} d={`M0 ${190 - i * 3} C 220 ${60 + i * 6}, 420 ${250 - i * 4}, 620 ${120 + i * 3} S 860 ${40 + i * 5}, 900 ${70 + i * 4}`}
            stroke="url(#gw-fade)" strokeWidth={i === 6 ? 1.6 : 0.6} opacity={0.25 + (i % 5) * 0.08} className={i === 6 || i === 9 ? "w-bright" : undefined} />
        ))}
        <path d="M0 172 C 220 96, 420 226, 620 138 S 860 70, 900 94" stroke="#fff4dc" strokeWidth="3" opacity="0.5" filter="url(#gw-blur)" className="w-bright" />
      </g>
    </svg>
  );
}
