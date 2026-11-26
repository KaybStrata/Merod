"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Radar, ShieldCheck, ShieldAlert, ShieldQuestion, Zap, ExternalLink, Search, Pause, Play, CandlestickChart, Loader2 } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { usePageTitle, useShell } from "@/components/shell/context";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { AccountPicker } from "@/components/wallet/AccountPicker";
import { signOrderWithWallet } from "@/components/wallet/SolanaWallets";
import { MimicTokenButton } from "@/components/MimicTokenButton";

type Asset = any;
const STABLES = new Set(["USDC", "USDT", "PYUSD", "USDS", "DAI", "USDE", "EURC", "FDUSD"]);
const compact = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n), a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toFixed(0)}`;
};
const price = (p: number | null | undefined) => (p == null ? "—" : Number(p) >= 1 ? `$${Number(p).toFixed(4)}` : `$${Number(p).toPrecision(4)}`);
const ageMs = (a: Asset) => (a.launched_at ? Date.now() - +new Date(a.launched_at) : null);
const ageLabel = (a: Asset) => {
  const m = ageMs(a);
  if (m == null) return "—";
  const min = m / 60000;
  return min < 60 ? `${Math.max(1, Math.round(min))}m` : min < 1440 ? `${Math.round(min / 60)}h` : `${Math.round(min / 1440)}d`;
};

/**
 * Merod safety score (0–100). Computed only from what Merod actually knows about the token: its data source's risk
 * flags, liquidity, liquidity vs market cap, age, launch stage and price freshness. A heuristic, not an audit.
 */
type Check = { label: string; state: "pass" | "warn" | "fail" | "unknown"; note: string };
function safety(a: Asset): { score: number; checks: Check[] } {
  const f = new Set<string>(a.risk_flags ?? []);
  const liq = Number(a.liquidity_usd ?? 0), cap = Number(a.market_cap ?? 0), m = ageMs(a);
  const stale = a.price_updated_at ? Date.now() - +new Date(a.price_updated_at) > 10 * 60_000 : true;
  const checks: Check[] = [
    { label: "Honeypot", state: f.has("honeypot") ? "fail" : "unknown", note: f.has("honeypot") ? "Flagged by the data source" : "Not flagged (not independently verified)" },
    { label: "Mint authority", state: f.has("mint_authority") ? "fail" : "unknown", note: f.has("mint_authority") ? "Flagged: supply can still be minted" : "Not flagged by the data source" },
    { label: "Freeze authority", state: f.has("freeze_authority") ? "fail" : "unknown", note: f.has("freeze_authority") ? "Flagged: holders can be frozen" : "Not flagged by the data source" },
    { label: "Tax", state: f.has("high_tax") ? "fail" : "unknown", note: f.has("high_tax") ? "High buy/sell tax flagged" : "Not flagged" },
    { label: "Liquidity", state: liq >= 100_000 ? "pass" : liq >= 25_000 ? "warn" : "fail", note: liq ? `${compact(liq)} in the pool` : "Unknown" },
    { label: "Liquidity vs market cap", state: !cap || !liq ? "unknown" : liq / cap >= 0.05 ? "pass" : liq / cap >= 0.02 ? "warn" : "fail", note: cap && liq ? `${((liq / cap) * 100).toFixed(1)}% of market cap` : "Unknown" },
    { label: "Age", state: m == null ? "unknown" : m > 24 * 3600_000 ? "pass" : m > 3600_000 ? "warn" : "fail", note: m == null ? "Launch time unknown" : `Launched ${ago(a.launched_at)}` },
    { label: "Launch stage", state: a.lifecycle === "bonding_curve" ? "warn" : a.lifecycle === "graduated" ? "pass" : "unknown", note: a.lifecycle === "bonding_curve" ? "Still on the pump.fun bonding curve" : a.lifecycle === "graduated" ? "Graduated to a DEX pool" : "—" },
    { label: "Verified listing", state: f.has("unverified") ? "warn" : "pass", note: f.has("unverified") ? "Unverified token" : "No unverified flag" },
    { label: "Live price", state: a.price_source === "simulated" ? "fail" : stale ? "warn" : "pass", note: a.price_source === "simulated" ? "Simulated price" : stale ? "Price older than 10 min" : `Fresh from ${a.price_source ?? "provider"}` },
  ];
  let s = 100;
  if (f.has("honeypot")) s -= 60;
  if (f.has("mint_authority")) s -= 25;
  if (f.has("freeze_authority")) s -= 30;
  if (f.has("high_tax")) s -= 30;
  if (f.has("unverified")) s -= 10;
  if (f.has("low_liquidity")) s -= 10;
  if (f.has("demo_data")) s -= 50;
  s -= liq < 10_000 ? 30 : liq < 25_000 ? 20 : liq < 50_000 ? 10 : liq < 100_000 ? 4 : 0;
  if (cap && liq && liq / cap < 0.02) s -= 10;
  if (m != null) s -= m < 3600_000 ? 12 : m < 24 * 3600_000 ? 5 : 0;
  if (a.lifecycle === "bonding_curve") s -= 6;
  if (a.price_source === "simulated") s -= 20; else if (stale) s -= 6;
  return { score: Math.max(0, Math.min(100, Math.round(s))), checks };
}
const scoreTone = (s: number) => (s >= 75 ? "text-up" : s >= 50 ? "text-warn" : "text-down");
const scoreStroke = (s: number) => (s >= 75 ? "var(--up)" : s >= 50 ? "var(--warn)" : "var(--down)");

const FILTERS: { id: string; label: string; test: (a: Asset) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "new", label: "New pairs", test: (a) => { const m = ageMs(a); return m != null && m < 24 * 3600_000; } },
  { id: "graduating", label: "Graduating", test: (a) => a.lifecycle === "bonding_curve" },
  { id: "graduated", label: "Graduated", test: (a) => a.lifecycle === "graduated" },
  { id: "trending", label: "Trending", test: (a) => Number(a.change_24h ?? 0) > 0 && Number(a.volume_24h ?? 0) > 0 },
  { id: "liq", label: "Liq > $50k", test: (a) => Number(a.liquidity_usd ?? 0) >= 50_000 },
  { id: "young", label: "Age < 1h", test: (a) => { const m = ageMs(a); return m != null && m < 3600_000; } },
  { id: "safe", label: "Score ≥ 70", test: (a) => safety(a).score >= 70 },
];
type SortKey = "volume" | "change" | "liq" | "cap" | "age" | "score";

/** Meme radar: live Solana meme coins with honest safety scoring and a one-tap buy through the order engine. */
export default function MemeRadarPage() {
  usePageTitle({ section: "Trade · Solana", title: "Meme radar", accent: "radar" });
  const [paused, setPaused] = useState(false);
  const byVol = useApi<any>(paused ? null : "/api/assets?class=crypto&venue=solana&sort=volume&limit=200", { refreshMs: 15_000 });
  const byNew = useApi<any>(paused ? null : "/api/assets?class=crypto&venue=solana&sort=new&limit=200", { refreshMs: 15_000 });
  const keep = useRef<Asset[]>([]);
  const all: Asset[] = useMemo(() => {
    if (!byVol.data && !byNew.data) return keep.current;
    const m = new Map<string, Asset>();
    for (const a of [...(byVol.data?.assets ?? []), ...(byNew.data?.assets ?? [])]) {
      if (STABLES.has(String(a.symbol).toUpperCase()) || (a.categories ?? []).includes("stablecoin") || (a.risk_flags ?? []).includes("demo_data")) continue;
      m.set(a.id, a);
    }
    return (keep.current = [...m.values()]);
  }, [byVol.data, byNew.data]);
  const [filter, setFilter] = useState("all");
  const [memeOnly, setMemeOnly] = useState(true);
  const [qs, setQs] = useState("");
  const [sort, setSort] = useState<SortKey>("volume");
  const [sel, setSel] = useState<string | null>(null);
  const isMeme = (a: Asset) => (a.categories ?? []).some((c: string) => /meme/i.test(c)) || a.lifecycle != null;
  const f = FILTERS.find((x) => x.id === filter)!;
  const rows = all
    .filter((a) => (!memeOnly || isMeme(a)) && f.test(a) && (!qs || `${a.symbol} ${a.name} ${a.identifier}`.toLowerCase().includes(qs.toLowerCase())))
    .map((a) => ({ a, s: safety(a).score }))
    .sort((x, y) => {
      const v = (r: { a: Asset; s: number }) => sort === "volume" ? Number(r.a.volume_24h ?? -1) : sort === "change" ? Number(r.a.change_24h ?? -1e9) : sort === "liq" ? Number(r.a.liquidity_usd ?? -1) : sort === "cap" ? Number(r.a.market_cap ?? -1) : sort === "score" ? r.s : -(ageMs(r.a) ?? 1e15);
      return v(y) - v(x);
    });
  const selected = all.find((a) => a.id === sel) ?? rows[0]?.a ?? null;
  const counts = Object.fromEntries(FILTERS.map((x) => [x.id, all.filter((a) => (!memeOnly || isMeme(a)) && x.test(a)).length]));
  const th = (k: SortKey, l: string, cls = "text-right") => <th className={cls}><button onClick={() => setSort(k)} className={cx("hover:text-text", sort === k && "text-accent-2")}>{l}{sort === k ? " ↓" : ""}</button></th>;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="surface min-w-0 rounded-2xl p-3.5">
        <header className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-bg-2/60 p-1 text-[12px]">
            {FILTERS.map((x) => (
              <button key={x.id} onClick={() => setFilter(x.id)} className={cx("flex items-center gap-1.5 rounded-lg px-2.5 py-1", filter === x.id ? "nav-active" : "text-muted hover:text-text")}>
                {x.label}<span className="num text-[10.5px] text-faint">{counts[x.id]}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" checked={memeOnly} onChange={(e) => setMemeOnly(e.target.checked)} className="accent-[#d6b37a]" /> Meme coins only</label>
          <div className="relative ml-auto"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" /><input value={qs} onChange={(e) => setQs(e.target.value)} placeholder="Symbol, name or mint…" className="h-8 w-48 rounded-lg border border-line bg-panel-2/60 pl-8 pr-2 text-xs outline-none focus:border-accent/60" /></div>
          <button onClick={() => setPaused(!paused)} className={cx("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px]", paused ? "border-warn/40 text-warn" : "border-up/40 text-up")}>
            {paused ? <><Play className="size-3.5" /> Resume</> : <><span className="size-1.5 rounded-full bg-up pulse-dot" /> Live · 15s</>}
          </button>
        </header>
        <div className="mt-3 max-h-[calc(100vh-230px)] overflow-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-panel text-left text-[11px] text-muted">
              <tr><th className="py-2 pl-1">Token</th>{th("age", "Age")}<th className="text-right">Price</th>{th("liq", "Liquidity")}{th("cap", "MCap")}{th("volume", "Vol 24h")}{th("change", "24h")}{th("score", "Score")}<th className="pr-1 text-right">Quick buy</th></tr>
            </thead>
            <tbody>
              {rows.map(({ a, s }) => (
                <tr key={a.id} onClick={() => setSel(a.id)} className={cx("cursor-pointer border-t border-line/60 transition-colors hover:bg-panel-2/60", selected?.id === a.id && "bg-accent-soft/40")}>
                  <td className="py-2 pl-1">
                    <div className="flex items-center gap-2.5">
                      {a.logo_url ? <img src={a.logo_url} alt="" className="size-7 rounded-full bg-panel-2 object-cover" /> : <span className="flex size-7 items-center justify-center rounded-full bg-panel-2 text-[10px] font-bold text-accent-2">{String(a.symbol).slice(0, 2)}</span>}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5"><span className="font-semibold">{a.symbol}</span>
                          {a.lifecycle === "bonding_curve" && <span className="rounded bg-warn-soft px-1 text-[9.5px] font-semibold text-warn">CURVE</span>}
                          {a.lifecycle === "graduated" && <span className="rounded bg-up-soft px-1 text-[9.5px] font-semibold text-up">GRAD</span>}
                          {(a.risk_flags ?? []).some((x: string) => ["honeypot", "mint_authority", "freeze_authority", "high_tax"].includes(x)) && <ShieldAlert className="size-3.5 text-down" />}
                        </div>
                        <div className="max-w-[160px] truncate text-[11px] text-muted">{a.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num text-right text-muted">{ageLabel(a)}</td>
                  <td className="num text-right">{price(a.last_price)}</td>
                  <td className="num text-right">{compact(a.liquidity_usd)}</td>
                  <td className="num text-right">{compact(a.market_cap)}</td>
                  <td className="num text-right">{compact(a.volume_24h)}</td>
                  <td className={cx("num text-right font-semibold", Number(a.change_24h) > 0 ? "text-up" : Number(a.change_24h) < 0 ? "text-down" : "text-muted")}>{a.change_24h == null ? "—" : `${Number(a.change_24h) > 0 ? "+" : ""}${Number(a.change_24h).toFixed(1)}%`}</td>
                  <td className={cx("num text-right font-semibold", scoreTone(s))}>{s}</td>
                  <td className="pr-1 text-right"><button onClick={(e) => { e.stopPropagation(); setSel(a.id); setTimeout(() => document.getElementById("radar-buy")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30); }} className="inline-flex h-7 items-center gap-1 rounded-lg border border-accent/40 px-2.5 text-[11.5px] font-semibold text-accent-2 hover:bg-accent-soft"><Zap className="size-3.5" /> Buy</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="py-10 text-center text-xs text-muted">{!byVol.data && !byNew.data ? "Scanning Solana…" : all.length ? "No tokens match this filter right now." : "No live Solana tokens yet. Merod discovers them from DEX Screener and pump.fun as prices refresh."}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10.5px] text-faint">Live from Merod&apos;s Solana price feeds (DEX Screener, pump.fun, Jupiter). Score = Merod heuristic from data-source risk flags, liquidity, liquidity/market cap, age, launch stage and price freshness. Holder counts aren&apos;t available from these feeds. Not an audit: meme coins can go to zero.</p>
      </section>
      <aside className="space-y-4">{selected ? <TokenPanel a={selected} /> : <section className="surface flex h-60 items-center justify-center rounded-2xl text-sm text-muted"><Radar className="mr-2 size-4" /> Select a token</section>}</aside>
    </div>
  );
}

/** Right panel: chart, safety ring and checks, and the quick buy box. */
function TokenPanel({ a }: { a: Asset }) {
  const { score, checks } = safety(a);
  const bars = useApi<any>(`/api/assets/${a.id}/bars?tf=5m&limit=120`, { refreshMs: 30_000 });
  const closes: number[] = (bars.data?.bars ?? []).map((b: any) => Number(b.close)).filter(Number.isFinite);
  const series = closes.length > 1 ? closes : (a.spark ?? []).map(Number).filter(Number.isFinite);
  const R = 34, C = 2 * Math.PI * R;
  return (
    <>
      <section className="surface rounded-2xl p-4">
        <div className="flex items-start gap-3">
          {a.logo_url ? <img src={a.logo_url} alt="" className="size-10 rounded-full bg-panel-2 object-cover" /> : <span className="flex size-10 items-center justify-center rounded-full bg-panel-2 text-[12px] font-bold text-accent-2">{String(a.symbol).slice(0, 2)}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><span className="text-[17px] font-semibold">${a.symbol}</span><span className="truncate text-[12px] text-muted">{a.name}</span></div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
              <a href={`https://solscan.io/token/${a.identifier}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-mono hover:text-text">{String(a.identifier).slice(0, 4)}…{String(a.identifier).slice(-4)} <ExternalLink className="size-3" /></a>
              <span>· {ageLabel(a)} old</span>
            </div>
          </div>
          <div className="text-right">
            <div className="num text-[17px] font-semibold">{price(a.last_price)}</div>
            <div className={cx("num text-[12px] font-semibold", Number(a.change_24h) >= 0 ? "text-up" : "text-down")}>{a.change_24h == null ? "—" : `${Number(a.change_24h) >= 0 ? "+" : ""}${Number(a.change_24h).toFixed(2)}%`}</div>
          </div>
        </div>
        <Spark values={series} up={Number(a.change_24h ?? 0) >= 0} />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          {[["Liquidity", compact(a.liquidity_usd)], ["MCap", compact(a.market_cap)], ["Vol 24h", compact(a.volume_24h)]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-line bg-bg-2/50 py-1.5"><div className="text-[10px] uppercase tracking-wide text-faint">{k}</div><div className="num text-[13px] font-semibold">{v}</div></div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Link href={`/terminal/${a.id}`} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line text-[12px] text-muted hover:text-text"><CandlestickChart className="size-3.5" /> Full chart</Link>
          <span className="flex-1"><MimicTokenButton asset={a} /></span>
        </div>
      </section>

      <section className="surface rounded-2xl p-4">
        <div className="flex items-center gap-4">
          <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0">
            <circle cx="42" cy="42" r={R} fill="none" stroke="var(--line)" strokeWidth="7" />
            <circle cx="42" cy="42" r={R} fill="none" stroke={scoreStroke(score)} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(score / 100) * C} ${C}`} transform="rotate(-90 42 42)" />
            <text x="42" y="47" textAnchor="middle" className="num" fontSize="22" fontWeight="700" fill="var(--text)">{score}</text>
          </svg>
          <div>
            <div className="text-[15px] font-semibold">Safety score</div>
            <div className={cx("text-[12px] font-medium", scoreTone(score))}>{score >= 75 ? "Fewer red flags" : score >= 50 ? "Caution" : "High risk"}</div>
            <p className="mt-1 text-[10.5px] leading-snug text-faint">Merod heuristic from the fields below. Checks marked ? weren&apos;t verified on-chain.</p>
          </div>
        </div>
        <ul className="mt-3 space-y-1.5">
          {checks.map((c) => {
            const I = c.state === "pass" ? ShieldCheck : c.state === "unknown" ? ShieldQuestion : ShieldAlert;
            return (
              <li key={c.label} className="flex items-start gap-2 text-[12px]">
                <I className={cx("mt-0.5 size-3.5 shrink-0", c.state === "pass" ? "text-up" : c.state === "warn" ? "text-warn" : c.state === "fail" ? "text-down" : "text-faint")} />
                <span className="w-32 shrink-0 font-medium">{c.label}</span><span className="text-muted">{c.note}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <QuickBuy a={a} />
    </>
  );
}

function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <div className="mt-3 flex h-[110px] items-center justify-center rounded-xl border border-dashed border-line text-[11px] text-faint">No price history yet</div>;
  const W = 340, H = 110, min = Math.min(...values), max = Math.max(...values), rng = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 6 - ((v - min) / rng) * (H - 12)).toFixed(1)}`);
  const col = up ? "var(--up)" : "var(--down)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-[110px] w-full" preserveAspectRatio="none">
      <defs><linearGradient id="radar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity="0.25" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient></defs>
      <path d={`M0,${H} L${pts.join(" L")} L${W},${H} Z`} fill="url(#radar-fill)" />
      <path d={`M${pts.join(" L")}`} fill="none" stroke={col} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Quick buy: amount in SOL or USD, account picker, preview → place through the same order engine as the terminal. */
function QuickBuy({ a }: { a: Asset }) {
  const toast = useToast();
  const { user } = useShell();
  const sol = useApi<any>("/api/assets?q=SOL&class=crypto&limit=5", { refreshMs: 60_000 });
  const solPx = Number((sol.data?.assets ?? []).find((x: any) => String(x.symbol).toUpperCase() === "SOL" && !(x.risk_flags ?? []).includes("demo_data"))?.last_price ?? 0);
  const [unit, setUnit] = useState<"SOL" | "USD">("SOL");
  const [amt, setAmt] = useState("1");
  const [acct, setAcct] = useState("");
  const [mode, setMode] = useState<string>("paper");
  const [plan, setPlan] = useState<any>(null);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "place" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPlan(null); setErr(null); }, [a.id, amt, unit, acct]);
  const usd = unit === "USD" ? Number(amt) : solPx ? Number(amt) * solPx : 0;
  const chips = unit === "SOL" ? ["0.1", "0.5", "1", "5"] : ["10", "25", "100", "500"];
  const intent = () => ({ asset: { assetId: a.id }, side: "buy", orderType: "market", timeInForce: "gtc", notionalUsd: Math.round(usd * 100) / 100, maxSlippageBps: 300, ...(acct ? { accountId: acct } : {}) });
  async function preview() {
    setBusy("preview"); setErr(null);
    try { const r: any = await api("/api/orders", { method: "POST", json: { intent: intent(), mode: "preview" } }); setPlan(r.plan); setKey(crypto.randomUUID()); }
    catch (e: any) { setErr(e.body?.issues?.[0]?.message ?? e.message); } finally { setBusy(null); }
  }
  async function place() {
    if (mode === "live" && !confirm(`Buy ${unit === "SOL" ? `${amt} SOL` : `$${amt}`} of ${a.symbol} with REAL money?`)) return;
    setBusy("place"); setErr(null);
    try {
      const r: any = await api("/api/orders", { method: "POST", json: { intent: intent(), mode: "place", idempotencyKey: key } });
      let o = r.order;
      if (o.status === "pending_approval" && o.unsigned_tx?.tx) { toast("Approve the swap in your wallet…", "neutral"); o = ((await signOrderWithWallet(o)) as any).order ?? o; }
      toast(`${o.status === "filled" ? `Bought ${a.symbol}` : `Order ${o.status}`}${o.status_reason ? ` — ${o.status_reason}` : ""}`, ["filled", "submitted"].includes(o.status) ? "up" : "down");
      setPlan(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }
  const tradable = a.tradability !== "view_only" && a.tradability !== "unsupported";
  return (
    <section id="radar-buy" className="surface rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">Quick buy</h3>
        <div className="grid grid-cols-2 gap-0.5 rounded-lg border border-line bg-bg-2/60 p-0.5 text-[11px]">
          {(["SOL", "USD"] as const).map((u) => <button key={u} onClick={() => { setUnit(u); setAmt(u === "SOL" ? "1" : "25"); }} className={cx("rounded-md px-2 py-0.5", unit === u ? "nav-active" : "text-muted")}>{u}</button>)}
        </div>
      </div>
      <div className="mt-3"><AccountPicker asset={a} value={acct} onChange={(i, m) => { setAcct(i); setMode(m); }} compact /></div>
      <div className="mt-3 grid grid-cols-4 gap-1">
        {chips.map((c) => <button key={c} onClick={() => setAmt(c)} className={cx("rounded-lg border py-1.5 text-[12px]", amt === c ? "border-accent/60 bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>{unit === "USD" ? `$${c}` : c}</button>)}
      </div>
      <label className="relative mt-2 block">
        <input type="number" min="0" step="any" value={amt} onChange={(e) => setAmt(e.target.value)} className="num h-10 w-full rounded-lg border border-line bg-panel-2 px-3 pr-14 text-[14px] outline-none focus:border-accent/60" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-muted">{unit}</span>
      </label>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint"><span>{unit === "SOL" ? (solPx ? `≈ $${usd.toFixed(2)} at SOL ${price(solPx)}` : "SOL price loading…") : ""}</span><span>Slippage 3%</span></div>
      {plan && (
        <div className="mt-2 space-y-1 rounded-lg border border-line bg-bg-2/50 p-2.5 text-[11.5px]">
          <div className="flex justify-between"><span className="text-muted">Est. tokens</span><span className="num">{plan.quantity ? Number(plan.quantity).toPrecision(6) : "—"}</span></div>
          <div className="flex justify-between"><span className="text-muted">Route</span><span>{plan.providerId ?? plan.provider ?? "—"}{plan.isPaper ? " · paper" : ""}</span></div>
          <div className="flex justify-between"><span className="text-muted">Checks</span><span className={plan.decision === "rejected" ? "text-down" : "text-up"}>{plan.decision === "rejected" ? plan.decisionReason : plan.decision === "pending_approval" ? "Needs approval" : "Passed"}</span></div>
          {(plan.risks ?? []).slice(0, 3).map((r: string) => <div key={r} className="text-warn">⚠ {r}</div>)}
        </div>
      )}
      {err && <p className="mt-2 text-[11.5px] text-down">{err}</p>}
      <button disabled={!tradable || !usd || busy !== null || (plan && plan.decision === "rejected")} onClick={plan ? place : preview}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-grad text-[13px] font-semibold text-bg disabled:opacity-50">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
        {!tradable ? "Not tradable on Merod" : plan ? `Confirm: buy ${unit === "SOL" ? `${amt} SOL` : `$${amt}`} of ${a.symbol}` : `Buy ${unit === "SOL" ? `${amt} SOL` : `$${amt}`} of ${a.symbol}`}
      </button>
      <p className="mt-2 text-[10.5px] text-faint">{mode === "live" ? "Real money: routed through Jupiter from your Merod Wallet or connected wallet." : `Paper trade in your ${user.tradingMode === "live" ? "paper" : ""} account. Switch the account above for real money.`} Same order engine and risk checks as the terminal.</p>
    </section>
  );
}
