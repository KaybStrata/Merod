"use client";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X, MessageSquare } from "lucide-react";
import { useApi } from "@/lib/api";
import { cx } from "@/components/ui";

const KEY = "merod-talk-tabs";
const load = (): string[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : []; } catch { return []; } };
const save = (t: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ } };

/**
 * Tabs for Talk: keep several conversations open and switch between them like browser tabs. Each tab is its own
 * conversation, so Auton (and anything else) reporting to a tab stays separate; Activity → Auton can show just that tab.
 * "+" opens a fresh conversation in a new tab; ✕ closes a tab (the conversation stays in the sidebar list).
 */
export function TalkTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const cur = pathname === "/talk" ? sp.get("c") : null;
  const [tabs, setTabs] = useState<string[]>([]);
  const [blank, setBlank] = useState(false); // a "New conversation" tab with no messages yet
  const convs = useApi<any>("/api/ai/conversations", { refreshMs: 30_000 });
  const titles = useMemo(() => new Map<string, string>((convs.data?.conversations ?? []).map((c: any) => [c.id, c.title || "Conversation"])), [convs.data]);

  useEffect(() => { setTabs(load()); }, []);
  // The open conversation is always a tab.
  useEffect(() => {
    if (pathname !== "/talk") return;
    if (cur) { setBlank(false); setTabs((t) => { if (t.includes(cur)) return t; const n = [...t, cur].slice(-20); save(n); return n; }); }
    else setBlank(true);
  }, [cur, pathname]);
  // Forget tabs whose conversation was deleted.
  useEffect(() => {
    if (!convs.data) return;
    setTabs((t) => { const n = t.filter((id) => titles.has(id)); if (n.length !== t.length) save(n); return n; });
  }, [convs.data, titles]);

  if (pathname !== "/talk" && !tabs.length) return null;
  const close = (id: string) => {
    const i = tabs.indexOf(id), n = tabs.filter((x) => x !== id);
    setTabs(n); save(n);
    if (id === cur) router.push(n.length ? `/talk?c=${n[Math.min(i, n.length - 1)]}` : "/talk");
  };
  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-bg-2/60 px-2 pt-1" role="tablist" aria-label="Talk tabs">
      {tabs.map((id) => (
        <div key={id} role="tab" aria-selected={id === cur}
          className={cx("group flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-2.5 py-1 text-[12px]", id === cur ? "border-line bg-bg text-text" : "border-transparent text-muted hover:bg-panel-2 hover:text-text")}>
          <button onClick={() => router.push(`/talk?c=${id}`)} className="flex min-w-0 items-center gap-1.5" title={titles.get(id) ?? "Conversation"}>
            <MessageSquare className="size-3 shrink-0" /><span className="truncate">{titles.get(id) ?? "Conversation"}</span>
          </button>
          <button onClick={() => close(id)} className="rounded p-0.5 text-faint opacity-60 hover:bg-panel-2 hover:text-text group-hover:opacity-100" aria-label="Close tab"><X className="size-3" /></button>
        </div>
      ))}
      {blank && pathname === "/talk" && (
        <div className="flex shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 border-line bg-bg px-2.5 py-1 text-[12px] text-text"><MessageSquare className="size-3" />New conversation</div>
      )}
      <button onClick={() => router.push("/talk")} className="mb-0.5 ml-0.5 shrink-0 rounded-md p-1 text-faint hover:bg-panel-2 hover:text-text" title="New tab (new conversation)" aria-label="New tab"><Plus className="size-3.5" /></button>
    </div>
  );
}
