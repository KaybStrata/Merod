import { MEROD_MARK_PATH, MEROD_MARK_VIEWBOX, MEROD_SKY } from "./logo-path";

/** Merod logo: the sky-blue mark slowly pulses with a bright glow, forever. Mark only, no wordmark. */
export function Logo(_props: { compact?: boolean } = {}) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="40" height="30" viewBox={MEROD_MARK_VIEWBOX} className="logo-pulse overflow-visible" role="img" aria-label="Merod">
        <path d={MEROD_MARK_PATH} fill="none" stroke={MEROD_SKY} strokeWidth="64" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}
