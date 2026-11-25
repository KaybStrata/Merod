"use client";
import { useState } from "react";
import { api, useApi } from "@/lib/api";
import { cx, useToast } from "@/components/ui";
import { useRealtime } from "./context";
import { ago } from "@/lib/format";

function Mini({ on, busy, onClick, label, title }: { on: boolean; busy?: boolean; onClick: () => void; label: string; title: string }) {
  return (
    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} disabled={busy} aria-label={label} title={title}
      className={cx("relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50", on ? "bg-up" : "bg-panel-2 ring-1 ring-line")}>
      <span className={cx("absolute top-0.5 size-3 rounded-full bg-white transition-all", on ? "left-[14px]" : "left-0.5")} />
    </button>
  );
}

/** Integrations → Auto enable: switch on and test every integration that has its keys saved. */
export function AutoEnableSwitch() {
  const toast = useToast();
  const { data, setData } = useApi<any>("/api/admin/integrations/auto-enable");
  const [busy, setBusy] = useState(false);
  const on = !!data?.enabled;
  return <Mini on={on} busy={busy || !data} label="Auto enable integrations" title={on ? "Auto enable is ON: integrations with saved keys are switched on and tested automatically" : "Auto enable: switch on every integration that has its keys saved"}
    onClick={async () => {
      setBusy(true);
      try { const r = await api("/api/admin/integrations/auto-enable", { method: "POST", json: { enabled: !on } }); setData(r); toast(r.enabled ? "Auto enable ON: switching on and testing every integration with saved keys…" : "Auto enable OFF", "up"); }
      catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
    }} />;
}

/** Auto trading on/off from the menu. */
export function AutoTradingSwitch() {
  const toast = useToast();
  const { data, refresh } = useApi<any>("/api/auto/activity", { refreshMs: 8000 });
  const [busy, setBusy] = useState(false);
  const on = !!data?.enabled;
  return <Mini on={on} busy={busy || !data} label="Auto trading switch" title={on ? "Auto trading is ON. Tap to stop" : "Turn auto trading on"}
    onClick={async () => {
      setBusy(true);
      try { await api("/api/auto", { method: "PATCH", json: { enabled: !on } }); await refresh(); toast(on ? "Auto trading is OFF" : "Auto trading is ON", "up"); }
      catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
    }} />;
}

const DOT: Record<string, string> = { execution: "bg-up", close: "bg-accent-2", decision: "bg-warn", thought: "bg-faint" };

/** Live feed under Auto trading: executions, decisions and Modo's thought process. */
export function AutoActivityFeed() {
  const { data, refresh } = useApi<any>("/api/auto/activity", { refreshMs: 8000 });
  useRealtime((e: any) => { if (e.type === "auto") refresh(); });
  const events: any[] = data?.events ?? [];
  const live = data?.enabled || data?.modoAutopilot;
  return (
    <div className="my-1 rounded-lg border border-line bg-bg/40 p-1.5">
      <div className="mb-1 flex items-center justify-between px-0.5 text-[9px] font-semibold uppercase tracking-wide text-faint">
        <span>Activity</span>
        <span className={cx("flex items-center gap-1 normal-case", live ? "text-up" : "")}><span className={cx("size-1.5 rounded-full", live ? "bg-up pulse-dot" : "bg-faint")} />{live ? "live" : "off"}</span>
      </div>
      {events.length === 0
        ? <p className="px-0.5 text-[10px] leading-snug text-faint">{live ? "Watching the markets…" : "Turn auto trading or Modo Autopilot on to see decisions here."}</p>
        : <ul className="max-h-40 space-y-1 overflow-y-auto pr-0.5">{events.map((e, i) => (
            <li key={i} className="flex gap-1.5 text-[10px] leading-snug">
              <span className={cx("mt-1 size-1.5 shrink-0 rounded-full", DOT[e.kind])} />
              <span className="min-w-0"><span className={e.kind === "thought" ? "text-muted" : "text-text"}>{e.text}</span> <span className="text-faint">{ago(e.at)}</span></span>
            </li>))}</ul>}
    </div>
  );
}
