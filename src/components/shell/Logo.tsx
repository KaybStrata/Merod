import { MEROD_MARK_PATH, MEROD_MARK_VIEWBOX } from "./logo-path";

/**
 * Merod logo: the champagne mark with a slow, endless, blinding gold glow pulse (bloom, inner glow and a
 * near-white hot core, all drawn inside the SVG so the light isn't clipped), plus the ivory wordmark.
 */
export function Logo({ compact = false }: { compact?: boolean } = {}) {
  const id = "merod-logo"; // identical filter definitions, so repeated ids are harmless
  return (
    <span className="relative inline-flex items-center gap-2.5 p-1">
      <svg width="40" height="30" viewBox={MEROD_MARK_VIEWBOX} className="overflow-visible" role="img" aria-label="Merod">
        <defs>
          <filter id={`${id}-bloom`} x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="150" /></filter>
          <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="55" /></filter>
          <filter id={`${id}-haze`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="24" /></filter>
          <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f6e7c8" /><stop offset="0.5" stopColor="#dcbb84" /><stop offset="1" stopColor="#b48c56" /></linearGradient>
        </defs>
        <g className="logo-bloom">
          <path d={MEROD_MARK_PATH} fill="none" stroke="#c4964f" strokeWidth="220" strokeLinejoin="round" filter={`url(#${id}-bloom)`} />
          <path d={MEROD_MARK_PATH} fill="none" stroke="#e0be82" strokeWidth="140" strokeLinejoin="round" filter={`url(#${id}-glow)`} />
          <path d={MEROD_MARK_PATH} fill="none" stroke="#f6e3bd" strokeWidth="90" strokeLinejoin="round" filter={`url(#${id}-haze)`} />
        </g>
        <path d={MEROD_MARK_PATH} fill="none" stroke={`url(#${id}-gold)`} strokeWidth="60" strokeLinejoin="round" />
        <path className="logo-core" d={MEROD_MARK_PATH} fill="none" stroke="#fffaf0" strokeWidth="20" strokeLinejoin="round" />
      </svg>
      {!compact && <span className="text-[1.65rem] font-medium tracking-tight text-text">Merod</span>}
    </span>
  );
}
