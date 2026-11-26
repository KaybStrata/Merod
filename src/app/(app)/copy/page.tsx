"use client";
import { Copy } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { CopyBotsPanel } from "@/components/CopyBots";
import { MimicTabs } from "@/components/MimicTabs";
import { Empty } from "@/components/ui";

/** Copy trading: on each of a trader's (or wallet's) buys, buy a fixed dollar amount; mirror their sells. */
export default function CopyTradingPage() {
  const { user } = useShell();
  if (user.role !== "super_admin") return <Empty icon={<Copy className="size-6" />} title="Copy trading is for the platform owner">Ask the owner if you'd like access.</Empty>;
  return (
    <div className="space-y-4">
      <MimicTabs />
      <div>
        <h1 className="page-title"><Copy className="size-6 text-accent-2" /> Copy Trading</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Copy bots follow a trader or public wallet with a fixed dollar amount you choose: every time they buy, the same coin or stock is bought for you for that amount, whatever size they traded, and their sells are mirrored. Use Mimic trading instead to match their trade sizes.</p>
      </div>
      <CopyBotsPanel variant="copy" />
    </div>
  );
}
