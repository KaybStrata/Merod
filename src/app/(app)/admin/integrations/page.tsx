"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plug, ExternalLink, KeyRound, ShieldCheck, Activity, AlertTriangle, CheckCircle2, XCircle, Trash2, Plus, Search, ChevronDown, ChevronRight, Package, Info, Loader2,
} from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Empty, Input, Modal, Pills, Select, Skeleton, Toggle, cx, useToast } from "@/components/ui";

type Status = "not_configured" | "credentials_configured" | "testing" | "sandbox_connected" | "awaiting_approval" | "production_connected" | "restricted" | "connection_error" | "disabled";

/** All nine integration statuses, each with its meaning. */
const STATUS: Record<Status, { label: string; tone: "neutral" | "accent" | "info" | "up" | "warn" | "down"; help: string }> = {
  not_configured: { label: "Not configured", tone: "neutral", help: "Required credentials have not been provided." },
  credentials_configured: { label: "Credentials configured", tone: "accent", help: "Keys saved but not yet verified by a connection test." },
  testing: { label: "Testing", tone: "info", help: "A connection test is running." },
  sandbox_connected: { label: "Sandbox connected", tone: "up", help: "A real test against the sandbox/paper environment passed." },
  awaiting_approval: { label: "Awaiting approval", tone: "warn", help: "Production test passed; compliance approval is still required before use." },
  production_connected: { label: "Production connected", tone: "up", help: "Production test passed and (where required) approval recorded." },
  restricted: { label: "Restricted", tone: "down", help: "Production approval was denied or the account is restricted." },
  connection_error: { label: "Connection error", tone: "down", help: "The last connection test failed — see the error below." },
  disabled: { label: "Disabled", tone: "neutral", help: "Turned off by an administrator." },
};
const CATEGORY: Record<string, string> = {
  market_data: "Market data", blockchain_infra: "Blockchain infrastructure", wallet: "Wallets & auth", crypto_execution: "Crypto execution",
  ai: "Artificial intelligence", stock_execution: "Stock brokerage",
};
const PHASE: Record<number, string> = { 1: "Foundation", 2: "Market data & wallets", 3: "Crypto execution", 4: "AI & automation", 5: "Stock integrations", 6: "Custom / production" };

function IntegrationStatus({ status }: { status: Status }) {
  const s = STATUS[status] ?? STATUS.not_configured;
  return <Badge tone={s.tone} title={s.help}>{status === "testing" && <Loader2 className="size-3 animate-spin" />}{s.label}</Badge>;
}

export default function IntegrationsPage() {
  const { data, loading, error, refresh } = useApi<{ providers: any[]; liveFlagsAllowed: boolean }>("/api/admin/integrations");
  const [filter, setFilter] = useState<"all" | "connected" | "attention" | "unconfigured">("all");
  const [term, setTerm] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const groups = useMemo(() => {
    const list = (data?.providers ?? []).filter((p) => {
      if (term && !`${p.name} ${p.id} ${p.description}`.toLowerCase().includes(term.toLowerCase())) return false;
      const st: Status[] = p.envs.map((e: any) => e.status);
      if (filter === "connected") return st.some((s) => s === "sandbox_connected" || s === "production_connected");
      if (filter === "attention") return st.some((s) => ["connection_error", "awaiting_approval", "restricted", "credentials_configured"].includes(s));
      if (filter === "unconfigured") return st.every((s) => s === "not_configured");
      return true;
    });
    const m = new Map<number, any[]>();
    for (const p of list) m.set(p.phase, [...(m.get(p.phase) ?? []), p]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [data, filter, term]);

  const summary = useMemo(() => {
    const all = (data?.providers ?? []).flatMap((p) => p.envs.map((e: any) => e.status as Status));
    return {
      total: data?.providers.length ?? 0,
      connected: all.filter((s) => s === "sandbox_connected" || s === "production_connected").length,
      errors: all.filter((s) => s === "connection_error").length,
      approval: all.filter((s) => s === "awaiting_approval").length,
    };
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted"><Link href="/admin" className="hover:text-text">Admin</Link><ChevronRight className="size-3" />Integrations</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold"><Plug className="size-6 text-accent-2" /> API Integration Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Paste and manage credentials for every provider. Keys are encrypted server-side (AES-256-GCM) and never sent back to the browser.</p>
        </div>
        <Button variant="primary" onClick={() => setAddOpen(true)}><Plus className="size-4" /> Add custom API</Button>
      </div>

      <div className="grid gap-3 rounded-2xl border border-line bg-panel/60 p-4 text-sm sm:grid-cols-3">
        <div className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-up" /><span><b>Saving keys never marks a provider connected.</b> <span className="text-muted">Only a passing live connection test does.</span></span></div>
        <div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /><span><b>Production trading needs more than keys:</b> <span className="text-muted">compliance approval here plus the matching feature flag in Admin.</span></span></div>
        <div className="flex gap-2"><Info className="mt-0.5 size-4 shrink-0 text-accent-2" /><span><b>Hosting env vars work too.</b> <span className="text-muted">Keys set as environment variables (same names) show source “env”. Vault keys take precedence.</span></span></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Providers", summary.total], ["Connected envs", summary.connected], ["Connection errors", summary.errors], ["Awaiting approval", summary.approval]].map(([k, v]) => (
          <div key={k as string} className="rounded-2xl border border-line bg-panel/70 p-4"><div className="text-xs text-muted">{k}</div><div className="num mt-1 text-2xl font-semibold">{v}</div></div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Pills value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "connected", label: "Connected" }, { value: "attention", label: "Needs attention" }, { value: "unconfigured", label: "Not configured" }]} />
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Filter providers…" className="h-10 w-full rounded-xl border border-line bg-bg-2 pl-9 pr-3 text-sm outline-none focus:border-accent" />
        </div>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">Status legend</summary>
          <div className="mt-2 grid gap-1.5 rounded-xl border border-line bg-panel p-3 sm:grid-cols-2">
            {(Object.keys(STATUS) as Status[]).map((s) => <div key={s} className="flex items-start gap-2"><IntegrationStatus status={s} /><span>{STATUS[s].help}</span></div>)}
          </div>
        </details>
      </div>

      {error && <p className="rounded-xl bg-down-soft px-4 py-3 text-sm text-down">{error}</p>}
      {loading && !data && <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40" />)}</div>}
      {data && groups.length === 0 && <Empty icon={<Plug className="size-6" />} title="No providers match this filter" />}

      {groups.map(([phase, providers]) => (
        <section key={phase} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-faint">Phase {phase} · {PHASE[phase] ?? ""}</h2>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {providers.map((p) => <ProviderCard key={p.id} p={p} onChange={refresh} />)}
          </div>
        </section>
      ))}

      <AddCustomModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); refresh(); }} />
    </div>
  );
}

function ProviderCard({ p, onChange }: { p: any; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [envName, setEnvName] = useState<string>(p.envs[0]?.environment ?? "production");
  const env = p.envs.find((e: any) => e.environment === envName) ?? p.envs[0];
  return (
    <Card pad={false} className="overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-panel-2/40">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sm font-bold text-accent-2">{p.name.slice(0, 2)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{p.name}</span>
            <Badge>{CATEGORY[p.category] ?? p.category}</Badge>
            {p.optional && <Badge>Optional</Badge>}
            {p.custom && <Badge tone="info">Custom</Badge>}
            {p.userKeys && <Badge tone="accent" title="Users may also paste their own keys for this provider">BYO keys</Badge>}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{p.description}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {p.envs.map((e: any) => (
              <span key={e.environment} className="inline-flex items-center gap-1 text-[11px] text-faint">{e.environment}: <IntegrationStatus status={e.status} /></span>
            ))}
          </div>
        </div>
        {open ? <ChevronDown className="mt-1 size-4 shrink-0 text-muted" /> : <ChevronRight className="mt-1 size-4 shrink-0 text-muted" />}
      </button>
      {open && env && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {p.envs.length > 1
              ? <Pills size="sm" value={envName} onChange={setEnvName} options={p.envs.map((e: any) => ({ value: e.environment, label: e.environment === "sandbox" ? "Sandbox / paper" : "Production" }))} />
              : <Badge>{env.environment === "sandbox" ? "Sandbox only" : "Production only"}</Badge>}
            <div className="flex flex-wrap gap-2 text-xs">
              <a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">Docs <ExternalLink className="size-3" /></a>
              <a href={p.signupUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-2 hover:underline">Developer registration <ExternalLink className="size-3" /></a>
            </div>
          </div>
          <EnvPanel p={p} env={env} onChange={onChange} />
          <Details p={p} env={env} />
          {p.custom && <DeleteCustom id={p.id} onDone={onChange} />}
        </div>
      )}
    </Card>
  );
}

function EnvPanel({ p, env, onChange }: { p: any; env: any; onChange: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Record<string, string>>(env.settings ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [ref, setRef] = useState("");
  const post = async (body: any, label: string) => {
    setBusy(label);
    try { const r = await api(`/api/admin/integrations/${p.id}`, { method: "POST", json: { environment: env.environment, ...body } }); onChange(); return r; }
    catch (e: any) { toast(e.message, "down"); return null; }
    finally { setBusy(null); }
  };
  const saveCreds = async () => {
    const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
    if (!Object.keys(filled).length) return toast("Paste at least one value", "down");
    if (await post({ action: "save_credentials", values: filled }, "save")) { setValues({}); toast("Credentials encrypted and saved. Run a connection test to verify.", "up"); }
  };
  const test = async () => {
    setResult(null);
    const r = await post({ action: "test" }, "test");
    if (r) { setResult(r.result); toast(r.result.ok ? `Connection OK — ${r.result.message}` : `Test failed — ${r.result.message}`, r.result.ok ? "up" : "down"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-2/60 p-3">
        <IntegrationStatus status={env.status} />
        <span className="text-xs text-muted">Last success: {env.lastSuccessAt ? ago(env.lastSuccessAt) : "never"} · Last test: {env.lastTestedAt ? ago(env.lastTestedAt) : "never"}{env.credentialsRotatedAt && <> · Rotated {ago(env.credentialsRotatedAt)}</>}</span>
        <div className="ml-auto flex items-center gap-3">
          <Toggle checked={env.enabled} label={<span className="text-xs">Enabled</span>} disabled={busy !== null}
            onChange={(v) => post({ action: v ? "enable" : "disable" }, "toggle").then((r) => r && toast(v ? "Enabled" : "Disabled", "neutral"))} />
          <Button size="sm" variant="primary" loading={busy === "test"} onClick={test}><Activity className="size-3.5" /> Test connection</Button>
        </div>
      </div>
      {env.lastError && env.status === "connection_error" && <p className="flex gap-2 rounded-lg bg-down-soft px-3 py-2 text-xs text-down"><XCircle className="mt-px size-3.5 shrink-0" />{env.lastError}</p>}
      {result && (
        <p className={cx("flex gap-2 rounded-lg px-3 py-2 text-xs", result.ok ? "bg-up-soft text-up" : "bg-down-soft text-down")}>
          {result.ok ? <CheckCircle2 className="mt-px size-3.5 shrink-0" /> : <XCircle className="mt-px size-3.5 shrink-0" />}
          {result.message} {result.latencyMs != null && <span className="opacity-70">({result.latencyMs} ms)</span>} → status: {STATUS[result.status as Status]?.label ?? result.status}
        </p>
      )}

      <div>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-faint"><KeyRound className="size-3.5" /> Credentials</h4>
        {env.credentials.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">Public API — no key required. Run a connection test and enable it to start using it.</p>
        ) : (
          <div className="space-y-2.5">
            {env.credentials.map((c: any) => (
              <div key={c.name} className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
                <label className="block">
                  <span className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-text">{c.name}</code> {c.label}
                    {c.required ? <Badge tone="warn">required</Badge> : <Badge>optional</Badge>}
                    {c.source && <Badge tone="up">{c.source === "vault" ? "Stored in vault" : "From env var"}{c.last4 ? ` ··${c.last4}` : ""}</Badge>}
                  </span>
                  <input type={c.secret ? "password" : "text"} autoComplete="off" spellCheck={false} name={`${p.id}-${env.environment}-${c.name}`}
                    value={values[c.name] ?? ""} onChange={(e) => setValues({ ...values, [c.name]: e.target.value })}
                    placeholder={c.source ? "•••••••• (paste to replace / rotate)" : "Paste value"}
                    className="h-10 w-full rounded-xl border border-line bg-bg-2 px-3 font-mono text-sm outline-none placeholder:font-sans placeholder:text-faint focus:border-accent" />
                  {c.help && <span className="mt-1 block text-[11px] text-faint">{c.help}</span>}
                </label>
                {c.source === "vault" && (
                  <Button size="sm" variant="ghost" className="text-down" loading={busy === `rm-${c.name}`} onClick={() => confirm(`Remove ${c.name} from the vault? The provider will be disabled.`) && post({ action: "remove_credential", name: c.name }, `rm-${c.name}`)}>
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" loading={busy === "save"} onClick={saveCreds}>Save credentials</Button>
              <span className="text-[11px] text-faint">Encrypted with MEROD_MASTER_KEY; values are never displayed again or written to logs.</span>
            </div>
          </div>
        )}
      </div>

      {p.settings?.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Settings (non-secret)</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {p.settings.map((s: any) => (
              <Input key={s.key} label={s.label} hint={s.help} value={settings[s.key] ?? ""} placeholder={env.settingDefaults?.[s.key] || "https://…"}
                onChange={(e) => setSettings({ ...settings, [s.key]: e.target.value })} />
            ))}
          </div>
          <Button size="sm" className="mt-2" loading={busy === "settings"} onClick={() => post({ action: "save_settings", settings }, "settings").then((r) => r && toast("Settings saved", "up"))}>Save settings</Button>
        </div>
      )}

      {env.environment === "production" && p.approvalGated && (
        <div className="rounded-xl border border-line bg-bg-2/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <ShieldCheck className="size-4 text-accent-2" /><span className="font-semibold">Production approval</span>
            <Badge tone={env.approvalStatus === "approved" ? "up" : env.approvalStatus === "denied" ? "down" : env.approvalStatus === "requested" ? "warn" : "neutral"}>{env.approvalStatus.replace("_", " ")}</Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted">{p.commercialRequirements}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <Input className="min-w-56 flex-1" label="Agreement / approval reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. Broker agreement #, ticket ID" />
            <Button size="sm" loading={busy === "req"} onClick={() => post({ action: "approval", approval: "requested", reference: ref || undefined }, "req")}>Mark requested</Button>
            <Button size="sm" variant="success" loading={busy === "ok"} disabled={!ref.trim()} onClick={() => post({ action: "approval", approval: "approved", reference: ref }, "ok").then((r) => r && toast("Approval recorded", "up"))}>Approve</Button>
            <Button size="sm" variant="danger" loading={busy === "deny"} onClick={() => post({ action: "approval", approval: "denied", reference: ref || undefined }, "deny")}>Deny</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Details({ p, env }: { p: any; env: any }) {
  const s = env.stats ?? {};
  return (
    <div className="grid gap-4 text-xs lg:grid-cols-2">
      <div className="space-y-2">
        <h4 className="font-semibold uppercase tracking-wide text-faint">Usage (24h)</h4>
        <div className="grid grid-cols-4 gap-2">
          {[["Requests", s.requests_24h ?? 0], ["Errors", s.errors_24h ?? 0], ["Rate-limited", s.rate_limited_24h ?? 0], ["Avg latency", s.avg_latency_ms ? `${Math.round(s.avg_latency_ms)}ms` : "—"]].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-bg-2/70 p-2"><div className="text-faint">{k}</div><div className="num mt-0.5 text-sm font-semibold text-text">{v}</div></div>
          ))}
        </div>
        <h4 className="pt-1 font-semibold uppercase tracking-wide text-faint">Recent errors</h4>
        {env.errors?.length ? (
          <ul className="space-y-1">{env.errors.map((e: any, i: number) => <li key={i} className="truncate text-muted"><span className="text-down">{e.status_code ?? "net"}</span> {e.message} · {ago(e.created_at)}</li>)}</ul>
        ) : <p className="text-muted">No errors recorded.</p>}
      </div>
      <div className="space-y-2">
        <h4 className="font-semibold uppercase tracking-wide text-faint">Coverage</h4>
        <div className="flex flex-wrap gap-1">{[...(p.assetClasses ?? []), ...(p.networks ?? [])].map((x: string) => <Badge key={x}>{x}</Badge>)}{!(p.assetClasses?.length || p.networks?.length) && <span className="text-muted">—</span>}</div>
        <div className="flex flex-wrap gap-1">{(p.capabilities ?? []).map((x: string) => <Badge key={x} tone="accent">{x.replace(/_/g, " ")}</Badge>)}</div>
        <div className="text-muted">Auth: <span className="text-text">{p.authMethod}</span>{p.supportsWebhooks && " · webhooks"}{p.supportsOAuth && " · OAuth"}</div>
        <div className="text-muted">Env vars: {p.credentials?.length ? p.credentials.map((c: any) => <code key={c.name} className="mr-1 rounded bg-panel-2 px-1 font-mono text-[11px] text-text">{c.name}</code>) : "none"}</div>
        {p.sdk && (
          <div className="rounded-lg bg-bg-2/70 p-2">
            <div className="flex items-center gap-1 font-semibold text-text"><Package className="size-3.5" /> SDK</div>
            <code className="mt-1 block break-all font-mono text-[11px] text-accent-2">{p.sdk.install}</code>
            {p.sdk.notes && <div className="mt-1 text-muted">{p.sdk.notes}</div>}
          </div>
        )}
        <details><summary className="cursor-pointer select-none text-muted">Troubleshooting & requirements</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">{(p.troubleshooting ?? []).map((t: string) => <li key={t}>{t}</li>)}</ul>
          <p className="mt-1 text-muted"><b className="text-text">Commercial:</b> {p.commercialRequirements}</p>
        </details>
      </div>
    </div>
  );
}

function DeleteCustom({ id, onDone }: { id: string; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex justify-end">
      <Button size="sm" variant="ghost" className="text-down" loading={busy} onClick={async () => {
        if (!confirm("Delete this custom provider and all its stored credentials?")) return;
        setBusy(true);
        try { await api("/api/admin/custom-providers", { method: "DELETE", json: { id } }); toast("Custom provider deleted"); onDone(); }
        catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
      }}><Trash2 className="size-3.5" /> Delete custom provider</Button>
    </div>
  );
}

function AddCustomModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", category: "market_data", description: "", docsUrl: "", baseUrl: "https://", authStyle: "header", authHeader: "x-api-key", testPath: "/", testExpect: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api("/api/admin/custom-providers", { method: "POST", json: { ...f, authHeader: ["header", "query"].includes(f.authStyle) ? f.authHeader : undefined, testExpect: f.testExpect || undefined, docsUrl: f.docsUrl || undefined } });
      toast("Custom API added — paste its key and run a test", "up");
      onCreated();
    } catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add custom API" wide>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-muted">Connect any REST API by base URL and key. Custom providers support connection tests and data access. Order execution through a new provider still needs a reviewed adapter.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" required value={f.name} onChange={set("name")} placeholder="e.g. Kraken" />
          <Select label="Category" value={f.category} onChange={set("category")}>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Input label="Base URL" required value={f.baseUrl} onChange={set("baseUrl")} placeholder="https://api.example.com" />
          <Input label="Docs URL" value={f.docsUrl} onChange={set("docsUrl")} placeholder="https://docs.example.com" />
          <Select label="Auth style" value={f.authStyle} onChange={set("authStyle")}>
            <option value="header">API key in header</option><option value="bearer">Bearer token</option><option value="query">API key in query string</option><option value="basic">Basic (user/password)</option><option value="none">No auth</option>
          </Select>
          {["header", "query"].includes(f.authStyle) && <Input label={f.authStyle === "header" ? "Header name" : "Query parameter"} value={f.authHeader} onChange={set("authHeader")} />}
          <Input label="Test path" value={f.testPath} onChange={set("testPath")} hint="Cheap GET endpoint used by “Test connection”" />
          <Input label="Expected JSON key (optional)" value={f.testExpect} onChange={set("testExpect")} hint="Test passes only if the response contains this key" />
        </div>
        <Input label="Description" value={f.description} onChange={set("description")} />
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Add provider</Button></div>
      </form>
    </Modal>
  );
}
