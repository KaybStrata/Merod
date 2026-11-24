"use client";
import Link from "next/link";
import { KeyRound, ShieldCheck, Wallet, ArrowRight } from "lucide-react";
import { UserApiKeys } from "@/components/UserApiKeys";
import { Card } from "@/components/ui";

/** Paste your own brokerage API keys (Alpaca, Tradier, IBKR). Used only for YOUR account. */
export default function BrokerKeysPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><KeyRound className="size-5 text-accent-2" /> Broker API keys</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">Connect your own brokerage account by pasting its API keys. Merod encrypts them and uses them only to trade and read <b className="text-text">your</b> account.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
        <UserApiKeys title="Brokerage accounts" categories={["stock_execution"]} />
        <div className="space-y-4">
          <Card title="How it works" icon={<ShieldCheck className="size-4 text-up" />}>
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-muted">
              <li>Get API keys from your broker (for Alpaca: Dashboard → API Keys). Start with <b className="text-text">paper</b> keys.</li>
              <li>Paste them here and press <b className="text-text">Save</b>, then <b className="text-text">Test</b>.</li>
              <li>After a passing test, connect the account under Wallet & Funding.</li>
              <li>Trades you place then go to that brokerage account.</li>
            </ol>
            <Link href="/wallet" className="mt-3 inline-flex items-center gap-1 text-sm text-accent-2 hover:underline"><Wallet className="size-4" /> Connect account <ArrowRight className="size-3.5" /></Link>
          </Card>
          <Card title="Safety">
            <ul className="space-y-1.5 text-xs text-muted">
              <li>• Keys are encrypted at rest and never shown again after saving.</li>
              <li>• Never give a key withdrawal permissions — trading permission is enough.</li>
              <li>• Live (real-money) keys only place real orders when real-money trading is enabled by the platform owner.</li>
              <li>• Remove a key here any time to disconnect.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
