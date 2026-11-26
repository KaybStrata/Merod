"use client";
import { CheckCircle2, Circle, XCircle, Sparkles } from "lucide-react";
import { cx } from "@/components/ui";
import { PlanCard } from "@/components/shell/PlanCard";

const TYPE_LABEL: Record<string, string> = {
  order: "Order plan", bot: "Bot plan", mimic: "Mimic plan", alert: "Alert", executed: "Executed", confirm: "Confirmation", info: "Answer",
};

/** Plan pipeline shown above an order plan: Preview → Risk checks → Approval → Route → Executed. */
function Pipeline({ message }: { message: any }) {
  const p = message.plan?.plan;
  if (!p) return null;
  const failed = (p.checks ?? []).filter((c: any) => !c.ok && c.severity !== "warn").length;
  const passed = (p.checks ?? []).length - failed;
  const done = ["executed", "approved"].includes(message.status) || !!message.plan?.result;
  const steps: { label: string; detail: string; state: "ok" | "bad" | "wait" }[] = [
    { label: "Preview", detail: `${p.intent?.orderType ?? "market"} · ${p.asset?.symbol ?? ""}`, state: "ok" },
    { label: "Risk checks", detail: `${passed}/${(p.checks ?? []).length} passed`, state: failed ? "bad" : "ok" },
    { label: "Approval", detail: p.decision === "execute" ? "within limits" : p.decision === "rejected" ? "blocked" : done ? "approved" : "needs you", state: p.decision === "rejected" ? "bad" : done || p.decision === "execute" ? "ok" : "wait" },
    { label: "Route", detail: p.quote?.route ?? p.providerId ?? "engine", state: p.decision === "rejected" ? "bad" : done ? "ok" : "wait" },
    { label: "Executed", detail: done ? "filled" : "pending", state: done ? "ok" : "wait" },
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {steps.map((s, i) => {
        const I = s.state === "ok" ? CheckCircle2 : s.state === "bad" ? XCircle : Circle;
        return (
          <div key={s.label} className="flex items-center gap-1">
            <span className={cx("flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
              s.state === "ok" ? "border-up/30 bg-up-soft text-up" : s.state === "bad" ? "border-down/30 bg-down-soft text-down" : "border-line text-muted")}>
              <I className="size-3" /><span className="font-semibold">{s.label}</span><span className="text-faint">{s.detail}</span>
            </span>
            {i < steps.length - 1 && <span className="h-px w-3 bg-line-2" />}
          </div>
        );
      })}
    </div>
  );
}

/** Merod reply in the Ask Merod thread: text, then the plan (PlanCard keeps all approve / dismiss logic). */
export function MerodReply({ message, onChip }: { message: any; onChip: (t: string) => void }) {
  const t = message.plan?.type;
  const showHeader = t && t !== "clarify";
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent-soft"><Sparkles className="size-3.5 text-accent-2" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[12px]">
          <span className="font-semibold">Merod</span>
          {showHeader && <span className="rounded-md border border-line-2 px-1.5 py-px text-[10px] uppercase tracking-wider text-muted">{TYPE_LABEL[t] ?? t}</span>}
          {message.ai_provider && <span className="text-[10px] text-faint">{message.ai_provider === "merod" ? "rule parser" : `${message.ai_provider} · ${message.ai_model}`}</span>}
        </div>
        <div className={cx("mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed", message.status === "error" && "text-down")}>{message.content}</div>
        {t === "order" && <Pipeline message={message} />}
        {message.plan && (
          <div className={cx(showHeader && t !== "executed" && "surface mt-2 rounded-xl p-1")}>
            <PlanCard message={message} onChip={onChip} />
          </div>
        )}
      </div>
    </div>
  );
}
