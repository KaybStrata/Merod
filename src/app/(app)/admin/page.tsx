"use client";
import { useState } from "react";
import Link from "next/link";
import { Shield, Server, Users, Activity, Scale, ScrollText, Plug, AlertOctagon, CheckCircle2, XCircle, Search, ArrowRight } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago, usd } from "@/lib/format";
import { Badge, Button, Card, Empty, Input, Modal, PaperBadge, Pills, Select, Skeleton, StatusPill, Toggle, cx, useToast } from "@/components/ui";

type Tab = "overview" | "users" | "trading" | "compliance" | "audit";

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Shield className="size-6 text-accent-2" /> Administration</h1>
          <p className="mt-1 text-sm text-muted">System health, users, trading activity, compliance controls and audit trail.</p>
        </div>
        <Link href="/admin/integrations"><Button variant="outline"><Plug className="size-4" /> API Integration Center <ArrowRight className="size-4" /></Button></Link>
      </div>
      <Pills value={tab} onChange={setTab} options={[
        { value: "overview", label: "System" }, { value: "users", label: "Users" }, { value: "trading", label: "Trading activity" },
        { value: "compliance", label: "Compliance & flags" }, { value: "audit", label: "Audit log" },
      ]} />
      {tab === "overview" && <Overview />}
      {tab === "users" && <UsersTab />}
      {tab === "trading" && <Trading />}
      {tab === "compliance" && <Compliance />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

/* ───────── System ───────── */
function Overview() {
  const { data, loading, refresh } = useApi<any>("/api/admin/overview", { refreshMs: 15000 });
  const toast = useToast();
  if (loading && !data) return <Skeleton className="h-96" />;
  if (!data) return null;
  const c = data.counts ?? {};
  const alive = data.heartbeats.filter((h: any) => h.alive).length;
  const health = data.health as any[];
  const bad = health.filter((h) => ["connection_error", "restricted"].includes(h.status));
  async function setPrice(providerId: string, current: number | null) {
    const v = prompt(`Estimated USD cost per 1,000 requests for ${providerId} (blank to clear):`, current?.toString() ?? "");
    if (v === null) return;
    try { await api("/api/admin/overview", { method: "POST", json: { providerId, costPer1k: v.trim() === "" ? null : Number(v) } }); refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[["Users", c.users, `+${c.users_7d ?? 0} this week`], ["Active sessions", c.active_sessions], ["Bots running", c.bots_running], ["Orders (24h)", c.orders_24h],
          ["Live orders (24h)", c.live_orders_24h, "real-money disabled"], ["Workers alive", `${alive}/${data.heartbeats.length}`]].map(([k, v, s]) => (
          <div key={k as string} className="rounded-2xl border border-line bg-panel/70 p-4">
            <div className="text-xs text-muted">{k}</div><div className="num mt-1 text-2xl font-semibold">{v ?? 0}</div>{s && <div className="text-[11px] text-faint">{s}</div>}
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Workers" icon={<Server className="size-4 text-accent-2" />}>
          {data.heartbeats.length === 0 ? (
            <Empty title="No worker heartbeat yet">Start the persistent worker (<code>npm run worker</code> / Railway worker service). Bots, price feeds and reconciliation do not run without it.</Empty>
          ) : (
            <div className="space-y-2">
              {data.heartbeats.map((h: any) => (
                <div key={h.worker_id} className="rounded-xl border border-line bg-bg-2/60 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-mono text-text"><span className={cx("size-2 rounded-full", h.alive ? "bg-up pulse-dot" : "bg-down")} />{h.worker_id}</span>
                    <span className="text-muted">last seen {ago(h.last_seen_at)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {Object.entries(h.info?.loops ?? {}).map(([name, l]: any) => (
                      <Badge key={name} tone={l.ok ? "up" : "down"} title={l.error ?? `ran ${ago(l.at)}`}>{name}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Provider health" icon={<Plug className="size-4 text-accent-2" />} action={<Link href="/admin/integrations" className="text-xs text-accent-2 hover:underline">Manage</Link>}>
          {health.length === 0 ? <Empty title="No providers configured yet">Open the Integration Center to paste API keys.</Empty> : (
            <>
              {bad.length > 0 && <p className="mb-2 flex gap-2 rounded-lg bg-down-soft px-3 py-2 text-xs text-down"><AlertOctagon className="size-3.5 shrink-0" />{bad.length} provider environment(s) failing. Automated execution that depends on them is suspended.</p>}
              <div className="max-h-72 space-y-1 overflow-auto">
                {health.map((h) => (
                  <div key={`${h.provider_id}-${h.environment}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-panel-2">
                    <span className="truncate"><span className="font-medium text-text">{h.provider_id}</span> <span className="text-faint">{h.environment}</span></span>
                    <span className="flex shrink-0 items-center gap-2">{!h.enabled && <Badge>off</Badge>}<StatusPill status={h.status} /></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
      <Card title="API usage & cost estimate" icon={<Activity className="size-4 text-accent-2" />}>
        <p className="mb-2 text-[11px] text-faint">Request counts are measured. Costs are <b>estimates</b> from the per-1,000-request price you enter. Check each provider's billing dashboard for actual charges.</p>
        {data.usage.length === 0 ? <Empty title="No provider traffic recorded yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-2">Provider</th><th>Req 24h</th><th>Req 7d</th><th>Errors 24h</th><th>Rate-limited</th><th>Avg ms</th><th>$/1k (est.)</th><th>Est. 7d cost</th></tr></thead>
              <tbody>
                {data.usage.map((u: any) => (
                  <tr key={u.provider_id} className="num border-t border-line">
                    <td className="py-2 font-medium">{u.provider_id}</td><td>{u.req_24h}</td><td>{u.req_7d}</td>
                    <td className={u.err_24h ? "text-down" : ""}>{u.err_24h}</td><td className={u.rl_24h ? "text-warn" : ""}>{u.rl_24h}</td><td>{u.avg_ms ?? "—"}</td>
                    <td><button onClick={() => setPrice(u.provider_id, u.cost_per_1k)} className="text-accent-2 hover:underline">{u.cost_per_1k != null ? usd(u.cost_per_1k) : "configure pricing"}</button></td>
                    <td>{u.est_cost_7d != null ? usd(u.est_cost_7d) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="System events">
        {data.events.length === 0 ? <Empty title="No events" /> : (
          <ul className="max-h-80 space-y-1 overflow-auto text-xs">
            {data.events.map((e: any) => (
              <li key={e.id} className="flex gap-2 rounded-lg px-2 py-1.5 hover:bg-panel-2">
                <Badge tone={e.level === "error" || e.level === "critical" ? "down" : e.level === "warn" ? "warn" : "neutral"}>{e.level}</Badge>
                <span className="text-faint">{e.source}</span><span className="min-w-0 flex-1 truncate text-text">{e.message}</span><span className="shrink-0 text-faint">{ago(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ───────── Users ───────── */
function UsersTab() {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const { data, loading, refresh } = useApi<any>(`/api/admin/users?q=${encodeURIComponent(query)}`);
  const toast = useToast();
  async function patch(userId: string, body: any) {
    try { await api("/api/admin/users", { method: "PATCH", json: { userId, ...body } }); toast("User updated", "up"); refresh(); }
    catch (e: any) { toast(e.message, "down"); }
  }
  return (
    <Card title="Users" icon={<Users className="size-4 text-accent-2" />}
      action={<form onSubmit={(e) => { e.preventDefault(); setQuery(term); }} className="relative w-60"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" /><input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search email or handle" className="h-9 w-full rounded-xl border border-line bg-bg-2 pl-9 pr-3 text-sm outline-none focus:border-accent" /></form>}>
      {loading && !data ? <Skeleton className="h-60" /> : !data?.users.length ? <Empty title="No users found" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2">User</th><th>Role</th><th>Status</th><th>2FA</th><th>Mode</th><th>Orders</th><th>Bots</th><th>Last login</th><th /></tr></thead>
            <tbody>
              {data.users.map((u: any) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="py-2"><div className="font-medium">@{u.handle} <span className="text-muted">{u.display_name}</span></div><div className="text-xs text-faint">{u.email}</div></td>
                  <td><select value={u.role} onChange={(e) => patch(u.id, { role: e.target.value })} className="h-8 rounded-lg border border-line bg-bg-2 px-2 text-xs">{["user", "admin", "compliance", "support"].map((r) => <option key={r}>{r}</option>)}</select></td>
                  <td><StatusPill status={u.status === "active" ? "running" : "halted"} /></td>
                  <td>{u.totp_enabled ? <CheckCircle2 className="size-4 text-up" /> : <XCircle className="size-4 text-faint" />}</td>
                  <td><PaperBadge paper={u.trading_mode !== "live"} /></td>
                  <td className="num">{u.orders}</td><td className="num">{u.bots_running}</td>
                  <td className="text-xs text-muted">{u.last_login ? ago(u.last_login) : "never"}</td>
                  <td className="text-right">
                    {u.status === "active"
                      ? <Button size="sm" variant="ghost" className="text-down" onClick={() => confirm(`Suspend @${u.handle}? Sessions are revoked and bots halted.`) && patch(u.id, { status: "suspended" })}>Suspend</Button>
                      : <Button size="sm" variant="ghost" onClick={() => patch(u.id, { status: "active" })}>Reactivate</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ───────── Trading activity ───────── */
function Trading() {
  const { data, loading } = useApi<any>("/api/admin/orders", { refreshMs: 15000 });
  if (loading && !data) return <Skeleton className="h-96" />;
  if (!data) return null;
  const pl = data.paperLive ?? {};
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-line bg-panel/70 p-4"><div className="text-xs text-muted">Paper orders (7d)</div><div className="num mt-1 text-2xl font-semibold">{pl.paper ?? 0}</div><div className="text-[11px] text-faint">{usd(pl.paper_volume, { compact: true })} simulated volume</div></div>
        <div className="rounded-2xl border border-line bg-panel/70 p-4"><div className="text-xs text-muted">Live orders (7d)</div><div className="num mt-1 text-2xl font-semibold">{pl.live ?? 0}</div><div className="text-[11px] text-faint">{usd(pl.live_volume, { compact: true })} volume</div></div>
        <Card title="By status" className="md:col-span-1"><div className="flex flex-wrap gap-1">{data.byStatus.map((s: any) => <span key={s.status} className="inline-flex items-center gap-1 text-xs"><StatusPill status={s.status} /><span className="num text-muted">{s.n}</span></span>)}</div></Card>
        <Card title="By source"><div className="flex flex-wrap gap-1">{data.bySource.map((s: any) => <Badge key={s.source}>{s.source} · {s.n}</Badge>)}</div></Card>
      </div>
      <Card title="Recent orders (all users)">
        {!data.recent.length ? <Empty title="No orders yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead><tr className="text-left text-xs text-muted"><th className="py-2">Time</th><th>User</th><th>Order</th><th>Asset</th><th>Size</th><th>Source</th><th>Provider</th><th>Status</th></tr></thead>
              <tbody>
                {data.recent.map((o: any) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="py-2 text-xs text-muted">{ago(o.created_at)}</td><td>@{o.handle}</td>
                    <td><span className={o.side === "buy" ? "text-up" : "text-down"}>{o.side.toUpperCase()}</span> <span className="text-xs text-muted">{o.order_type}</span></td>
                    <td>{o.symbol} <span className="text-xs text-faint">{o.venue}</span></td>
                    <td className="num">{o.notional_usd ? usd(o.notional_usd) : o.quantity}</td>
                    <td><Badge>{o.source}</Badge></td><td className="text-xs">{o.provider_id} {o.is_paper && <PaperBadge />}</td>
                    <td title={o.status_reason ?? ""}><StatusPill status={o.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ───────── Compliance ───────── */
function Compliance() {
  const flags = useApi<any>("/api/admin/flags");
  const jur = useApi<any>("/api/admin/jurisdictions");
  const toast = useToast();
  const [pending, setPending] = useState<{ key: string; enabled: boolean; needsRef: boolean } | null>(null);
  const [ref, setRef] = useState(""); const [code, setCode] = useState(""); const [busy, setBusy] = useState(false);
  const [j, setJ] = useState({ country: "", feature: "live_crypto_trading", allowed: false });

  async function submitFlag(key: string, enabled: boolean, approvalReference?: string, c?: string) {
    setBusy(true);
    try { await api("/api/admin/flags", { method: "POST", json: { key, enabled, approvalReference, code: c } }); toast(`${key} ${enabled ? "enabled" : "disabled"}`, "up"); setPending(null); setRef(""); setCode(""); flags.refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  function toggle(f: any, enabled: boolean) {
    if (f.key === "global_trading_halt" && enabled) {
      if (confirm("Engage the GLOBAL TRADING HALT? All order submission and bots stop platform-wide immediately.")) submitFlag(f.key, true);
      return;
    }
    if (f.requires_approval || f.key === "global_trading_halt") setPending({ key: f.key, enabled, needsRef: f.key !== "global_trading_halt" });
    else submitFlag(f.key, enabled);
  }
  const halt = flags.data?.flags.find((f: any) => f.key === "global_trading_halt");

  return (
    <div className="space-y-4">
      {halt && (
        <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4", halt.enabled ? "border-down bg-down-soft" : "border-line bg-panel/70")}>
          <div className="flex items-center gap-3">
            <AlertOctagon className={cx("size-7", halt.enabled ? "text-down" : "text-muted")} />
            <div><div className="font-semibold">{halt.enabled ? "GLOBAL TRADING HALT ACTIVE" : "Emergency trading shutdown"}</div><div className="text-xs text-muted">Stops all order submission and bot activity platform-wide.</div></div>
          </div>
          {halt.enabled ? <Button onClick={() => toggle(halt, false)}>Lift halt (2FA)</Button> : <Button variant="danger" size="lg" onClick={() => toggle(halt, true)}>Halt all trading</Button>}
        </div>
      )}
      <Card title="Feature flags" icon={<Scale className="size-4 text-accent-2" />}>
        {flags.data && !flags.data.flags[0]?.live_allowed_by_env && (
          <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Real-money features are locked for this deployment (MEROD_ALLOW_LIVE_FLAGS is not true). Paper trading remains available.</p>
        )}
        {flags.loading && !flags.data ? <Skeleton className="h-60" /> : (
          <div className="divide-y divide-line">
            {flags.data?.flags.filter((f: any) => f.key !== "global_trading_halt").map((f: any) => (
              <div key={f.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><code className="font-mono text-sm">{f.key}</code>{f.real_money && <Badge tone="down">real money</Badge>}{f.requires_approval && <Badge tone="warn">approval + 2FA</Badge>}</div>
                  <div className="text-xs text-muted">{f.description}</div>
                  {(f.approval_reference || f.updated_by) && <div className="text-[11px] text-faint">{f.approval_reference && <>Ref: {f.approval_reference} · </>}{f.updated_by && <>by @{f.updated_by} </>}{ago(f.updated_at)}</div>}
                </div>
                <Toggle checked={f.enabled} onChange={(v) => toggle(f, v)} disabled={f.real_money && !f.enabled && !f.live_allowed_by_env} />
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Jurisdiction rules">
        <p className="mb-3 text-xs text-muted">Allow or block features per country (ISO-2). Countries without a rule are not restricted by this table.</p>
        <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
          e.preventDefault();
          try { await api("/api/admin/jurisdictions", { method: "POST", json: { ...j, country: j.country.toUpperCase() } }); jur.refresh(); toast("Rule saved", "up"); }
          catch (er: any) { toast(er.body?.issues?.[0]?.message ?? er.message, "down"); }
        }}>
          <Input label="Country" className="w-24" maxLength={2} value={j.country} onChange={(e) => setJ({ ...j, country: e.target.value })} placeholder="US" />
          <Select label="Feature" className="w-60" value={j.feature} onChange={(e) => setJ({ ...j, feature: e.target.value })}>
            {(flags.data?.flags ?? []).map((f: any) => <option key={f.key}>{f.key}</option>)}
          </Select>
          <Select label="Rule" className="w-32" value={j.allowed ? "allow" : "block"} onChange={(e) => setJ({ ...j, allowed: e.target.value === "allow" })}><option value="block">Block</option><option value="allow">Allow</option></Select>
          <Button type="submit" variant="primary">Save rule</Button>
        </form>
        {!jur.data?.rules.length ? <Empty title="No jurisdiction rules" /> : (
          <div className="flex flex-wrap gap-2">
            {jur.data.rules.map((r: any) => (
              <span key={`${r.country}-${r.feature}`} className="inline-flex items-center gap-2 rounded-xl border border-line bg-bg-2 px-3 py-1.5 text-xs">
                <b>{r.country}</b> {r.feature} <Badge tone={r.allowed ? "up" : "down"}>{r.allowed ? "allowed" : "blocked"}</Badge>
                <button className="text-faint hover:text-down" onClick={async () => { await api("/api/admin/jurisdictions", { method: "DELETE", json: { country: r.country, feature: r.feature } }); jur.refresh(); }}>×</button>
              </span>
            ))}
          </div>
        )}
      </Card>
      <Modal open={!!pending} onClose={() => setPending(null)} title={`${pending?.enabled ? "Enable" : "Disable"} ${pending?.key}`}>
        <form onSubmit={(e) => { e.preventDefault(); pending && submitFlag(pending.key, pending.enabled, ref || undefined, code); }} className="space-y-3">
          <p className="text-sm text-muted">This is a compliance-controlled change. It is recorded in the audit log and compliance records.</p>
          {pending?.needsRef && <Input label="Approval reference" required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Agreement, license or ticket ID" />}
          <Input label="2FA code" required inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} hint="From your authenticator app. Enable 2FA in Settings → Security if you haven't." />
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button type="submit" variant="primary" loading={busy}>Confirm</Button></div>
        </form>
      </Modal>
    </div>
  );
}

/* ───────── Audit ───────── */
function Audit() {
  const [action, setAction] = useState(""); const [userId, setUserId] = useState("");
  const [filters, setFilters] = useState({ action: "", userId: "" });
  const [pages, setPages] = useState<any[][]>([]);
  const [verify, setVerify] = useState<any>(null); const [verifying, setVerifying] = useState(false);
  const qs = `action=${encodeURIComponent(filters.action)}&userId=${encodeURIComponent(filters.userId)}`;
  const first = useApi<any>(`/api/admin/audit?${qs}`);
  const toast = useToast();
  const all = [...(first.data?.entries ?? []), ...pages.flat()];
  async function more() {
    const last = all.at(-1);
    if (!last) return;
    const r = await api(`/api/admin/audit?${qs}&before=${last.id}`);
    setPages((p) => [...p, r.entries]);
  }
  return (
    <Card title="Security & audit log" icon={<ScrollText className="size-4 text-accent-2" />}
      action={<Button size="sm" variant="outline" loading={verifying} onClick={async () => {
        setVerifying(true);
        try { const r = await api("/api/admin/audit", { method: "POST" }); setVerify(r.result); toast(r.result.message, r.result.ok ? "up" : "down"); }
        catch (e: any) { toast(e.message, "down"); } finally { setVerifying(false); }
      }}>Verify hash chain</Button>}>
      {verify && (
        <p className={cx("mb-3 flex gap-2 rounded-lg px-3 py-2 text-xs", verify.ok ? "bg-up-soft text-up" : "bg-down-soft text-down")}>
          {verify.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{verify.message}{verify.brokenId && ` — first broken row #${verify.brokenId}`}
        </p>
      )}
      <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setPages([]); setFilters({ action, userId }); }}>
        <Input label="Action contains" className="w-56" value={action} onChange={(e) => setAction(e.target.value)} placeholder="order., integration., flag." />
        <Input label="User ID" className="w-80" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="uuid" />
        <Button type="submit">Filter</Button>
      </form>
      {first.loading && !first.data ? <Skeleton className="h-60" /> : !all.length ? <Empty title="No audit entries" /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead><tr className="text-left text-muted"><th className="py-2">#</th><th>Time</th><th>Actor</th><th>User</th><th>Action</th><th>Target</th><th>Data</th></tr></thead>
              <tbody>
                {all.map((a: any) => (
                  <tr key={a.id} className="border-t border-line align-top">
                    <td className="num py-1.5 text-faint">{a.id}</td><td className="whitespace-nowrap text-muted">{new Date(a.created_at).toLocaleString()}</td>
                    <td><Badge>{a.actor_type}</Badge></td><td>{a.handle ? `@${a.handle}` : "—"}</td>
                    <td className="font-mono text-text">{a.action}</td><td className="max-w-40 truncate font-mono text-faint" title={a.target}>{a.target ?? "—"}</td>
                    <td className="max-w-md"><code className="line-clamp-2 break-all text-[11px] text-muted" title={JSON.stringify(a.data)}>{JSON.stringify(a.data)}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-center"><Button size="sm" onClick={more}>Load older</Button></div>
        </>
      )}
    </Card>
  );
}
