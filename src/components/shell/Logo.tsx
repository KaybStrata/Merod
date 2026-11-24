import { MEROD_MARK_PATH, MEROD_MARK_VIEWBOX, MEROD_SKY } from "./logo-path";

/**
 * Merod logo (mark only). A blinding sky-blue glow pulses slowly forever: a wide bloom, a bright
 * inner glow and a near-white hot core, all drawn in the SVG so the light isn't clipped or dimmed.
 */
export function Logo(_props: { compact?: boolean } = {}) {
  const id = "merod-logo"; // identical filter definitions, so repeated ids are harmless
  return (
    <span className="relative inline-flex items-center p-1">
      <svg width="44" height="33" viewBox={MEROD_MARK_VIEWBOX} className="overflow-visible" role="img" aria-label="Merod">
        <defs>
          <filter id={`${id}-bloom`} x="-150%" y="-150%" width="400%" height="400%"><feGaussianBlur stdDeviation="150" /></filter>
          <filter id={`${id}-glow`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="55" /></filter>
          <filter id={`${id}-haze`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="24" /></filter>
        </defs>
        <g className="logo-bloom">
          <path d={MEROD_MARK_PATH} fill="none" stroke="#0bb8ff" strokeWidth="220" strokeLinejoin="round" filter={`url(#${id}-bloom)`} />
          <path d={MEROD_MARK_PATH} fill="none" stroke="#38bdf8" strokeWidth="140" strokeLinejoin="round" filter={`url(#${id}-glow)`} />
          <path d={MEROD_MARK_PATH} fill="none" stroke="#bae6fd" strokeWidth="90" strokeLinejoin="round" filter={`url(#${id}-haze)`} />
        </g>
        <path d={MEROD_MARK_PATH} fill="none" stroke={MEROD_SKY} strokeWidth="64" strokeLinejoin="round" />
        <path className="logo-core" d={MEROD_MARK_PATH} fill="none" stroke="#e0f7ff" strokeWidth="22" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
