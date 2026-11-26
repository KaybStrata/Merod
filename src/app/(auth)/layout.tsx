import Link from "next/link";
import { MessageSquareText, Bot, ShieldCheck, Repeat } from "lucide-react";
import { Logo } from "@/components/shell/Logo";

const POINTS = [
  { icon: MessageSquareText, t: "Type it, review it, approve it", d: "Plain-English prompts become risk-checked plans." },
  { icon: Bot, t: "Agents and bots that explain", d: "Every decision and fill streams to your Activity feed." },
  { icon: Repeat, t: "Mimic top traders", d: "Repeat public wallets' trades at the size you choose." },
  { icon: ShieldCheck, t: "Guardrails first", d: "Limits, 2FA, an emergency stop and an audit log." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-glow flex min-h-screen">
      <aside className="relative hidden w-[44%] max-w-[620px] flex-col justify-between overflow-hidden border-r border-line bg-bg-2/70 p-10 lg:flex">
        <svg aria-hidden viewBox="0 0 600 300" className="pointer-events-none absolute -right-24 top-1/3 h-80 w-[720px] opacity-60" fill="none">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <path key={i} d={`M0 ${250 - i * 9} C 160 ${40 + i * 12}, 330 ${290 - i * 6}, 600 ${50 + i * 9}`} stroke="#d6b37a" strokeOpacity={0.1 + i * 0.05} strokeWidth={i === 4 ? 1.3 : 0.7} />)}
        </svg>
        <Link href="/" className="relative" aria-label="Merod home"><Logo /></Link>
        <div className="relative">
          <span className="rounded-md border border-warn/40 bg-warn-soft px-2 py-0.5 text-[10px] font-bold tracking-wider text-warn">PAPER · $100K</span>
          <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-tight">Every market.<br /><span className="serif-accent text-[48px] text-accent-2">One sentence away.</span></h1>
          <p className="mt-4 max-w-md text-[14px] leading-relaxed text-muted">Set up how Merod works for you. You can change any of it later. Nothing touches real money until you say so.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p.t} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-panel"><p.icon className="size-4 text-accent-2" /></span>
                <span><span className="block text-[13.5px] font-semibold">{p.t}</span><span className="text-[12.5px] text-muted">{p.d}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-[11px] text-faint">Trading involves risk of loss. Paper trading results are simulated. Not financial advice.</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between px-6 py-5 lg:hidden"><Link href="/"><Logo /></Link></header>
        <main className="flex flex-1 items-center justify-center px-4 py-10">{children}</main>
        <footer className="px-6 pb-6 text-center text-[11px] text-faint lg:hidden">Trading involves risk of loss. Paper trading results are simulated. Not financial advice.</footer>
      </div>
    </div>
  );
}
