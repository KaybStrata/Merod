"use client";
import { useState } from "react";
import Link from "next/link";
import { api, useApi } from "@/lib/api";
import { Badge, Button, Modal, cx, useToast } from "@/components/ui";
import { CodeInput } from "@/components/settings/AccountSecurity";

/**
 * PAPER / LIVE badge with a real-money on/off switch (owner only) in the top bar.
 * ON turns on real-money crypto + stock trading (needs the server unlock and a 2FA code).
 * OFF is instant. Automated real-money trades stay a separate switch in Admin.
 */
export function RealMoneySwitch({ owner }: { owner: boolean }) {
  const toast = useToast();
  const { data, refresh } = useApi<any>(owner ? "/api/admin/real-money" : null, { refreshMs: 60_000 });
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState(""); const [code, setCode] = useState(""); const [busy, setBusy] = useState(false);
  const flags: any[] = data?.flags ?? [];
  const live = flags.some((f) => (f.key === "live_crypto_trading" || f.key === "live_brokerage_trading") && f.enabled);
  if (!owner) return <Badge tone="warn">PAPER</Badge>;

  async function setAll(enabled: boolean) {
    setBusy(true);
    try {
      for (const key of ["live_crypto_trading", "live_brokerage_trading"])
        await api("/api/admin/flags", { method: "POST", json: enabled ? { key, enabled, code } : { key, enabled } });
      toast(enabled ? "Real-money trading is ON" : "Real-money trading is OFF. Paper only.", "up");
      setOpen(false); setRef(""); setCode(""); refresh();
    } catch (e: any) { toast(e.message, "down"); refresh(); } finally { setBusy(false); }
  }

  return (
    <>
      <Badge tone={live ? "down" : "warn"}>{live ? "LIVE" : "PAPER"}</Badge>
      <button onClick={() => (live ? setAll(false) : setOpen(true))} disabled={!data || busy} title={live ? "Real-money trading is ON. Tap to turn it off" : "Turn on real-money trading"}
        aria-label="Real-money trading switch" className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[11px] text-muted hover:text-text disabled:opacity-50">
        <span className={cx("relative h-4 w-7 rounded-full transition-colors", live ? "bg-down" : "bg-panel-2")}><span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", live ? "left-[14px]" : "left-0.5")} /></span>
        Real money
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Turn on real-money trading">
        {!data?.envUnlocked ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Real-money trading is locked at the server (a safety lock on Railway called MEROD_ALLOW_LIVE_FLAGS). It has to be unlocked before this switch can turn on.</p>
            <ul className="space-y-1 text-xs">
              <li>{data?.envUnlocked ? "✅" : "❌"} Server unlock</li>
              <li>{data?.twoFactor ? "✅" : "❌"} Two-factor authentication (Settings → Security)</li>
              <li>{data?.liveAccounts?.length ? "✅" : "❌"} A connected real account (Wallet & funding)</li>
            </ul>
            <div className="flex justify-end"><Link href="/admin" onClick={() => setOpen(false)}><Button variant="primary">Open Admin</Button></Link></div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); setAll(true); }} className="space-y-3">
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Real money. Orders in your connected real accounts (crypto and stocks) will move real funds. You can switch it off any time from here.</p>
            {!data.twoFactor && <p className="text-xs text-down">Turn on two-factor authentication in <Link href="/settings?tab=security" className="underline">Settings → Security</Link> first.</p>}
            <div><span className="mb-1 block text-xs font-medium text-muted">Code from your authenticator app</span><CodeInput value={code} onChange={setCode} autoFocus /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="danger" loading={busy}>Turn on</Button></div>
          </form>
        )}
      </Modal>
    </>
  );
}
