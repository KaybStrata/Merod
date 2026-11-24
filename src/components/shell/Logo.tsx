export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
        <defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#14c3bb" /><stop offset="1" stopColor="#ff8a3d" /></linearGradient></defs>
        <rect width="32" height="32" rx="9" fill="url(#mg)" />
        <path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <span className="text-[17px] font-semibold tracking-tight text-text">Merod</span>}
    </span>
  );
}
