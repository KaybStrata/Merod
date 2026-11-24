"use client";
import { Copy } from "lucide-react";
import { useShell } from "@/components/shell/context";
import { CopyBotsPanel } from "@/components/CopyBots";
import { Empty } from "@/components/ui";

export default function CopyTradingPage() {
  const { user } = useShell();
  if (user.role !== "super_admin") return <Empty icon={<Copy className="size-6" />} title="Copy trading is for the platform owner">Ask the owner if you'd like access.</Empty>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Copy className="size-6 text-accent-2" /> Copy Trading</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Copy bots automatically mirror other traders into your account: their Merod trades, the trades they make outside Merod in accounts they've connected (with their permission), or any public Solana wallet's swaps.</p>
      </div>
      <CopyBotsPanel />
    </div>
  );
}
