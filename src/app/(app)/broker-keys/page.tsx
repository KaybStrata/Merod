"use client";
import { SectionTabs } from "@/components/SectionTabs";
import Link from "next/link";
import { KeyRound, ShieldCheck, Wallet, ArrowRight, Building2, Globe2, Bitcoin, Link2, Layers, Plug, Sparkles, Cpu, Users } from "lucide-react";
import { UserApiKeys } from "@/components/UserApiKeys";
import { PlatformApis } from "@/components/PlatformApis";
import { useShell } from "@/components/shell/context";
import { UserRound } from "lucide-react";
import { Card } from "@/components/ui";

const SECTIONS = [
  { id: "services", title: "AI & data services (Claude, ChatGPT, Birdeye, Helius…)", icon: Sparkles, note: "Claude and ChatGPT read your prompts. Birdeye shows which wallets are trading (World trades → Who's trading). Helius lets copy bots follow Solana wallets. Pick your AI model on the AI keys tab." },
  { id: "external", title: "Traders outside Merod (for Discover & Mimic)", icon: Users, note: "Sources for following and mimicking traders who aren't on Merod: eToro public traders, SnapTrade-connected lead traders, Collective2 strategies, Quiver disclosed trades and Kinfo verified performance. Alpaca and Interactive Brokers keys are under Stock brokers." },
  { id: "stocks", title: "Stock brokers", icon: Building2, note: "US brokerages. Start with paper/sandbox keys where offered." },
  { id: "global", title: "Global & connected brokers", icon: Globe2, note: "Regional brokers (India, Canada, Europe, Asia). Local eligibility rules apply." },
  { id: "exchanges", title: "Crypto exchanges", icon: Bitcoin, note: "Your own exchange account. Give keys trade permission only, never withdrawals." },
  { id: "onchain", title: "On-chain swaps", icon: Link2, note: "Swap APIs. Trades are signed by your wallet; these keys only raise quotas or unlock routes." },
  { id: "chains", title: "Chain adapters", icon: Layers, note: "Extra chains (Cardano, TON, TRON) when the main swap APIs have no route." },
] as const;

/** Paste your own keys for every broker, exchange and swap API in the Merod API directory. Used only for YOUR account. */
export default function BrokerKeysPage() {
  const { user } = useShell();
  const owner = user.role === "super_admin";
  return (
    <div className="space-y-4">
      <SectionTabs tabs={[{ href: "/broker-keys", label: "Broker keys", icon: KeyRound }, { href: "/ai-keys", label: "AI keys", icon: Cpu }]} />
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><KeyRound className="size-5 text-accent-2" /> Broker & API keys</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Two separate sets of keys: <b className="text-text">Merod&apos;s platform APIs</b>, which serve Merod and all its users, and <b className="text-text">your own trading APIs</b>, which only ever trade your personal accounts.</p>
      </div>
      <PlatformApis />
      <section className="rounded-2xl border-2 border-up/35 bg-panel/80 p-5">
        <div className="flex flex-wrap items-center gap-2"><UserRound className="size-5 text-up" /><h2 className="text-[1.25rem] font-semibold">{owner ? "My own trading APIs" : "My API keys"}</h2>
          <span className="rounded-md bg-up px-2 py-0.5 text-[10px] font-bold text-[#04130d]">{owner ? "SUPER ADMIN · PERSONAL" : "PERSONAL"}</span></div>
        <p className="mt-1 max-w-3xl text-[13px] text-muted">{owner ? "Your personal brokerage, exchange and swap keys for trading your own money as yourself. They're never used for Merod or for any other user. Your Alpaca, Coinbase, Kraken and similar accounts go here." : "Your own brokerage, exchange and swap keys. Merod encrypts them and uses them only for your account."}</p>
      </section>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {SECTIONS.map((s) => (
            <UserApiKeys key={s.id} sections={[s.id]} title={s.title}
              intro={<p className="mb-3 flex items-center gap-2 text-xs text-muted"><s.icon className="size-3.5 text-accent-2" />{s.note}</p>} />
          ))}
        </div>
        <div className="space-y-4">
          <Card title="How it works" icon={<ShieldCheck className="size-4 text-up" />}>
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted">
              <li>Open a provider below and press <b className="text-text">Get a key</b>. Start with <b className="text-text">paper</b> keys where offered.</li>
              <li>Paste the keys, press <b className="text-text">Save</b>, then <b className="text-text">Test my keys</b>.</li>
              <li>For Alpaca, Tradier and the crypto exchanges, connect the account under Wallet & Funding after a passing test. Your trades then go to that account.</li>
            </ol>
            <Link href="/wallet" className="mt-3 inline-flex items-center gap-1 text-sm text-accent-2 hover:underline"><Wallet className="size-4" /> Connect account <ArrowRight className="size-3.5" /></Link>
          </Card>
          <Card title="What the labels mean">
            <ul className="space-y-1.5 text-xs text-muted">
              <li><b className="text-text">PERSONAL</b>: your own verified account.</li>
              <li><b className="text-text">SANDBOX</b>: test or simulated trading only.</li>
              <li><b className="text-text">KEY / PUBLIC</b>: a developer key or open SDK.</li>
              <li><b className="text-text">REQUEST</b>: the provider must approve your API access first.</li>
              <li><b className="text-warn">keys only</b>: Merod stores and checks the keys, but can&apos;t send orders through that provider yet.</li>
              <li><b className="text-text">Saved · untested</b>: the provider uses a browser login or a program on your computer, so Merod can&apos;t check the keys automatically.</li>
            </ul>
          </Card>
          <Card title="Platform connections" icon={<Plug className="size-4 text-accent-2" />}>
            <p className="text-xs text-muted"><b className="text-text">Alpaca Broker API</b> and <b className="text-text">Privy</b> connect at the platform level. The site admin sets them up in Admin → Integrations, not here. <b className="text-text">DEX Screener</b> needs no key.</p>
          </Card>
          <Card title="Safety">
            <ul className="space-y-1.5 text-xs text-muted">
              <li>• Keys are encrypted at rest and never shown again after saving.</li>
              <li>• Never give a key withdrawal permissions. Trading permission is enough.</li>
              <li>• Live keys only place real orders when real-money trading is turned on by the platform owner.</li>
              <li>• Remove a key here any time to disconnect.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
