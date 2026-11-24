export const usd = (n: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}) => {
  if (n == null || Number.isNaN(n)) return "—";
  const v = Number(n);
  const s = opts.compact && Math.abs(v) >= 1e4
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(v)
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: Math.abs(v) < 1 && v !== 0 ? 6 : 2 }).format(v);
  return opts.sign && v > 0 ? `+${s}` : s;
};
export const price = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Number(n);
  if (v === 0) return "$0.00";
  if (Math.abs(v) < 0.01) return `$${v.toPrecision(4)}`;
  return usd(v);
};
export const pct = (n: number | null | undefined, digits = 2) => (n == null ? "—" : `${Number(n) > 0 ? "+" : ""}${Number(n).toFixed(digits)}%`);
export const qty = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Number(n);
  return v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : v >= 1 ? v.toLocaleString("en-US", { maximumFractionDigits: 4 }) : v.toPrecision(4);
};
export const compact = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Number(n)));
export const ago = (d: string | number | Date | null | undefined) => {
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const tone = (n: number | null | undefined) => (n == null || Number(n) === 0 ? "text-muted" : Number(n) > 0 ? "text-up" : "text-down");
