"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { User, ShieldCheck, CandlestickChart, Gauge, Bot, Bell, Link2, Sparkles, KeyRound, Eye, OctagonX, Monitor } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Empty, Input, Modal, Select, Skeleton, Toggle, cx, useToast } from "@/components/ui";
import { UserApiKeys } from "@/components/UserApiKeys";
import { AccountTab as AccountTabUI, SecurityTab as SecurityTabUI } from "@/components/settings/AccountSecurity";

const TABS = [
  { id: "account", label: "Profile & account", icon: User }, { id: "security", label: "Security & 2FA", icon: ShieldCheck },
  { id: "trading", label: "Trading", icon: CandlestickChart }, { id: "risk", label: "Risk management", icon: Gauge },
  { id: "automation", label: "Automation permissions", icon: Bot }, { id: "notifications", label: "Notifications", icon: Bell },
  { id: "accounts", label: "Connected accounts", icon: Link2 }, { id: "ai", label: "AI preferences", icon: Sparkles },
  { id: "apikeys", label: "My API keys", icon: KeyRound }, { id: "privacy", label: "Privacy", icon: Eye },
];

function SettingsInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = TABS.some((t) => t.id === sp.get("tab")) ? sp.get("tab")! : "account";
  const { data, error, loading, refresh } = useApi<any>("/api/settings");

  return (
    <div className="space-y-4">
      <h1 className="page-title">Settings</h1>
      <div className="grid gap-4 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => router.replace(`/settings?tab=${t.id}`)}
              className={cx("flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm", tab === t.id ? "bg-accent-soft text-text" : "text-muted hover:bg-panel-2 hover:text-text")}>
              <t.icon className={cx("size-4", tab === t.id && "text-accent-2")} />{t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          {loading && !data ? <Skeleton className="h-72" /> : error ? <Empty title="Couldn't load settings">{error}</Empty> : (
            <>
              {tab === "account" && <AccountTab data={data} refresh={refresh} />}
              {tab === "security" && <SecurityTab data={data} refresh={refresh} />}
              {tab === "trading" && <TradingTab data={data} />}
              {tab === "risk" && <RiskTab data={data} refresh={refresh} />}
              {tab === "automation" && <AutomationTab data={data} refresh={refresh} />}
              {tab === "notifications" && <NotificationsTab data={data} refresh={refresh} />}
              {tab === "accounts" && (
                <Card title="Connected accounts & wallets"><p className="text-sm text-muted">Manage wallets, brokerage connections and your own broker keys on the Wallet & Funding page.</p><Link href="/wallet"><Button className="mt-3" variant="primary">Open Wallet & Funding</Button></Link></Card>
              )}
              {tab === "ai" && <AiTab data={data} refresh={refresh} />}
              {tab === "apikeys" && <UserApiKeys />}
              {tab === "privacy" && <PrivacyTab data={data} refresh={refresh} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function useSave(refresh: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    save: async (section: string, values: any, msg = "Saved") => {
      setBusy(true);
      try { await api("/api/settings", { method: "PATCH", json: { section, values } }); toast(msg, "up"); refresh(); return true; }
      catch (e: any) { toast(e.body?.issues?.[0] ? `${e.body.issues[0].path}: ${e.body.issues[0].message}` : e.message, "down"); return false; }
      finally { setBusy(false); }
    },
  };
}

function AccountTab({ data, refresh }: any) {
  const { save, busy } = useSave(refresh);
  return <AccountTabUI data={data} save={save} busy={busy} refresh={refresh} />;
}

function SecurityTab({ data, refresh }: any) {
  return <SecurityTabUI data={data} refresh={refresh} />;
}

function TradingTab({ data }: any) {
  return (
    <Card title="Trading preferences">
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-warn/30 bg-warn-soft px-4 py-3">
          <div><div className="font-medium text-warn">Paper trading (simulated)</div><div className="text-xs text-warn/80">All orders use virtual funds and are clearly marked as simulated.</div></div>
          <Badge tone="warn">Active</Badge>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3 opacity-60">
          <div><div className="font-medium">Live trading (real money)</div><div className="text-xs text-muted">Disabled until brokerage commercial approvals, wallet security review and compliance sign-off are complete.</div></div>
          <Button size="sm" disabled>Unavailable</Button>
        </div>
        <p className="text-xs text-muted">Current mode: <b>{data.user.trading_mode}</b>. Your own broker paper accounts (connected with your keys) also count as paper.</p>
      </div>
    </Card>
  );
}

function RiskTab({ data, refresh }: any) {
  const r = data.risk;
  const [v, setV] = useState({ max_order_usd: +r.max_order_usd, max_daily_spend_usd: +r.max_daily_spend_usd, max_daily_loss_usd: +r.max_daily_loss_usd, max_slippage_bps: +r.max_slippage_bps,
    min_liquidity_usd: +r.min_liquidity_usd, max_price_age_sec: +r.max_price_age_sec, block_risky_tokens: r.block_risky_tokens, trading_halted: r.trading_halted });
  const { save, busy } = useSave(refresh);
  const num = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <div className="space-y-4">
      <Card title="Emergency stop" icon={<OctagonX className="size-4 text-down" />}>
        <p className="text-sm text-muted">When engaged, the trading engine rejects every new order and all bots halt. Takes effect immediately.</p>
        <Button className="mt-3" variant={v.trading_halted ? "secondary" : "danger"} loading={busy}
          onClick={async () => { const next = { ...v, trading_halted: !v.trading_halted }; if (await save("risk", next, next.trading_halted ? "Emergency stop engaged" : "Trading re-enabled")) setV(next); }}>
          {v.trading_halted ? "Release emergency stop" : "Engage emergency stop"}</Button>
        {v.trading_halted && <Badge tone="down" className="ml-3">Trading halted</Badge>}
      </Card>
      <Card title="Risk limits (apply to every manual, prompt, shortcut and bot order)">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Max order size (USD)" type="number" value={v.max_order_usd} onChange={num("max_order_usd")} />
          <Input label="Max daily spend (USD)" type="number" value={v.max_daily_spend_usd} onChange={num("max_daily_spend_usd")} />
          <Input label="Max daily realized loss (USD)" type="number" value={v.max_daily_loss_usd} onChange={num("max_daily_loss_usd")} />
          <Input label="Max slippage (basis points)" type="number" value={v.max_slippage_bps} onChange={num("max_slippage_bps")} hint="100 bps = 1%" />
          <Input label="Min token liquidity (USD)" type="number" value={v.min_liquidity_usd} onChange={num("min_liquidity_usd")} />
          <Input label="Reject prices older than (seconds)" type="number" value={v.max_price_age_sec} onChange={num("max_price_age_sec")} />
        </div>
        <div className="mt-4"><Toggle checked={v.block_risky_tokens} onChange={(b) => setV({ ...v, block_risky_tokens: b })} label="Block or require approval for tokens with risk flags (new, unverified, low liquidity)" /></div>
        <div className="mt-4 flex justify-end"><Button variant="primary" loading={busy} onClick={() => save("risk", v)}>Save limits</Button></div>
      </Card>
    </div>
  );
}

const MODES = [
  { id: "manual", title: "Manual Approval", text: "Every financial transaction needs your explicit confirmation — including prompts, shortcuts and bots." },
  { id: "auto_within_limits", title: "Automated Within Permissions", text: "Trades execute automatically only inside the limits below. Anything larger is rejected." },
  { id: "auto_until_approval", title: "Automated Until Approval Required", text: "Trades run automatically until one exceeds your limits or risk rules — then it waits for your approval." },
];
function AutomationTab({ data, refresh }: any) {
  const p = data.permissions;
  const [v, setV] = useState({ mode: p.mode, auto_max_order_usd: +p.auto_max_order_usd, auto_daily_cap_usd: +p.auto_daily_cap_usd, allow_ai_prompts: p.allow_ai_prompts,
    allow_bots: p.allow_bots, allow_shortcuts: p.allow_shortcuts, allowed_asset_classes: p.allowed_asset_classes as string[] });
  const { save, busy } = useSave(refresh);
  const toggleClass = (c: string) => setV({ ...v, allowed_asset_classes: v.allowed_asset_classes.includes(c) ? v.allowed_asset_classes.filter((x) => x !== c) : [...v.allowed_asset_classes, c] });
  return (
    <Card title="Automation permissions">
      <p className="mb-4 text-sm text-muted">These controls can only be changed by you in a signed-in session. AI agents, bots and shortcuts can never modify their own permissions. Every change is recorded in the audit log.</p>
      <div className="grid gap-2 md:grid-cols-3">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setV({ ...v, mode: m.id })} className={cx("rounded-xl border p-3 text-left", v.mode === m.id ? "border-accent bg-accent-soft" : "border-line hover:border-line-2")}>
            <div className="text-sm font-semibold">{m.title}</div><div className="mt-1 text-xs text-muted">{m.text}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Input label="Automatic: max per order (USD)" type="number" value={v.auto_max_order_usd} onChange={(e) => setV({ ...v, auto_max_order_usd: Number(e.target.value) })} />
        <Input label="Automatic: max per day (USD)" type="number" value={v.auto_daily_cap_usd} onChange={(e) => setV({ ...v, auto_daily_cap_usd: Number(e.target.value) })} />
      </div>
      <div className="mt-4 flex flex-wrap gap-5">
        <Toggle checked={v.allow_ai_prompts} onChange={(b) => setV({ ...v, allow_ai_prompts: b })} label="AI prompt trading" />
        <Toggle checked={v.allow_bots} onChange={(b) => setV({ ...v, allow_bots: b })} label="Trading bots" />
        <Toggle checked={v.allow_shortcuts} onChange={(b) => setV({ ...v, allow_shortcuts: b })} label="Shortcut buttons" />
      </div>
      <div className="mt-4"><div className="mb-1 text-xs font-medium text-muted">Allowed asset classes</div>
        <div className="flex flex-wrap gap-2">{["stock", "etf", "crypto", "option"].map((c) => (
          <button key={c} onClick={() => toggleClass(c)} className={cx("rounded-full border px-3 py-1 text-xs capitalize", v.allowed_asset_classes.includes(c) ? "border-accent bg-accent-soft text-text" : "border-line text-muted")}>{c}</button>
        ))}</div></div>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={busy} onClick={() => save("automation", v, "Automation permissions updated")}>Save permissions</Button></div>
    </Card>
  );
}

function NotificationsTab({ data, refresh }: any) {
  const [v, setV] = useState({ fills: true, bots: true, alerts: true, social: true, email: false, ...(data.profile.notification_prefs ?? {}) });
  const { save, busy } = useSave(refresh);
  return (
    <Card title="Notification settings">
      <div className="space-y-3">
        <Toggle checked={v.fills} onChange={(b) => setV({ ...v, fills: b })} label="Order fills and approvals" />
        <Toggle checked={v.bots} onChange={(b) => setV({ ...v, bots: b })} label="Bot activity and errors" />
        <Toggle checked={v.alerts} onChange={(b) => setV({ ...v, alerts: b })} label="Price and watchlist alerts" />
        <Toggle checked={v.social} onChange={(b) => setV({ ...v, social: b })} label="Follows, comments and mentions" />
        <Toggle checked={v.email} onChange={(b) => setV({ ...v, email: b })} disabled label={<span>Email delivery <span className="text-xs text-faint">(requires an email provider — not configured)</span></span>} />
      </div>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={busy} onClick={() => save("notifications", v)}>Save</Button></div>
    </Card>
  );
}

function AiTab({ data, refresh }: any) {
  const [provider, setProvider] = useState<string>(data.profile.ai_provider);
  const [model, setModel] = useState<string>(data.profile.ai_model);
  const models = data.ai.models[provider] ?? [];
  useEffect(() => { if (!models.some((m: any) => m.id === model)) setModel(models[0]?.id ?? ""); }, [provider]); // eslint-disable-line
  const { save, busy } = useSave(refresh);
  return (
    <Card title="AI model preferences">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="anthropic">Anthropic Claude {data.ai.available.anthropic ? "" : "(not connected)"}</option>
          <option value="openai">OpenAI {data.ai.available.openai ? "" : "(not connected)"}</option>
          <option value="merod">Merod rule parser (no AI)</option>
        </Select>
        <Select label="Model" value={model} onChange={(e) => setModel(e.target.value)}>{models.map((m: any) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select>
      </div>
      {!data.ai.available[provider] && <p className="mt-3 text-xs text-warn">This provider isn't connected yet; prompts fall back to Merod's rule parser. You can paste your own key in “My API keys”.</p>}
      <p className="mt-3 text-xs text-muted">AI only interprets your instructions into a structured plan. It never sees credentials or wallet keys, and every plan passes the Universal Trading Engine's checks.</p>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={busy} onClick={() => save("ai", { ai_provider: provider, ai_model: model })}>Save</Button></div>
    </Card>
  );
}

function PrivacyTab({ data, refresh }: any) {
  const [v, setV] = useState({ is_public: data.profile.is_public, share_performance: data.profile.share_performance, allow_copy_trading: !!data.profile.allow_copy_trading });
  const { save, busy } = useSave(refresh);
  return (
    <Card title="Privacy">
      <div className="space-y-4">
        <div><Toggle checked={v.is_public} onChange={(b) => setV({ ...v, is_public: b, share_performance: b ? v.share_performance : false })} label="Public profile" />
          <p className="ml-11 text-xs text-muted">Others can view your profile and public posts.</p></div>
        <div><Toggle checked={v.share_performance} disabled={!v.is_public} onChange={(b) => setV({ ...v, share_performance: b })} label="Share verified trading performance" />
          <p className="ml-11 text-xs text-muted">With your consent, Merod shows win rate and realized P&L computed from your filled orders (paper and live shown separately), lists you on the leaderboard, and shows your active bot strategies (names and parameters only — never balances or account details).</p></div>
        <div><Toggle checked={v.allow_copy_trading} onChange={(b) => setV({ ...v, allow_copy_trading: b })} label="Let others copy my trades" />
          <p className="ml-11 text-xs text-muted">Approved copy traders automatically mirror the trades you make on Merod, and the trades you make in brokerage or exchange accounts you've connected here (Alpaca, Kraken, Coinbase), even if you place them outside Merod. They see the trade (asset, side, size and time), never your balances or keys. You'll be notified when someone starts copying you. Turn this off to stop all copying immediately.</p></div>
      </div>
      <div className="mt-4 flex justify-end"><Button variant="primary" loading={busy} onClick={() => save("privacy", v)}>Save</Button></div>
    </Card>
  );
}

export default function SettingsPage() { return <Suspense><SettingsInner /></Suspense>; }
