"use client";
import { useState } from "react";
import Link from "next/link";
import { KeyRound, ExternalLink, CheckCircle2, XCircle, Trash2, ShieldCheck, ChevronDown, ChevronRight, ArrowRight } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Empty, Pills, Skeleton, cx, useToast } from "@/components/ui";

const CATEGORY: Record<string, string> = {
  market_data: "Market data", blockchain_infra: "Blockchain infrastructure", wallet: "Wallets", crypto_execution: "Crypto execution", ai: "AI", stock_execution: "Brokerage",
};

/** "Bring your own key": users paste their own API keys; encrypted per user and used only for their own requests. */
export function UserApiKeys() {
  const { data, loading, refresh } = useApi<{ providers: any[]; keys: any[] }>("/api/me/keys");
  return (
    <Card title="My API keys" icon={<KeyRound className="size-4 text-accent-2" />}>
      <p className="mb-4 flex gap-2 rounded-xl border border-line bg-bg-2/60 px-3 py-2.5 text-xs text-muted">
        <ShieldCheck className="mt-px size-4 shrink-0 text-up" />
        <span>Your keys are encrypted and used only for your own requests. Personal brokerage keys trade only your own account. Merod never shows a saved key again. You can replace or remove it at any time.</span>
      </p>
      {loading && !data ? <Skeleton className="h-40" /> : !data?.providers.length ? <Empty title="No providers accept personal keys yet" /> : (
        <div className="space-y-2">
          {data.providers.map((p) => <ProviderKeys key={p.id} p={p} keys={data.keys.filter((k) => k.provider_id === p.id)} onChange={refresh} />)}
        </div>
      )}
    </Card>
  );
}

function ProviderKeys({ p, keys, onChange }: { p: any; keys: any[]; onChange: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<string>(p.environments.includes("sandbox") && p.userKeys === "personal_account" ? "sandbox" : p.environments[p.environments.length - 1]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const envKeys = keys.filter((k) => k.environment === env);
  const status: string | null = envKeys[0]?.status ?? null;
  const anyConnected = keys.some((k) => k.status === "connected");

  async function save() {
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
    if (!Object.keys(filled).length) return toast("Paste at least one key", "down");
    setBusy("save");
    try { await api("/api/me/keys", { method: "POST", json: { providerId: p.id, environment: env, values: filled } }); setValues({}); setResult(null); toast("Saved and encrypted — now test it", "up"); onChange(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function test() {
    setBusy("test");
    try { const r = await api("/api/me/keys/test", { method: "POST", json: { providerId: p.id, environment: env } }); setResult(r.result); onChange(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }
  async function remove() {
    if (!confirm(`Remove your ${p.name} ${env} keys?`)) return;
    setBusy("rm");
    try { await api("/api/me/keys", { method: "DELETE", json: { providerId: p.id, environment: env } }); setResult(null); toast("Keys removed"); onChange(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(null); }
  }

  return (
    <div className="rounded-xl border border-line">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-panel-2/50">
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
        <span className="min-w-0 flex-1">
          <span className="font-medium">{p.name}</span> <span className="text-xs text-faint">{CATEGORY[p.category] ?? p.category}{p.userKeys === "personal_account" && " · your own account"}</span>
        </span>
        {keys.length > 0 && <Badge tone={anyConnected ? "up" : keys.some((k) => k.status === "error") ? "down" : "accent"}>{anyConnected ? "Connected" : keys.some((k) => k.status === "error") ? "Error" : "Saved · untested"}</Badge>}
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {p.environments.length > 1
              ? <Pills size="sm" value={env} onChange={(v) => { setEnv(v); setResult(null); }} options={p.environments.map((e: string) => ({ value: e, label: e === "sandbox" ? "Sandbox / paper" : "Production" }))} />
              : <span className="text-xs text-faint">{env}</span>}
            <span className="flex gap-3 text-xs">
              <a href={p.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">Get a key <ExternalLink className="size-3" /></a>
              <a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">Docs <ExternalLink className="size-3" /></a>
            </span>
          </div>
          {p.credentials.map((c: any) => {
            const saved = envKeys.find((k) => k.name === c.name);
            return (
              <label key={c.name} className="block">
                <span className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text">{c.name}</code>{c.label}
                  {!c.required && <Badge>optional</Badge>}
                  {saved && <Badge tone="up">saved{saved.last4 ? ` ··${saved.last4}` : ""}</Badge>}
                </span>
                <input type={c.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[c.name] ?? ""}
                  onChange={(e) => setValues({ ...values, [c.name]: e.target.value })} placeholder={saved ? "•••••••• (paste to replace)" : "Paste key"}
                  className="h-10 w-full rounded-xl border border-line bg-bg-2 px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-faint focus:border-accent" />
                {c.help && <span className="mt-1 block text-[11px] text-faint">{c.help}</span>}
              </label>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" loading={busy === "save"} onClick={save}>Save</Button>
            <Button size="sm" loading={busy === "test"} disabled={!envKeys.length} onClick={test}>Test my keys</Button>
            {envKeys.length > 0 && <Button size="sm" variant="ghost" className="text-down" loading={busy === "rm"} onClick={remove}><Trash2 className="size-3.5" /> Remove</Button>}
            {envKeys[0]?.tested_at && <span className="text-[11px] text-faint">Last tested {ago(envKeys[0].tested_at)}</span>}
          </div>
          {(result || (status === "error" && envKeys[0]?.last_error)) && (
            <p className={cx("flex gap-2 rounded-lg px-3 py-2 text-xs", (result?.ok ?? status === "connected") ? "bg-up-soft text-up" : "bg-down-soft text-down")}>
              {(result?.ok ?? false) ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <XCircle className="mt-px size-3.5 shrink-0" />}
              {result?.message ?? envKeys[0]?.last_error}
            </p>
          )}
          {p.userKeys === "personal_account" && (result?.ok || status === "connected") && (
            <Link href="/wallet" className="inline-flex items-center gap-1 text-xs text-accent-2 hover:underline">Create a trading account from these keys in Wallet & Funding <ArrowRight className="size-3" /></Link>
          )}
        </div>
      )}
    </div>
  );
}
