"use client";
import { Repeat } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { CopyBotsPanel } from "@/components/CopyBots";
import { Empty } from "@/components/ui";

/** Mimic trading: repeat a trader's or wallet's trades at the same size (within your caps), sells included. */
export default function MimicTradingPage() {
  const { user } = useShell();
  if (user.role !== "super_admin") return <Empty icon={<Repeat className="size-6" />} title="Mimic trading is for the platform owner">Ask the owner if you'd like access.</Empty>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Repeat className="size-6 text-accent-2" /> Mimic Trading</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Mimic bots repeat every trade a trader or public wallet makes, at the same dollar size (capped by your per-trade and daily limits), and sell when they sell. Use Copy Trading instead if you want a fixed amount per trade.</p>
      </div>
      <CopyBotsPanel variant="mimic" />
    </div>
  );
}
