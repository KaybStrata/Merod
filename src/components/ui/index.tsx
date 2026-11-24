"use client";
import clsx from "clsx";
import { X, Loader2 } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";

export const cx = clsx;

export function Card({ className, children, title, action, icon, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; icon?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel/80 backdrop-blur-sm", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">{icon}{title}</h2>
          {action}
        </header>
      )}
      <div className={cx(pad && "px-4 pb-4", !title && pad && "pt-4")}>{children}</div>
    </section>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "outline";
export function Button({ variant = "secondary", size = "md", loading, className, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent",
        size === "sm" && "h-8 px-3 text-xs", size === "md" && "h-9 px-3.5 text-sm", size === "lg" && "h-11 px-5 text-sm",
        variant === "primary" && "bg-grad text-white shadow-sm",
        variant === "secondary" && "bg-panel-2 text-text border border-line hover:border-line-2",
        variant === "outline" && "border border-accent/50 text-accent-2 hover:bg-accent-soft",
        variant === "ghost" && "text-muted hover:text-text hover:bg-panel-2",
        variant === "danger" && "bg-down text-white hover:opacity-90",
        variant === "success" && "bg-up text-[#04130d] hover:opacity-90",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children, className, title }: { tone?: "neutral" | "accent" | "up" | "down" | "warn" | "info"; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap",
      tone === "neutral" && "bg-panel-2 text-muted border border-line", tone === "accent" && "bg-accent-soft text-accent-2",
      tone === "up" && "bg-up-soft text-up", tone === "down" && "bg-down-soft text-down", tone === "warn" && "bg-warn-soft text-warn",
      tone === "info" && "bg-[rgba(74,168,255,.12)] text-[#4aa8ff]", className)}>{children}</span>
  );
}

/** Labels where a price came from. Simulated/delayed data is always visibly marked. */
export function SourceBadge({ source }: { source?: string | null }) {
  if (!source) return <Badge tone="neutral">No data</Badge>;
  if (source === "simulated") return <Badge tone="warn" title="Simulated price feed for paper trading. Connect a market-data provider for real prices.">Simulated</Badge>;
  if (source.endsWith(":iex")) return <Badge tone="info" title="Alpaca IEX feed — real-time for IEX only">IEX</Badge>;
  if (source.endsWith(":delayed")) return <Badge tone="warn">Delayed</Badge>;
  return <Badge tone="up" title={`Live data from ${source}`}>Live · {source}</Badge>;
}
export function PaperBadge({ paper = true }: { paper?: boolean }) {
  return paper ? <Badge tone="warn" title="Simulated trading with virtual funds">PAPER</Badge> : <Badge tone="down">REAL MONEY</Badge>;
}

export function Stat({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="text-xs text-muted">{label}</div>
      <div className="num mt-0.5 truncate text-lg font-semibold text-text">{value}</div>
      {sub && <div className="num text-xs">{sub}</div>}
    </div>
  );
}

export function Sparkline({ data, width = 96, height = 28, up, className, fill = true }: { data: number[]; width?: number; height?: number; up?: boolean; className?: string; fill?: boolean }) {
  if (!data || data.length < 2) return <svg width={width} height={height} className={className} aria-hidden />;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const isUp = up ?? data[data.length - 1] >= data[0];
  const color = isUp ? "var(--up)" : "var(--down)";
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {fill && <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".28" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>}
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Pills<T extends string>({ value, onChange, options, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: "sm" | "md" }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-line bg-bg-2/60 p-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cx("rounded-lg font-medium transition-colors", size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === o.value ? "bg-grad text-white" : "text-muted hover:text-text")}>{o.label}</button>
      ))}
    </div>
  );
}

export function Input({ label, hint, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx("block", className)}>
      {label && <span className="mb-1 block text-xs font-medium text-muted">{label}</span>}
      <input {...p} className="h-10 w-full rounded-xl border border-line bg-bg-2 px-3 text-sm text-text placeholder:text-faint outline-none focus:border-accent" />
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}
export function Select({ label, className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode }) {
  return (
    <label className={cx("block", className)}>
      {label && <span className="mb-1 block text-xs font-medium text-muted">{label}</span>}
      <select {...p} className="h-10 w-full rounded-xl border border-line bg-bg-2 px-3 text-sm text-text outline-none focus:border-accent">{children}</select>
    </label>
  );
}
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm", disabled && "opacity-50 cursor-not-allowed")}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 rounded-full transition-colors", checked ? "bg-accent" : "bg-line-2")}>
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white transition-all", checked ? "left-4.5" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={cx("fade-up max-h-[92vh] w-full overflow-auto rounded-t-2xl border border-line bg-panel sm:rounded-xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-panel px-5 py-3.5">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-panel-2 hover:text-text" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-8 text-center">
      {icon && <div className="text-faint">{icon}</div>}
      <div className="text-sm font-medium text-text">{title}</div>
      {children && <div className="max-w-sm text-xs text-muted">{children}</div>}
      {action}
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) { return <div className={cx("animate-pulse rounded-lg bg-panel-2", className)} />; }

export function StatusPill({ status }: { status: string }) {
  const t: Record<string, "up" | "down" | "warn" | "accent" | "neutral" | "info"> = {
    filled: "up", running: "up", executed: "up", approved: "up", sandbox_connected: "up", production_connected: "up", connected: "up",
    rejected: "down", failed: "down", error: "down", connection_error: "down", halted: "down", restricted: "down",
    pending_approval: "warn", needs_approval: "warn", awaiting_approval: "warn", paused: "warn", unknown: "warn", testing: "info",
    submitted: "info", partially_filled: "info", validated: "info", credentials_configured: "accent", draft: "neutral",
  };
  return <Badge tone={t[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

/* ───────── Toasts ───────── */
type Toast = { id: number; text: string; tone: "up" | "down" | "neutral" };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "neutral") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx("fade-up pointer-events-auto rounded-xl border bg-panel px-4 py-3 text-sm shadow-xl",
            t.tone === "up" ? "border-up/40" : t.tone === "down" ? "border-down/40" : "border-line")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function ChangeText({ value, className }: { value: number | null | undefined; className?: string }) {
  const v = value == null ? null : Number(value);
  return <span className={cx("num", v == null || v === 0 ? "text-muted" : v > 0 ? "text-up" : "text-down", className)}>{v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}</span>;
}

export function AssetIcon({ symbol, size = 28, logo }: { symbol: string; size?: number; logo?: string | null }) {
  const palette = ["#14c3bb", "#22c993", "#f5b84a", "#4aa8ff", "#f0506e", "#c084fc", "#2dd4bf"];
  const c = palette[[...symbol].reduce((a, ch) => a + ch.charCodeAt(0), 0) % palette.length];
  if (logo) return <img src={logo} alt="" width={size} height={size} className="rounded-full" />;
  return (
    <span style={{ width: size, height: size, background: `${c}22`, color: c, fontSize: size * 0.36 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold">{symbol.slice(0, 3)}</span>
  );
}
