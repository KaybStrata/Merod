"use client";
import { SectionTabs } from "@/components/SectionTabs";
import { Repeat, Copy } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { CopyBotsPanel } from "@/components/CopyBots";
import { Card, Empty } from "@/components/ui";

/** Mimic trading: repeat a trader's or wallet's trades at the same size (within your caps), sells included. */
export default function MimicTradingPage() {
  const { user } = useShell();
  if (user.role !== "super_admin") return <Empty icon={<Repeat className="size-6" />} title="Mimic trading is for the platform owner">Ask the owner if you'd like access.</Empty>;
  return (
    <div className="space-y-4">
      <SectionTabs tabs={[{ href: "/mimic", label: "Mimic trading", icon: Repeat }, { href: "/copy", label: "Copy trading", icon: Copy }]} />
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Repeat className="size-6 text-accent-2" /> Mimic Trading</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Mimic bots repeat every trade a trader or public wallet makes, at the same dollar size (capped by your per-trade and daily limits), and sell when they sell. Use Copy Trading instead if you want a fixed amount per trade.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card title="On Merod">
          <p className="text-xs text-muted"><b className="text-text">Stocks and coins.</b> Any Merod trader who allows copying (Settings → Privacy → “Let others copy my trades”). Their paper and real trades.</p>
        </Card>
        <Card title="Off Merod: stocks">
          <p className="text-xs text-muted">Trades a trader makes in their own <b className="text-text">Alpaca</b> brokerage account, even outside Merod, once they've connected it here and allowed copying.</p>
        </Card>
        <Card title="Off Merod: coins">
          <p className="text-xs text-muted">A trader's <b className="text-text">Kraken</b> or <b className="text-text">Coinbase</b> trades (connected + allowed), or <b className="text-text">any public Solana wallet</b>, with no account or permission needed.</p>
        </Card>
      </div>
      <p className="text-[11px] text-faint">Not possible for anyone: trades in a private brokerage or exchange account that isn't connected to Merod. Those brokers don't publish who traded.</p>
      <CopyBotsPanel variant="mimic" />
    </div>
  );
}
