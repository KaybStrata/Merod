"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Send, BookUser, ListChecks, Copy, ShieldAlert, Lock, Trash2, Landmark } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Card, Empty, Input, Pills, Select, StatusPill, cx, useToast } from "@/components/ui";
import { usd, ago, qty } from "@/lib/format";

type Tab = "deposit" | "withdraw" | "send" | "addresses" | "requests";

export function FundingPanel({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/wallet/funding");
  const [tab, setTab] = useState<Tab>("deposit");
  const [busy, setBusy] = useState<string | null>(null);
  const done = () => { refresh(); onChanged?.(); };
  async function run(key: string, body: any, okMsg: string) {
    setBusy(key);
    try { const r = await api("/api/wallet/funding", { method: "POST", json: body }); toast(okMsg, "up"); done(); return r; }
    catch (e: any) { toast(e.body?.issues?.[0]?.message ?? e.message, "down"); return null; }
    finally { setBusy(null); }
  }
  if (!data) return <Card title="Deposit & withdraw"><div className="h-40 animate-pulse rounded-xl bg-panel-2" /></Card>;
  const accounts: any[] = data.accounts;
  const paper = accounts.filter((a) => a.kind === "paper");
  const wallets = accounts.filter((a) => a.kind === "wallet" && a.external_ref);
  const brokers = accounts.filter((a) => a.kind === "brokerage");

  return (
    <Card title="Deposit, withdraw & transfer" icon={<Landmark className="size-4 text-accent-2" />}
      action={<Pills size="sm" value={tab} onChange={setTab} options={[
        { value: "deposit", label: <span className="flex items-center gap-1"><ArrowDownToLine className="size-3.5" />Deposit</span> },
        { value: "withdraw", label: <span className="flex items-center gap-1"><ArrowUpFromLine className="size-3.5" />Withdraw cash</span> },
        { value: "send", label: <span className="flex items-center gap-1"><Send className="size-3.5" />Send crypto</span> },
        { value: "addresses", label: <span className="flex items-center gap-1"><BookUser className="size-3.5" />Address book</span> },
        { value: "requests", label: <span className="flex items-center gap-1"><ListChecks className="size-3.5" />Requests</span> },
      ]} />}>
      <div className="mb-3 flex flex-wrap gap-1.5 text-[11px]">
        <Badge tone="up">Paper funding: available</Badge>
        <Badge tone={data.rails.ach.available ? "up" : "warn"} title={data.rails.ach.note}>Bank (ACH): {data.rails.ach.available ? "available" : "disabled"}</Badge>
        <Badge tone={data.rails.crypto.available ? "up" : "warn"} title={data.rails.crypto.note}>Crypto transfers: {data.rails.crypto.available ? "available" : "disabled"}</Badge>
        <Badge>24h withdrawal limit {usd(data.limits.maxDailyWithdrawalUsd)} · used {usd(data.limits.usedLast24hUsd)}</Badge>
      </div>
      {tab === "deposit" && <DepositTab data={data} paper={paper} wallets={wallets} brokers={brokers} run={run} busy={busy} />}
      {tab === "withdraw" && <WithdrawTab data={data} paper={paper} brokers={brokers} run={run} busy={busy} />}
      {tab === "send" && <SendTab data={data} wallets={wallets} run={run} busy={busy} goAddresses={() => setTab("addresses")} />}
      {tab === "addresses" && <AddressesTab data={data} run={run} busy={busy} />}
      {tab === "requests" && <RequestsTab data={data} run={run} busy={busy} />}
    </Card>
  );
}

function Locked({ text }: { text: string }) {
  return <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn"><Lock className="mt-px size-3.5 shrink-0" />{text}</div>;
}
const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

function DepositTab({ data, paper, wallets, brokers, run, busy }: any) {
  const [accountId, setAccountId] = useState<string>(paper[0]?.id ?? wallets[0]?.id ?? "");
  const [amount, setAmount] = useState("10000");
  const [info, setInfo] = useState<any>(null);
  const [bank, setBank] = useState({ bankLinkId: "", amount: "", processorToken: "", nickname: "", code: "" });
  const acct = [...paper, ...wallets, ...brokers].find((a: any) => a.id === accountId);
  useEffect(() => {
    setInfo(null);
    if (acct?.kind === "wallet") api(`/api/wallet/funding?deposit=${acct.id}`).then((r: any) => setInfo(r.deposit)).catch(() => {});
  }, [accountId]); // eslint-disable-line
  const banks = data.banks.filter((b: any) => b.account_id === accountId);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Select label="Deposit into" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {paper.length > 0 && <optgroup label="Paper trading">{paper.map((a: any) => <option key={a.id} value={a.id}>{a.label} · {usd(a.cash_balance)}</option>)}</optgroup>}
        {wallets.length > 0 && <optgroup label="Crypto wallets">{wallets.map((a: any) => <option key={a.id} value={a.id}>{a.label} ({a.network})</option>)}</optgroup>}
        {brokers.length > 0 && <optgroup label="Stock brokerage">{brokers.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>}
      </Select>
      <div>
        {!acct && <Empty title="No account selected">Connect a wallet or brokerage above, or use your paper account.</Empty>}
        {acct?.kind === "paper" && (
          <div className="space-y-3">
            <p className="text-sm text-muted">Add <b className="text-text">virtual</b> cash to practice stock and crypto trading. No real money moves.</p>
            <div className="flex flex-wrap items-end gap-2">
              <Input label="Amount (USD)" type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-48" />
              {["1000", "10000", "50000"].map((v) => <Button key={v} size="sm" variant="ghost" onClick={() => setAmount(v)}>{usd(Number(v))}</Button>)}
              <Button variant="primary" loading={busy === "pd"} disabled={!(Number(amount) > 0)} onClick={() => run("pd", { action: "paper_deposit", accountId, amount: Number(amount), idempotencyKey: key() }, `Added ${usd(Number(amount))} virtual cash`)}>Add virtual funds</Button>
            </div>
          </div>
        )}
        {acct?.kind === "wallet" && (info ? (
          <div className="flex flex-col gap-4 sm:flex-row">
            <img src={info.qr} alt="Deposit address QR code" width={168} height={168} className="rounded-xl bg-white p-2" />
            <div className="min-w-0 space-y-2 text-sm">
              <div className="text-xs text-muted">Send {info.networkLabel} assets to</div>
              <div className="flex items-center gap-2"><code className="break-all rounded-lg bg-bg-2 px-2 py-1 font-mono text-xs">{info.address}</code>
                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard?.writeText(info.address)}><Copy className="size-3.5" /></Button></div>
              <p className="flex gap-1.5 text-xs text-warn"><ShieldAlert className="size-3.5 shrink-0" />{info.warning}</p>
              <p className="text-xs text-muted">{info.custody}</p>
              {info.assets.length > 0 && <div className="flex flex-wrap gap-1">{info.assets.slice(0, 10).map((a: any) => <Badge key={a.id}>{a.symbol}</Badge>)}</div>}
            </div>
          </div>
        ) : <div className="h-40 animate-pulse rounded-xl bg-panel-2" />)}
        {acct?.kind === "brokerage" && (
          <div className="space-y-3">
            {!data.rails.ach.available && <Locked text={data.rails.ach.note} />}
            <p className="text-sm text-muted">Fund stock trading by bank transfer (ACH, typically 1–3 business days). Bank details go straight to the brokerage via Plaid — Merod stores only the last 4 digits.</p>
            {banks.length === 0 ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <Input label="Plaid processor token" value={bank.processorToken} onChange={(e) => setBank({ ...bank, processorToken: e.target.value })} hint="From Plaid Link" />
                <Input label="Nickname" value={bank.nickname} onChange={(e) => setBank({ ...bank, nickname: e.target.value })} />
                <Input label="2FA code" inputMode="numeric" maxLength={6} value={bank.code} onChange={(e) => setBank({ ...bank, code: e.target.value.replace(/\D/g, "") })} />
                <div className="sm:col-span-3"><Button disabled={!data.rails.ach.available || !bank.processorToken} loading={busy === "lb"} onClick={() => run("lb", { action: "link_bank", accountId, processorToken: bank.processorToken, nickname: bank.nickname || undefined, code: bank.code }, "Bank linked — pending verification")}>Link bank account</Button></div>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Select label="From bank" value={bank.bankLinkId} onChange={(e) => setBank({ ...bank, bankLinkId: e.target.value })} className="w-56">
                  <option value="">Select…</option>{banks.map((b: any) => <option key={b.id} value={b.id} disabled={b.status !== "approved"}>{b.nickname} ••{b.mask ?? "—"} ({b.status})</option>)}
                </Select>
                <Input label="Amount (USD)" type="number" value={bank.amount} onChange={(e) => setBank({ ...bank, amount: e.target.value })} className="w-40" />
                <Button variant="primary" disabled={!data.rails.ach.available || !bank.bankLinkId || !(Number(bank.amount) > 0)} loading={busy === "ad"}
                  onClick={() => run("ad", { action: "ach_deposit", accountId, bankLinkId: bank.bankLinkId, amount: Number(bank.amount), idempotencyKey: key() }, "Deposit submitted")}>Deposit</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WithdrawTab({ data, paper, brokers, run, busy }: any) {
  const [accountId, setAccountId] = useState<string>(paper[0]?.id ?? "");
  const [f, setF] = useState({ amount: "", bankLinkId: "", code: "" });
  const acct = [...paper, ...brokers].find((a: any) => a.id === accountId);
  const banks = data.banks.filter((b: any) => b.account_id === accountId && b.status === "approved");
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Select label="Withdraw from" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {paper.length > 0 && <optgroup label="Paper trading">{paper.map((a: any) => <option key={a.id} value={a.id}>{a.label} · {usd(a.cash_balance)}</option>)}</optgroup>}
        {brokers.length > 0 && <optgroup label="Stock brokerage">{brokers.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>}
      </Select>
      <div className="space-y-3">
        {acct?.kind === "paper" && <>
          <p className="text-sm text-muted">Remove virtual cash from your paper account (simulated).</p>
          <div className="flex flex-wrap items-end gap-2">
            <Input label="Amount (USD)" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="w-48" />
            <Button loading={busy === "pw"} disabled={!(Number(f.amount) > 0)} onClick={() => run("pw", { action: "paper_withdraw", accountId, amount: Number(f.amount), idempotencyKey: key() }, `Withdrew ${usd(Number(f.amount))} virtual cash`)}>Withdraw virtual funds</Button>
          </div>
        </>}
        {acct?.kind === "brokerage" && <>
          {!data.flags.withdrawals && <Locked text="Cash withdrawals are disabled until compliance approval. A 2FA code is always required." />}
          <p className="text-sm text-muted">Withdraw settled cash to your linked bank account (ACH). Withdrawals need a fresh 2FA code and count toward your 24h limit.</p>
          <div className="flex flex-wrap items-end gap-2">
            <Select label="To bank" value={f.bankLinkId} onChange={(e) => setF({ ...f, bankLinkId: e.target.value })} className="w-56">
              <option value="">{banks.length ? "Select…" : "No approved bank linked"}</option>{banks.map((b: any) => <option key={b.id} value={b.id}>{b.nickname} ••{b.mask ?? "—"}</option>)}
            </Select>
            <Input label="Amount (USD)" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="w-36" />
            <Input label="2FA code" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} className="w-32" />
            <Button variant="danger" loading={busy === "aw"} disabled={!f.bankLinkId || !(Number(f.amount) > 0) || f.code.length !== 6}
              onClick={() => run("aw", { action: "ach_withdraw", accountId, bankLinkId: f.bankLinkId, amount: Number(f.amount), code: f.code, idempotencyKey: key() }, "Withdrawal submitted")}>Withdraw</Button>
          </div>
        </>}
        {!acct && <Empty title="Choose an account" />}
        <p className="text-[11px] text-faint">Crypto lives in your own wallets — use “Send crypto” to move it to another wallet.</p>
      </div>
    </div>
  );
}

function SendTab({ data, wallets, run, busy, goAddresses }: any) {
  const [f, setF] = useState({ accountId: wallets[0]?.id ?? "", assetId: "", amount: "", addressId: "", code: "" });
  const [assets, setAssets] = useState<any[]>([]);
  const [created, setCreated] = useState<any>(null);
  const [hash, setHash] = useState("");
  const acct = wallets.find((w: any) => w.id === f.accountId);
  useEffect(() => { if (f.accountId) api(`/api/wallet/funding?deposit=${f.accountId}`).then((r: any) => setAssets(r.deposit.assets)).catch(() => setAssets([])); }, [f.accountId]);
  const addrs = useMemo(() => data.addresses.filter((a: any) => a.network === acct?.network), [data.addresses, acct]);
  if (!wallets.length) return <Empty title="No crypto wallet connected">Connect a wallet above to send crypto to a third-party address.</Empty>;
  if (created) return (
    <div className="space-y-3">
      <div className="rounded-xl border border-accent/30 bg-accent-soft p-3 text-sm">Transfer prepared. <b>Sign and send it with your wallet</b> — Merod never holds your keys.</div>
      <pre className="max-h-48 overflow-auto rounded-xl bg-bg-2 p-3 text-[11px]">{JSON.stringify(created.unsigned_tx, null, 2)}</pre>
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Transaction hash after sending" value={hash} onChange={(e) => setHash(e.target.value.trim())} className="min-w-72 flex-1" />
        <Button variant="primary" loading={busy === "sig"} disabled={hash.length < 32} onClick={async () => { if (await run("sig", { action: "crypto_transfer_signed", id: created.id, txHash: hash }, "Transfer recorded")) setCreated(null); }}>Record transfer</Button>
        <Button variant="ghost" onClick={async () => { await run("cx", { action: "cancel", id: created.id }, "Cancelled"); setCreated(null); }}>Cancel</Button>
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      {!data.flags.withdrawals && <Locked text="Crypto transfers are disabled until compliance approval. The form below validates everything (2FA, address hold, limits) and will work once approved." />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="From wallet" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value, assetId: "", addressId: "" })}>{wallets.map((w: any) => <option key={w.id} value={w.id}>{w.label} ({w.network})</option>)}</Select>
        <Select label="Asset" value={f.assetId} onChange={(e) => setF({ ...f, assetId: e.target.value })}><option value="">Select…</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.symbol}</option>)}</Select>
        <Input label="Amount" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Select label="To (address book)" value={f.addressId} onChange={(e) => setF({ ...f, addressId: e.target.value })}>
          <option value="">{addrs.length ? "Select…" : "No saved addresses"}</option>
          {addrs.map((a: any) => <option key={a.id} value={a.id} disabled={!a.usable}>{a.label} {a.address.slice(0, 6)}…{a.address.slice(-4)}{a.usable ? "" : " (on hold)"}</option>)}
        </Select>
        <Input label="2FA code" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" loading={busy === "ct"} disabled={!f.assetId || !(Number(f.amount) > 0) || !f.addressId || f.code.length !== 6}
          onClick={async () => { const r = await run("ct", { action: "crypto_transfer", ...f, amount: Number(f.amount), idempotencyKey: key() }, "Transfer prepared"); if (r?.request) setCreated(r.request); }}>Prepare transfer</Button>
        <Button variant="ghost" onClick={goAddresses}>Manage address book</Button>
        <span className="text-[11px] text-faint">New addresses have a {data.limits.coolingHours}h security hold.</span>
      </div>
    </div>
  );
}

function AddressesTab({ data, run, busy }: any) {
  const [f, setF] = useState({ label: "", network: "solana", address: "", code: "" });
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input label="Label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. My Ledger" />
        <Select label="Network" value={f.network} onChange={(e) => setF({ ...f, network: e.target.value })}>{data.networks.map((n: any) => <option key={n.id} value={n.id}>{n.label}</option>)}</Select>
        <Input label="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value.trim() })} className="lg:col-span-2" />
        <Input label="2FA code" inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />
      </div>
      <Button loading={busy === "aa"} disabled={!f.label || !f.address || f.code.length !== 6} onClick={async () => { if (await run("aa", { action: "add_address", ...f }, "Address saved — usable after the security hold")) setF({ ...f, label: "", address: "", code: "" }); }}>Save address</Button>
      {data.addresses.length === 0 ? <Empty title="No saved addresses" /> : (
        <div className="divide-y divide-line">
          {data.addresses.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0"><div className="font-medium">{a.label} <Badge>{a.network}</Badge> {a.usable ? <Badge tone="up">active</Badge> : <Badge tone="warn">on hold until {new Date(a.usable_after).toLocaleString()}</Badge>}</div>
                <code className="block truncate font-mono text-xs text-muted">{a.address}</code></div>
              <Button size="sm" variant="ghost" loading={busy === `rm${a.id}`} onClick={() => run(`rm${a.id}`, { action: "remove_address", id: a.id }, "Address removed")}><Trash2 className="size-3.5" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestsTab({ data, run, busy }: any) {
  if (!data.requests.length) return <Empty title="No funding requests yet" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-xs text-faint"><tr className="border-b border-line text-left"><th className="py-2 font-medium">When</th><th className="font-medium">Type</th><th className="font-medium">Rail</th><th className="text-right font-medium">Amount</th><th className="pl-3 font-medium">Status</th><th /></tr></thead>
        <tbody>{data.requests.map((r: any) => (
          <tr key={r.id} className="border-b border-line/60">
            <td className="py-2 text-muted">{ago(r.created_at)}</td>
            <td>{r.direction}{r.address_label ? ` → ${r.address_label}` : ""}</td>
            <td><Badge tone={r.rail === "paper" ? "warn" : "neutral"}>{r.rail === "paper" ? "paper (simulated)" : r.rail}</Badge></td>
            <td className="num text-right">{r.symbol ? `${qty(r.amount)} ${r.symbol}` : usd(r.amount)}</td>
            <td className={cx("pl-3")}><StatusPill status={r.status} /> <span className="text-[11px] text-faint">{r.status_reason}</span></td>
            <td className="text-right">{["pending_signature", "pending"].includes(r.status) && <Button size="sm" variant="ghost" loading={busy === `c${r.id}`} onClick={() => run(`c${r.id}`, { action: "cancel", id: r.id }, "Cancelled")}>Cancel</Button>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
