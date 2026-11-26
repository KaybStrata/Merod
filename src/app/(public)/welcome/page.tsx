import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Sparkles, MessageSquareText, Bot, ShieldCheck, Repeat, Zap, Check, LineChart, OctagonX, KeyRound } from "lucide-react";
import { Logo } from "@/components/shell/Logo";

export const metadata: Metadata = { title: "Merod — Trade everything. Just say it.", description: "Stocks, crypto and meme coins in one terminal. Type what you want; Merod drafts a risk-checked plan and waits for your approval." };

const NAV = [["Product", "#product"], ["Agents", "#agents"], ["Mimic", "#mimic"], ["Security", "#security"], ["Pricing", "#pricing"], ["Docs", "#how"]] as const;
const LOGOS = ["alpaca", "coinbase", "BINANCE", "Solana", "jupiter", "Anthropic", "OpenAI"];

/** Deterministic illustrative candles for the hero preview (not market data). */
function candles(n = 46) {
  const out: { o: number; c: number; h: number; l: number }[] = [];
  let p = 50;
  for (let i = 0; i < n; i++) {
    const d = Math.sin(i * 0.55) * 2.2 + Math.cos(i * 1.7) * 1.4 + 0.45;
    const o = p, c = p + d;
    out.push({ o, c, h: Math.max(o, c) + 1 + Math.abs(Math.sin(i)) * 1.5, l: Math.min(o, c) - 1 - Math.abs(Math.cos(i * 1.3)) * 1.5 });
    p = c;
  }
  return out;
}

function HeroPreview() {
  const cs = candles();
  const lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
  const W = 520, H = 210, y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 16) - 8, bw = W / cs.length;
  return (
    <div className="relative mx-auto w-full max-w-[600px]" aria-label="Illustrative preview of the Merod terminal">
      <div className="surface relative rounded-2xl p-4 shadow-2xl">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="rounded-md bg-panel-2 px-1.5 py-0.5 font-semibold">NVDA</span><span className="text-muted">NVIDIA Corp · NASDAQ</span>
          <span className="ml-auto rounded-md border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-[10px] font-bold text-warn">PAPER</span>
        </div>
        <div className="mt-2 flex items-baseline gap-2"><span className="num text-[26px] font-semibold">$141.28</span><span className="num text-[13px] text-up">+2.14%</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-[190px] w-full" preserveAspectRatio="none" aria-hidden>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--line)" strokeDasharray="3 5" />)}
          {cs.map((c, i) => {
            const up = c.c >= c.o, x = i * bw + bw / 2;
            return <g key={i}><line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1" />
              <rect x={x - bw * 0.32} width={bw * 0.64} y={y(Math.max(c.o, c.c))} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))} fill={up ? "var(--up)" : "var(--down)"} rx="1" /></g>;
          })}
        </svg>
      </div>
      <div className="surface absolute -right-2 top-10 hidden w-48 rounded-xl px-3 py-2 text-[11.5px] shadow-xl sm:block">
        <div className="flex items-center gap-1.5 font-semibold text-up"><Check className="size-3.5" /> Filled · BUY 15 NVDA</div>
        <div className="mt-0.5 text-muted">Market · paper account</div>
      </div>
      <div className="surface relative -mt-10 ml-4 mr-10 rounded-xl p-3 shadow-2xl sm:ml-10">
        <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-accent-2"><Sparkles className="size-3.5" /> Ask Merod</div>
        <p className="mt-1.5 text-[13px]">&ldquo;Put $2k into NVDA if it dips under 138, stop at 132, and trim my BONK by a quarter.&rdquo;</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
          {[["Limit buy", "NVDA ≤ $138"], ["Stop-loss", "$132"], ["Sell 25%", "BONK"]].map(([a, b]) => (
            <div key={a} className="rounded-lg border border-line/70 bg-bg-2/60 px-2 py-1.5"><div className="text-faint">{a}</div><div className="num font-semibold">{b}</div></div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px]"><span className="text-up">✓ Risk checks passed</span><span className="rounded-md bg-grad px-2 py-1 font-semibold">Approve plan</span></div>
      </div>
      <p className="mt-2 text-center text-[10.5px] text-faint">Illustrative preview</p>
    </div>
  );
}

const FEATURES = [
  { id: "product", icon: MessageSquareText, title: "Say it, see it", text: "Plain-English prompts become structured, validated orders: limits, stops, brackets, recurring buys and loops. You see the plan before anything trades.", tags: ["Prompts", "Shortcuts"] },
  { id: "agents", icon: Bot, title: "Agents that explain", text: "Spin up bots and agent fleets that scan, decide and execute in parallel. Every thought, decision and fill streams live to your Activity feed.", tags: ["Agents", "Bots", "Activity"] },
  { id: "security", icon: ShieldCheck, title: "Guardrails first", text: "Risk limits, approvals, 2FA, an emergency stop and a hash-chained audit log. Keys are encrypted; AI never sees credentials.", tags: ["Risk limits", "2FA", "Audit log"] },
];

export default function Landing() {
  return (
    <div className="app-glow min-h-screen overflow-x-hidden">
      <header className="mx-auto flex max-w-[1240px] items-center gap-6 px-4 py-4 sm:px-6">
        <Link href="/" aria-label="Merod"><Logo /></Link>
        <nav className="hidden items-center gap-5 text-[13px] text-muted md:flex">{NAV.map(([l, h]) => <a key={l} href={h} className="hover:text-text">{l}</a>)}</nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className="rounded-lg px-3 py-2 text-[13px] text-muted hover:text-text">Sign in</Link>
          <Link href="/signup" className="flex h-9 items-center rounded-lg bg-grad px-3.5 text-[13px] font-semibold">Start paper trading</Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-[11.5px] text-accent-2"><Zap className="size-3.5" /> Agent fleets · run strategies in parallel</span>
            <h1 className="mt-5 text-[44px] font-semibold leading-[1.02] tracking-tight sm:text-[64px]">Trade everything.<br /><span className="serif-accent text-[52px] text-accent-2 sm:text-[76px]">Just say it.</span></h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-muted">Stocks, crypto and meme coins in one terminal. Type what you want: Merod drafts a risk-checked plan, runs it through your limits, and waits for your approval.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/signup" className="flex h-11 items-center gap-2 rounded-xl bg-grad px-5 text-[14px] font-semibold">Start with $100k paper <ArrowRight className="size-4" /></Link>
              <a href="#how" className="flex h-11 items-center gap-2 rounded-xl border border-line-2 px-5 text-[14px] text-muted hover:text-text">See how it works</a>
            </div>
            <p className="mt-4 text-[12px] text-faint">Paper trading with virtual funds by default. No card required.</p>
          </div>
          <HeroPreview />
        </section>

        <section className="border-y border-line/70 bg-bg-2/40">
          <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-6">
            <div className="text-center text-[10.5px] font-semibold uppercase tracking-[0.16em] text-faint">Trade & data connections</div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
              {LOGOS.map((l) => <span key={l} className="text-[17px] font-semibold tracking-tight text-muted/80">{l}</span>)}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
          <div className="grid gap-4 md:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.id} id={f.id} className="surface scroll-mt-20 rounded-2xl p-5">
                <f.icon className="size-6 text-accent-2" />
                <h2 className="mt-3 text-[18px] font-semibold">{f.title.split(" ").slice(0, -1).join(" ")} <span className="serif-accent text-[21px] text-accent-2">{f.title.split(" ").slice(-1)}</span></h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{f.text}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">{f.tags.map((t) => <span key={t} className="rounded-md bg-panel-2 px-2 py-0.5 text-[11px] text-muted">{t}</span>)}</div>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="mx-auto max-w-[1240px] scroll-mt-20 px-4 pb-16 sm:px-6">
          <h2 className="text-[28px] font-semibold tracking-tight">How it <span className="serif-accent text-[32px] text-accent-2">works</span></h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-4">
            {[
              { icon: MessageSquareText, t: "Ask", d: "Type a trade, a rule or a whole strategy — or tap a one-tap shortcut." },
              { icon: LineChart, t: "Review", d: "Merod shows the plan: orders, sizes, prices and every risk check it ran." },
              { icon: Check, t: "Approve", d: "Approve once, or let it run inside the limits you set in Settings." },
              { icon: OctagonX, t: "Stay in control", d: "Watch decisions live, pause any bot, or hit the emergency stop." },
            ].map((s, i) => (
              <li key={s.t} className="surface rounded-2xl p-4">
                <div className="flex items-center gap-2 text-[11px] font-semibold text-faint"><span className="num">0{i + 1}</span><s.icon className="size-4 text-accent-2" /></div>
                <div className="mt-2 text-[15px] font-semibold">{s.t}</div>
                <p className="mt-1 text-[12.5px] text-muted">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="mimic" className="mx-auto max-w-[1240px] scroll-mt-20 px-4 pb-16 sm:px-6">
          <div className="surface grid items-center gap-6 rounded-2xl p-6 md:grid-cols-[1fr_auto]">
            <div>
              <h2 className="flex items-center gap-2 text-[22px] font-semibold"><Repeat className="size-5 text-accent-2" /> Mimic the <span className="serif-accent text-[26px] text-accent-2">best</span></h2>
              <p className="mt-2 max-w-2xl text-[13.5px] text-muted">Follow public Solana wallets and Merod traders who allow copying. Their new trades are repeated in your account at the size you choose, paper or real money.</p>
            </div>
            <Link href="/signup" className="flex h-10 items-center gap-2 rounded-xl border border-line-2 px-4 text-[13px] hover:border-accent/50">Try it on paper <ArrowRight className="size-4" /></Link>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-[1240px] scroll-mt-20 px-4 pb-20 sm:px-6">
          <div className="surface rounded-2xl p-6 text-center">
            <KeyRound className="mx-auto size-6 text-accent-2" />
            <h2 className="mt-2 text-[22px] font-semibold">Free while in <span className="serif-accent text-[26px] text-accent-2">beta</span></h2>
            <p className="mx-auto mt-2 max-w-xl text-[13.5px] text-muted">Every feature is open in paper mode. Paid plans aren&apos;t available yet. Bring your own broker, exchange and AI keys for real accounts.</p>
            <Link href="/signup" className="mx-auto mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-grad px-5 text-[14px] font-semibold">Start with $100k paper <ArrowRight className="size-4" /></Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/70 px-4 py-6 text-center text-[11px] text-faint sm:px-6">
        Trading involves risk of loss. Paper trading results are simulated. Merod does not provide financial advice. © Merod
      </footer>
    </div>
  );
}
