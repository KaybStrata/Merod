"use client";
import { CheckCircle2, Sparkles } from "lucide-react";
import { PlanCard } from "@/components/shell/PlanCard";
import { cx } from "@/components/ui";
import { MerodAvatar } from "./Digest";
import { Widget, knownWidgets } from "./widgets/Widgets";

/** Reply types that get an action card (Approve / Dismiss etc.). app_action = settings and on/off changes from the prompt. */
const PLAN_TYPES = new Set(["order", "bot", "mimic", "confirm_action", "executed", "alert", "clarify", "app_action"]);
const STEPS = ["Preview", "Risk checks", "Approval", "Route", "Reconcile"];

/** Conversation thread: user bubbles on the right, Merod replies with text + typed widgets. Plans render via the existing PlanCard. */
export function TalkThread({ messages, onSend, onDone, allowed }: { messages: any[]; onSend: (t: string) => void; onDone: () => void; allowed?: string[] }) {
  return (
    <div className="space-y-5">
      {messages.map((m) => m.role === "user"
        ? <div key={m.id} className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-line-2 bg-panel-2/80 px-4 py-2.5 text-[14.5px]">{m.content}</div></div>
        : <MerodMessage key={m.id} m={m} onSend={onSend} onDone={onDone} allowed={allowed} />)}
    </div>
  );
}

function MerodMessage({ m, onSend, onDone, allowed }: { m: any; onSend: (t: string) => void; onDone: () => void; allowed?: string[] }) {
  const widgets = knownWidgets(m.plan?.widgets);
  const t = m.plan?.type;
  const showPlan = t && PLAN_TYPES.has(t);
  const side = widgets.filter((w) => w.kind === "chart" || w.kind === "clarify" || w.kind === "alert");
  const below = widgets.filter((w) => w.kind === "portfolio" || w.kind === "agents");
  return (
    <div className="flex items-start gap-3">
      <MerodAvatar />
      <div className="min-w-0 flex-1 space-y-3">
        {/* Plain text only: model and market text is never rendered as HTML. */}
        <div className={cx("whitespace-pre-wrap text-[14.5px] leading-relaxed", m.status === "error" && "text-down")}>{m.content}</div>
        {(showPlan || side.length > 0) && (
          <div className={cx("grid gap-3", showPlan && side.length > 0 && t !== "clarify" && "lg:grid-cols-2")}>
            {side.map((w, i) => <Widget key={`s${i}`} w={w} onSend={onSend} allowed={allowed} />)}
            {showPlan && (t === "clarify"
              ? <PlanCard message={m} onChip={onSend} onDone={onDone} />
              : <PlanBox m={m} onSend={onSend} onDone={onDone} />)}
          </div>
        )}
        {below.map((w, i) => <Widget key={`b${i}`} w={w} onSend={onSend} allowed={allowed} />)}
      </div>
    </div>
  );
}

/** The plan widget: the existing PlanCard (all approve/dismiss logic unchanged) inside the Talk look, with the engine pipeline. */
function PlanBox({ m, onSend, onDone }: { m: any; onSend: (t: string) => void; onDone: () => void }) {
  const t = m.plan?.type;
  const done = ["executed", "approved"].includes(m.status) || !!m.plan?.result || t === "executed";
  const blocked = m.status === "rejected";
  const label = done ? "Executed" : blocked ? "Blocked" : m.status === "needs_approval" ? "Checked" : "Plan";
  return (
    <div className={cx("rounded-2xl border p-4", done ? "border-up/40 bg-up-soft/10" : blocked ? "border-down/40" : "border-accent/50 bg-panel/70")}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-2"><Sparkles className="size-3.5" /> Plan · {label}</div>
      {t === "order" && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
          {STEPS.map((s, i) => {
            const ok = done || (i === 0) || (i === 1 && !blocked);
            return (
              <span key={s} className="flex items-center gap-1.5">
                {i > 0 && <span className="h-px w-4 bg-line-2" />}
                <CheckCircle2 className={cx("size-3.5", ok ? "text-up" : blocked && i === 1 ? "text-down" : "text-faint")} />
                <span className={ok ? "text-text" : "text-muted"}>{s}</span>
              </span>
            );
          })}
        </div>
      )}
      <PlanCard message={m} onChip={onSend} onDone={onDone} />
    </div>
  );
}
