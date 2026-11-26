import { Check } from "lucide-react";

export const STEPS = ["Account", "Trading style", "Connect", "Start"];

/** "Step N of 4" progress used on signup and onboarding. */
export function Steps({ at }: { at: number }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Step {at} of {STEPS.length}</div>
      <ol className="mt-2 flex items-center gap-1.5">
        {STEPS.map((s, i) => {
          const n = i + 1, done = n < at, cur = n === at;
          return (
            <li key={s} className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={`h-1 rounded-full ${done || cur ? "bg-accent-2" : "bg-panel-2"}`} />
              <span className={`flex items-center gap-1 truncate text-[10.5px] ${cur ? "text-text" : "text-faint"}`}>{done && <Check className="size-3 text-up" />}{s}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
