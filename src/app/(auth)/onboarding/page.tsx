"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hand, MessageSquareText, Zap, Bot, Check, ArrowLeft, ArrowRight, KeyRound, Wallet, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Button, cx } from "@/components/ui";
import { Steps } from "./steps";

const STYLES = [
  { id: "manual", icon: Hand, title: "Manual", text: "Pick the asset, size and order type yourself in the terminal. You approve every trade." },
  { id: "prompts", icon: MessageSquareText, title: "Prompts", text: "Say it in plain English. Merod drafts a risk-checked plan for you to approve." },
  { id: "shortcuts", icon: Zap, title: "Shortcuts", text: "One-tap buttons for the trades you repeat: buy the dip, trim winners, close all." },
  { id: "agents", icon: Bot, title: "Agents", text: "Bots and agent fleets that scan, decide and trade inside the limits you set." },
] as const;

/** Each profile writes real values into your risk + automation settings. 0 = no limit. */
const PROFILES = [
  { id: "conservative", title: "Conservative", text: "Small orders, tight stops", risk: { max_order_usd: 1_000, max_daily_spend_usd: 5_000, max_daily_loss_usd: 500, max_slippage_bps: 50 }, auto: { auto_max_order_usd: 250, auto_daily_cap_usd: 1_000 } },
  { id: "balanced", title: "Balanced", text: "Room to trade, with a daily stop", risk: { max_order_usd: 5_000, max_daily_spend_usd: 25_000, max_daily_loss_usd: 2_000, max_slippage_bps: 100 }, auto: { auto_max_order_usd: 1_000, auto_daily_cap_usd: 5_000 } },
  { id: "aggressive", title: "Aggressive", text: "No caps, buying power only", risk: { max_order_usd: 0, max_daily_spend_usd: 0, max_daily_loss_usd: 0, max_slippage_bps: 300 }, auto: { auto_max_order_usd: 0, auto_daily_cap_usd: 0 } },
] as const;
const BALANCES = [10_000, 25_000, 100_000, 250_000, 1_000_000];
const usd = (n: number) => n >= 1_000_000 ? `$${n / 1_000_000}M` : `$${n / 1000}k`;

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<2 | 3 | 4>(2);
  const [settings, setSettings] = useState<any>(null);
  const [paper, setPaper] = useState<{ id: string; cash: number } | null>(null);
  const [styles, setStyles] = useState<Set<string>>(new Set(["manual", "prompts"]));
  const [profile, setProfile] = useState<string>("balanced");
  const [balance, setBalance] = useState(100_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<any>("/api/settings").then(setSettings).catch(() => router.replace("/login?next=/onboarding"));
    api<any>("/api/wallet/accounts").then((r) => {
      const p = (r.accounts ?? []).find((a: any) => a.kind === "paper");
      if (p) { setPaper({ id: p.id, cash: Number(p.cash_balance) }); setBalance(BALANCES.reduce((b, x) => Math.abs(x - Number(p.cash_balance)) < Math.abs(b - Number(p.cash_balance)) ? x : b, 100_000)); }
    }).catch(() => {});
  }, [router]);

  const toggle = (id: string) => setStyles((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); if (!n.size) n.add("manual"); return n; });

  async function saveStyle() {
    if (!settings) return;
    setBusy(true); setError(null);
    try {
      const r = settings.risk, p = settings.permissions, prof = PROFILES.find((x) => x.id === profile)!;
      await api("/api/settings", { method: "PATCH", json: { section: "risk", values: {
        ...prof.risk, min_liquidity_usd: +r.min_liquidity_usd, max_price_age_sec: +r.max_price_age_sec, block_risky_tokens: r.block_risky_tokens, trading_halted: r.trading_halted } } });
      await api("/api/settings", { method: "PATCH", json: { section: "automation", values: {
        mode: styles.has("manual") ? "manual" : "auto_until_approval", ...prof.auto,
        allow_ai_prompts: styles.has("prompts") || styles.has("agents"), allow_bots: styles.has("agents"), allow_shortcuts: styles.has("shortcuts"),
        allowed_asset_classes: p.allowed_asset_classes } } });
      // Starting paper balance: move the difference with a simulated paper deposit/withdrawal.
      if (paper && Math.round(paper.cash) !== balance) {
        const diff = balance - paper.cash;
        await api("/api/wallet/funding", { method: "POST", json: { action: diff > 0 ? "paper_deposit" : "paper_withdraw", accountId: paper.id, amount: Math.round(Math.abs(diff) * 100) / 100 } });
        setPaper({ ...paper, cash: balance });
      }
      setStep(3);
    } catch (e: any) { setError(e.body?.issues?.[0] ? `${e.body.issues[0].path}: ${e.body.issues[0].message}` : e.message); } finally { setBusy(false); }
  }

  return (
    <div className="fade-up w-full max-w-[760px]">
      <div className="surface rounded-2xl p-6 sm:p-7">
        <Steps at={step} />
        {step === 2 && (
          <>
            <h1 className="mt-5 text-[28px] font-semibold tracking-tight">How do you want to <span className="serif-accent text-[33px] text-accent-2">trade?</span></h1>
            <p className="mt-1 text-[13.5px] text-muted">Pick as many as you like. Merod sets up your home screen, shortcuts and approvals to match. You can change this any time in Settings.</p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {STYLES.map((s) => {
                const on = styles.has(s.id);
                return (
                  <button key={s.id} onClick={() => toggle(s.id)} aria-pressed={on}
                    className={cx("flex gap-3 rounded-xl border p-3.5 text-left transition-colors", on ? "border-accent bg-accent-soft" : "border-line hover:border-line-2")}>
                    <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg border", on ? "border-accent/50 bg-panel" : "border-line-2 bg-panel-2")}><s.icon className="size-4 text-accent-2" /></span>
                    <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2 text-[14px] font-semibold">{s.title}<span className={cx("flex size-4.5 items-center justify-center rounded border", on ? "border-accent bg-accent-2 text-bg" : "border-line-2")}>{on && <Check className="size-3" />}</span></span>
                      <span className="mt-0.5 block text-[12px] text-muted">{s.text}</span></span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-5 md:grid-cols-[1.3fr_1fr]">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Risk profile</div>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {PROFILES.map((p) => (
                    <button key={p.id} onClick={() => setProfile(p.id)} className={cx("rounded-xl border px-2.5 py-2 text-left", profile === p.id ? "border-accent bg-accent-soft" : "border-line hover:border-line-2")}>
                      <span className="block text-[12.5px] font-semibold">{p.title}</span><span className="block text-[10.5px] text-muted">{p.text}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-faint">{(() => { const p = PROFILES.find((x) => x.id === profile)!; const f = (n: number) => n > 0 ? `$${n.toLocaleString()}` : "no limit"; return `Max order ${f(p.risk.max_order_usd)} · daily spend ${f(p.risk.max_daily_spend_usd)} · daily loss stop ${f(p.risk.max_daily_loss_usd)} · slippage ${(p.risk.max_slippage_bps / 100).toFixed(2)}%`; })()}</p>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-faint">Starting paper balance</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BALANCES.map((b) => (
                    <button key={b} onClick={() => setBalance(b)} className={cx("num rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold", balance === b ? "border-accent bg-accent-soft text-text" : "border-line text-muted hover:text-text")}>{usd(b)}</button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-faint">Virtual funds, clearly marked as simulated.</p>
              </div>
            </div>
            {error && <p className="mt-4 rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
            <div className="mt-6 flex items-center justify-between gap-3">
              <Link href="/" className="flex items-center gap-1 text-[13px] text-muted hover:text-text"><ArrowLeft className="size-4" /> Skip for now</Link>
              <Button variant="primary" loading={busy} disabled={!settings} onClick={saveStyle}>Continue <ArrowRight className="size-4" /></Button>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <h1 className="mt-5 text-[28px] font-semibold tracking-tight">Connect a <span className="serif-accent text-[33px] text-accent-2">broker</span> <span className="text-[15px] font-normal text-muted">(optional)</span></h1>
            <p className="mt-1 text-[13.5px] text-muted">Stay on paper as long as you like. When you&apos;re ready, add your own keys to trade real accounts.</p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
              {[
                { href: "/broker-keys", icon: KeyRound, t: "Stocks", d: "Alpaca (paper or live) and other brokers" },
                { href: "/broker-keys", icon: Sparkles, t: "Crypto exchanges", d: "Coinbase, Kraken, Binance…" },
                { href: "/wallet", icon: Wallet, t: "Wallets", d: "A Merod Wallet, Phantom or Solflare" },
              ].map((c) => (
                <Link key={c.t} href={c.href} className="rounded-xl border border-line p-3.5 hover:border-accent/50">
                  <c.icon className="size-5 text-accent-2" /><div className="mt-2 text-[14px] font-semibold">{c.t}</div><p className="mt-0.5 text-[12px] text-muted">{c.d}</p>
                </Link>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <button onClick={() => setStep(2)} className="flex items-center gap-1 text-[13px] text-muted hover:text-text"><ArrowLeft className="size-4" /> Back</button>
              <Button variant="primary" onClick={() => setStep(4)}>Stay on paper for now <ArrowRight className="size-4" /></Button>
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h1 className="mt-5 text-[28px] font-semibold tracking-tight">You&apos;re <span className="serif-accent text-[33px] text-accent-2">set</span></h1>
            <ul className="mt-4 space-y-2 text-[13.5px]">
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-up" /> Trading style: {[...styles].map((s) => STYLES.find((x) => x.id === s)?.title).join(", ")}</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-up" /> Risk profile: {PROFILES.find((p) => p.id === profile)?.title}</li>
              <li className="flex gap-2"><Check className="mt-0.5 size-4 text-up" /> Paper balance: <span className="num">{usd(balance)}</span></li>
            </ul>
            <p className="mt-4 rounded-xl border border-line/70 bg-bg-2/50 px-3 py-2.5 text-[12.5px] text-muted">Try typing <b className="text-text">&ldquo;Buy $100 of SOL&rdquo;</b> or <b className="text-text">&ldquo;Alert me when NVDA drops 5%&rdquo;</b> in Ask Merod.</p>
            <div className="mt-6 flex justify-end"><Button variant="primary" onClick={() => { router.push("/"); router.refresh(); }}>Open Merod <ArrowRight className="size-4" /></Button></div>
          </>
        )}
      </div>
    </div>
  );
}
