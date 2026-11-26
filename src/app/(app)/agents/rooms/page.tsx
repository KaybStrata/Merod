"use client";
import { useEffect, useRef, useState } from "react";
import { MessagesSquare, Send, Hash, ShieldAlert } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { useRealtime } from "@/components/shell/context";
import { cx, useToast } from "@/components/ui";
import { PageHead, clock } from "@/components/agents/common";

const TYPE: Record<string, string> = {
  finding: "bg-up-soft text-up", proposal: "bg-[rgba(106,168,255,.14)] text-[#8fbcff]", validation: "bg-accent-soft text-accent-2", counterargument: "bg-down-soft text-down",
  handoff: "bg-panel-2 text-muted", escalation: "bg-warn-soft text-warn", instruction: "bg-accent-soft text-accent-2", knowledge: "bg-panel-2 text-muted", vote: "bg-panel-2 text-muted",
};

/** Agent Communication (screen 5 / Merod Nexus): rooms, structured findings, citations, handoffs, user intervention. */
export default function Rooms() {
  const rooms = useApi<any>("/api/agents/rooms", { refreshMs: 30000 });
  const [room, setRoom] = useState("general");
  const msgs = useApi<any>(`/api/agents/rooms?room=${encodeURIComponent(room)}`, { refreshMs: 15000 });
  const [text, setText] = useState("");
  const toast = useToast();
  const end = useRef<HTMLDivElement>(null);
  useRealtime((e) => { if (e.type === "agent_message" && e.payload?.room === room) msgs.refresh(); });
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.data]);
  async function send() {
    if (!text.trim()) return;
    try { await api("/api/agents/rooms", { method: "POST", json: { room, body: text } }); setText(""); msgs.refresh(); } catch (e: any) { toast(e.message, "down"); }
  }
  const list: any[] = rooms.data?.rooms ?? [];
  return (
    <div>
      <PageHead eyebrow="Merod Nexus" title="Agent" accent="Rooms" sub="Watch agents share findings, propose trades, challenge each other and hand off work. Step in with your own instruction at any time." />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="surface rounded-2xl p-2">
          {list.map((r) => (
            <button key={r.id} onClick={() => setRoom(r.id)} className={cx("flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm", room === r.id ? "nav-active" : "text-muted hover:bg-panel-2 hover:text-text")}>
              <span className="flex min-w-0 items-center gap-2"><Hash className="size-4 shrink-0" /><span className="truncate">{r.name}</span></span><span className="text-[11px] text-faint">{r.n}</span>
            </button>
          ))}
        </aside>
        <section className="surface flex h-[calc(100vh-260px)] min-h-[420px] flex-col rounded-2xl">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold"><MessagesSquare className="size-4 text-accent-2" /> {list.find((r) => r.id === room)?.name ?? room}</header>
          <div className="flex-1 space-y-2 overflow-y-auto p-4">
            {!(msgs.data?.messages ?? []).length && <p className="py-10 text-center text-sm text-muted">No messages yet. Agents in collaborative, sequential or supervised fleets post their findings, proposals and validations here.</p>}
            {(msgs.data?.messages ?? []).map((m: any) => (
              <div key={m.id} className={cx("flex gap-3", m.msg_type === "instruction" && "flex-row-reverse")}>
                <span className="num w-16 shrink-0 pt-1 text-[11px] text-faint">{clock(m.created_at)}</span>
                <div className={cx("max-w-[80%] rounded-xl border border-line bg-panel-2/60 px-3 py-2", m.msg_type === "instruction" && "border-accent/30 bg-accent-soft")}>
                  <div className="flex items-center gap-2 text-[12px]"><span className="font-semibold">{m.sender_label}</span><span className={cx("rounded-md px-1.5 py-0.5 text-[10px]", TYPE[m.msg_type])}>{m.msg_type}</span>{m.recipients?.length > 0 && <span className="text-faint">→ {m.recipients.join(", ")}</span>}</div>
                  <div className="mt-0.5 text-[13px]">{m.body}</div>
                  {(m.refs ?? []).filter((r: any) => r?.url).map((r: any) => <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-[11px] text-accent-2 hover:underline">Source: {r.source ?? r.url} ↗</a>)}
                  {(m.refs ?? []).filter((r: any) => typeof r === "string").length > 0 && <div className="mt-1 text-[11px] text-muted">Checks: {(m.refs as string[]).filter((r) => typeof r === "string").join(" · ")}</div>}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
          <div className="border-t border-line p-3">
            <div className="flex gap-2"><input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Intervene: send an instruction to this room…" className="h-11 flex-1 rounded-xl border border-line bg-panel-2/60 px-3 text-sm outline-none focus:border-accent/60" /><button onClick={send} className="flex size-11 items-center justify-center rounded-xl bg-grad" aria-label="Send"><Send className="size-4" /></button></div>
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-faint"><ShieldAlert className="size-3" /> News, social posts and agent messages are treated as untrusted data, never as privileged instructions. Message depth and rate are capped to prevent loops.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
