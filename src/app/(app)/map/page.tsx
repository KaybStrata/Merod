"use client";
import "@xyflow/react/dist/style.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, addEdge, applyEdgeChanges, applyNodeChanges, useReactFlow,
  ConnectionMode, MarkerType, type Node, type Edge, type NodeProps, type Connection, type NodeChange, type EdgeChange,
} from "@xyflow/react";
import { History, Bot, Sparkles, MessageSquareText, Wand2, Target, Workflow, Play, Plus, Trash2, Map as MapIcon, Search, X, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { usePageTitle } from "@/components/shell/context";
import { cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";
import { MapHistory } from "@/components/MapHistory";

type NType = "bot" | "agent" | "prompt" | "skill" | "point" | "method";
type NData = { refId?: string; label?: string; text?: string; note?: string; status?: string };
type MNode = Node<NData, NType>;

const META: Record<NType, { label: string; icon: any; ring: string; chip: string }> = {
  bot: { label: "Bot", icon: Bot, ring: "border-sky-400/50", chip: "bg-sky-400/15 text-sky-300" },
  agent: { label: "Agent", icon: Sparkles, ring: "border-violet-400/50", chip: "bg-violet-400/15 text-violet-300" },
  prompt: { label: "Prompt", icon: MessageSquareText, ring: "border-emerald-400/50", chip: "bg-emerald-400/15 text-emerald-300" },
  skill: { label: "Skill", icon: Wand2, ring: "border-amber-300/50", chip: "bg-amber-300/15 text-amber-200" },
  point: { label: "Point", icon: Target, ring: "border-rose-400/50", chip: "bg-rose-400/15 text-rose-300" },
  method: { label: "Method", icon: Workflow, ring: "border-accent/70", chip: "bg-accent/20 text-accent-2" },
};

/** Lets node components edit their own text and run themselves without prop-drilling through React Flow. */
const Ctx = createContext<{ update: (id: string, d: Partial<NData>) => void; run: (id: string) => void; remove: (id: string) => void; running: string | null; info: (n: MNode) => string | undefined }>(null as any);

function MapNodeView({ id, data, type, selected }: NodeProps<MNode>) {
  const c = useContext(Ctx);
  const t = (type ?? "prompt") as NType, m = META[t], Icon = m.icon;
  const editableText = t === "prompt";
  const runnable = t !== "skill" && t !== "point";
  return (
    <div className={cx("w-[230px] rounded-xl border bg-panel/95 p-2.5 text-[12px] shadow-xl backdrop-blur", m.ring, selected && "ring-2 ring-accent/60", t === "method" && "w-[250px] border-2 border-dashed")}>
      <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-bg !bg-accent-2" />
      <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-bg !bg-accent-2" />
      <div className="flex items-center gap-1.5">
        <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", m.chip)}><Icon className="size-3" />{m.label}</span>
        {data.status && <span className="text-[10px] text-faint">{data.status}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          {runnable && <button title={t === "method" ? "Run this method" : t === "prompt" ? "Run this prompt" : `Apply everything attached to this ${t}`} onClick={() => c.run(id)} className="nodrag rounded-md p-1 text-muted hover:bg-panel-2 hover:text-up">{c.running === id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}</button>}
          <button title="Remove from map" onClick={() => c.remove(id)} className="nodrag rounded-md p-1 text-faint hover:bg-panel-2 hover:text-down"><X className="size-3.5" /></button>
        </div>
      </div>
      {t === "method" || t === "prompt"
        ? <input value={data.label ?? ""} onChange={(e) => c.update(id, { label: e.target.value })} placeholder={t === "method" ? "Name this method" : "Prompt name (optional)"} className="nodrag mt-1.5 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold text-text outline-none hover:border-line focus:border-accent/60" />
        : <div className="mt-1.5 truncate px-1 text-[13px] font-semibold">{data.label}</div>}
      {editableText && <textarea value={data.text ?? ""} onChange={(e) => c.update(id, { text: e.target.value })} rows={3} placeholder="e.g. stop loss 5%, take profit 12% · or: turn off · or: only trade SOL meme coins"
        className="nodrag nowheel mt-1 w-full resize-y rounded-md border border-line bg-bg-2 px-2 py-1.5 text-[11.5px] leading-snug outline-none focus:border-accent/60" />}
      {!editableText && c.info({ id, data, type: t } as MNode) && <div className="mt-1 line-clamp-3 px-1 text-[11px] text-muted">{c.info({ id, data, type: t } as MNode)}</div>}
      {t === "method" && <div className="mt-1 px-1 text-[10.5px] text-faint">Attach prompts, skills and points on one side and bots/agents on the other. ▶ applies them all.</div>}
    </div>
  );
}
const nodeTypes = Object.fromEntries((Object.keys(META) as NType[]).map((k) => [k, MapNodeView]));

const uid = () => Math.random().toString(36).slice(2, 10);

function MapEditor() {
  usePageTitle({ section: "Automate · Map", title: "Map your bots, agents and instructions", accent: "Map" });
  const toast = useToast();
  const rf = useReactFlow();
  const [mapId, setMapId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [maps, setMaps] = useState<any[]>([]);
  const [pal, setPal] = useState<any>({ bots: [], agents: [], skills: [], points: [] });
  const [nodes, setNodes] = useState<MNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [tab, setTab] = useState<"bots" | "agents" | "skills" | "points">("bots");
  const [filter, setFilter] = useState("");
  const [saved, setSaved] = useState<"saved" | "saving" | "dirty">("saved");
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ at: string; lines: string[] } | null>(null);
  const [creating, setCreating] = useState<null | "skill" | "point">(null);
  const loaded = useRef(false);
  const lastUpdated = useRef<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdBusy, setCmdBusy] = useState(false);
  const [history, setHistory] = useState(true);
  const [showPal, setShowPal] = useState(true);
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    let framed = false; try { framed = window.self !== window.top; } catch { framed = true; }
    setEmbedded(framed);
    const narrow = window.innerWidth < 1100;
    // Narrow screens (and the floating window) start with the side panels tucked away so the canvas has room.
    if (narrow) { setShowPal(false); setHistory(false); }
    else { try { if (localStorage.getItem("merod-map-history") === "0") setHistory(false); } catch { /* ignore */ } }
  }, []);

  const load = useCallback(async (id?: string | null) => {
    const r = await api(`/api/map${id ? `?id=${id}` : ""}`);
    loaded.current = false;
    setMapId(r.map.id); setName(r.map.name); setMaps(r.maps); setPal(r.palette);
    setNodes((r.map.nodes ?? []).map((n: any) => ({ ...n, type: n.type })));
    setEdges((r.map.edges ?? []).map((e: any) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed } })));
    setResult(r.map.last_run ?? null);
    lastUpdated.current = r.map.updated_at ?? null;
    setSaved("saved");
    setTimeout(() => { loaded.current = true; if (r.map.viewport) rf.setViewport(r.map.viewport); else rf.fitView({ padding: 0.3, maxZoom: 1 }); }, 50);
  }, [rf]);
  useEffect(() => { load().catch((e) => toast(e.message, "down")); }, [load, toast]);
  const savedRef = useRef(saved); savedRef.current = saved;
  useEffect(() => {
    if (!mapId) return;
    const t = setInterval(async () => {
      if (savedRef.current !== "saved" || document.hidden) return;
      try {
        const r = await api(`/api/map?id=${mapId}&meta=1`);
        if (r.updated_at && lastUpdated.current && new Date(r.updated_at).getTime() > new Date(lastUpdated.current).getTime() + 500) load(mapId);
      } catch { /* try again */ }
    }, 4000);
    return () => clearInterval(t);
  }, [mapId, load]);
  async function sendCmd() {
    const text = cmd.trim();
    if (!text || cmdBusy) return;
    setCmdBusy(true);
    try {
      await flush().catch(() => {});
      const r = await api("/api/map/command", { method: "POST", json: { text, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      setResult({ at: new Date().toISOString(), lines: String(r.message).split("\n") });
      setCmd("");
      await load(mapId);
    } catch (e: any) { toast(e.message, "down"); } finally { setCmdBusy(false); }
  }

  // Auto-save shortly after any change.
  useEffect(() => {
    if (!loaded.current || !mapId) return;
    setSaved("dirty");
    const t = setTimeout(async () => {
      setSaved("saving");
      try {
        const sv = await api(`/api/map/${mapId}`, { method: "PATCH", json: {
          name: name || "My map",
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: { refId: n.data.refId, label: n.data.label?.slice(0, 120), text: n.data.text?.slice(0, 4000) } })),
          edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
          viewport: rf.getViewport(),
        } });
        lastUpdated.current = sv?.updated_at ?? lastUpdated.current;
        setSaved("saved");
      } catch (e: any) { setSaved("dirty"); toast(`Couldn't save: ${e.message}`, "down"); }
    }, 900);
    return () => clearTimeout(t);
  }, [nodes, edges, name, mapId, rf, toast]);

  const onNodesChange = useCallback((ch: NodeChange<MNode>[]) => setNodes((ns) => applyNodeChanges(ch, ns)), []);
  const onEdgesChange = useCallback((ch: EdgeChange[]) => setEdges((es) => applyEdgeChanges(ch, es)), []);
  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, id: `e-${uid()}`, markerEnd: { type: MarkerType.ArrowClosed }, animated: true }, es)), []);

  const addNode = useCallback((type: NType, data: NData, at?: { x: number; y: number }) => {
    if (data.refId && nodes.some((n) => n.data.refId === data.refId && n.type === type)) { toast(`${data.label} is already on the map`, "down"); return; }
    // Lay new boxes out in a loose grid around the middle so they don't stack on top of each other.
    const k = nodes.length, col = (k % 4) - 1.5, row = Math.floor(k / 4) % 4 - 1.5;
    const center = at ?? rf.screenToFlowPosition({ x: window.innerWidth / 2 + col * 270, y: window.innerHeight / 2 + row * 170 });
    setNodes((ns) => [...ns, { id: `${type}-${uid()}`, type, position: center, data }]);
  }, [nodes, rf, toast]);

  const update = useCallback((id: string, d: Partial<NData>) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...d } } : n))), []);
  const remove = useCallback((id: string) => { setNodes((ns) => ns.filter((n) => n.id !== id)); setEdges((es) => es.filter((e) => e.source !== id && e.target !== id)); }, []);

  const statusOf = useMemo(() => {
    const m = new Map<string, any>();
    for (const b of pal.bots) m.set(b.id, b); for (const a of pal.agents) m.set(a.id, a);
    for (const s of [...pal.skills, ...pal.points]) m.set(s.id, s);
    return m;
  }, [pal]);
  const info = useCallback((n: MNode) => {
    const r = n.data.refId ? statusOf.get(n.data.refId) : null;
    if (!r) return n.data.refId ? "Deleted: remove it from the map" : undefined;
    if (n.type === "skill" || n.type === "point") return `${r.instructions}${r.active ? " · on everywhere" : " · only where attached"}`;
    return `${r.status}${r.detail ? ` · ${String(r.detail).replace(/_/g, " ")}` : ""}${r.fleet ? ` · ${r.fleet}` : ""}`;
  }, [statusOf]);

  async function flush() {
    if (!mapId) return;
    await api(`/api/map/${mapId}`, { method: "PATCH", json: { nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: { refId: n.data.refId, label: n.data.label?.slice(0, 120), text: n.data.text?.slice(0, 4000) } })), edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })) } });
    setSaved("saved");
  }
  const run = useCallback(async (nodeId?: string) => {
    if (!mapId) return;
    setRunning(nodeId ?? "all");
    try {
      await flush();
      const r = await api(`/api/map/${mapId}/run`, { method: "POST", json: { nodeId, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
      setResult(r); toast(r.ran ? `Applied ${r.ran} change${r.ran === 1 ? "" : "s"}` : "Nothing applied", r.ran ? "up" : "down");
      load(mapId).catch(() => {});
    } catch (e: any) { toast(e.message, "down"); } finally { setRunning(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, nodes, edges]);

  function onDragStart(e: DragEvent, type: NType, data: NData) { e.dataTransfer.setData("application/merod-node", JSON.stringify({ type, data })); e.dataTransfer.effectAllowed = "move"; }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/merod-node"); if (!raw) return;
    const { type, data } = JSON.parse(raw);
    addNode(type, data, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }

  const list: any[] = (pal[tab] ?? []).filter((x: any) => !filter || String(x.name).toLowerCase().includes(filter.toLowerCase()));
  const tabType: Record<string, NType> = { bots: "bot", agents: "agent", skills: "skill", points: "point" };

  return (
    <Ctx.Provider value={{ update, run, remove, running, info }}>
      <div className={cx("flex gap-2 sm:gap-3", embedded ? "h-[calc(100dvh-5.25rem)] min-h-[360px]" : "h-[calc(100dvh-8.5rem)] min-h-[520px]")}>
        {/* Palette */}
        {showPal && <aside className="surface flex w-60 shrink-0 flex-col rounded-2xl p-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => addNode("prompt", { label: "", text: "" })} className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-400/40 px-2 py-1.5 text-[12px] text-emerald-300 hover:bg-emerald-400/10"><Plus className="size-3.5" />Prompt</button>
            <button onClick={() => addNode("method", { label: "New method" })} className="inline-flex items-center justify-center gap-1 rounded-lg border border-accent/50 px-2 py-1.5 text-[12px] text-accent-2 hover:bg-accent/10"><Plus className="size-3.5" />Method</button>
            <button onClick={() => setCreating("skill")} className="inline-flex items-center justify-center gap-1 rounded-lg border border-amber-300/40 px-2 py-1.5 text-[12px] text-amber-200 hover:bg-amber-300/10"><Plus className="size-3.5" />New skill</button>
            <button onClick={() => setCreating("point")} className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-400/40 px-2 py-1.5 text-[12px] text-rose-300 hover:bg-rose-400/10"><Plus className="size-3.5" />New point</button>
          </div>
          <div className="mt-2.5 flex rounded-lg border border-line p-0.5 text-[11.5px]">
            {(["bots", "agents", "skills", "points"] as const).map((k) => <button key={k} onClick={() => setTab(k)} className={cx("flex-1 rounded-md py-1 capitalize", tab === k ? "bg-panel-2 text-text" : "text-muted hover:text-text")}>{k}<span className="ml-0.5 text-faint">{pal[k]?.length ?? 0}</span></button>)}
          </div>
          <label className="mt-2 flex items-center gap-1.5 rounded-lg border border-line bg-bg-2 px-2 py-1"><Search className="size-3.5 text-faint" /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Find ${tab}`} className="w-full bg-transparent text-[12px] outline-none" /></label>
          <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
            {!list.length && <p className="px-1 py-3 text-[11.5px] text-faint">{tab === "skills" || tab === "points" ? `No ${tab} yet. Use “New ${tab.slice(0, -1)}” above.` : `No ${tab} yet. Create one with a prompt (e.g. “create a bot that buys SOL dips”), then drop it here.`}</p>}
            {list.map((x) => {
              const type = tabType[tab], M = META[type], on = nodes.some((n) => n.data.refId === x.id);
              return (
                <div key={x.id} draggable onDragStart={(e) => onDragStart(e, type, { refId: x.id, label: x.name })} onClick={() => addNode(type, { refId: x.id, label: x.name })}
                  className={cx("cursor-grab rounded-lg border px-2 py-1.5 text-[12px] hover:bg-panel-2 active:cursor-grabbing", on ? "border-accent/40 opacity-60" : "border-line")} title="Click or drag onto the map">
                  <div className="flex items-center gap-1.5"><M.icon className="size-3.5 shrink-0 text-muted" /><span className="truncate font-medium">{x.name}</span>{on && <span className="ml-auto text-[10px] text-accent-2">on map</span>}</div>
                  <div className="truncate pl-5 text-[10.5px] text-faint">{type === "skill" || type === "point" ? x.instructions : `${x.status}${x.fleet ? ` · ${x.fleet}` : ""}`}</div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 border-t border-line pt-2 text-[10.5px] leading-snug text-faint">Drag from a dot to another box to attach. Prompts, skills and points attached to a bot or agent become its instructions. Put several into a <b>Method</b> to reuse the mix. Select + Backspace removes.</p>
        </aside>}

        {/* Canvas */}
        <div className="surface relative min-w-0 flex-1 overflow-hidden rounded-2xl">
          <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
            <MapIcon className="size-4 text-accent-2" />
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-44 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[14px] font-semibold outline-none hover:border-line focus:border-accent/60" />
            <select value={mapId ?? ""} onChange={(e) => load(e.target.value)} className="rounded-lg border border-line bg-bg-2 px-2 py-1 text-[12px]">
              {maps.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.node_count})</option>)}
            </select>
            <button onClick={async () => { const n = prompt("Name the new map", "New map"); if (!n) return; const r = await api("/api/map", { method: "POST", json: { name: n } }); load(r.map.id); }} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] text-muted hover:text-text"><Plus className="size-3.5" />New map</button>
            {maps.length > 1 && <button onClick={async () => { if (!mapId || !confirm(`Delete map “${name}”? Bots, agents, skills and points themselves are not deleted.`)) return; await api(`/api/map/${mapId}`, { method: "DELETE" }); load(); }} className="rounded-lg border border-line p-1.5 text-faint hover:text-down" title="Delete this map"><Trash2 className="size-3.5" /></button>}
            <span className="text-[11px] text-faint">{saved === "saved" ? "Saved" : saved === "saving" ? "Saving…" : "Unsaved changes"}</span>
            <button onClick={() => setShowPal((v) => !v)} className={cx("inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[12px]", showPal ? "border-accent/50 text-accent-2" : "border-line text-muted hover:text-text")} title="Show or hide the list of bots, agents, skills and points"><Plus className="size-3.5" />{showPal ? "Hide items" : "Add items"}</button>
            {!history && <button onClick={() => { setHistory(true); try { localStorage.setItem("merod-map-history", "1"); } catch { /* ignore */ } }} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[12px] text-muted hover:text-text"><History className="size-3.5" />History & advice</button>}
            <button onClick={() => run()} disabled={!!running} className={cx("inline-flex items-center gap-1.5 rounded-lg bg-grad px-3 py-1.5 text-[12.5px] font-semibold text-bg disabled:opacity-60", history && "ml-auto")}>{running === "all" ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}Run map</button>
          </div>

          <ReactFlow<MNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            connectionMode={ConnectionMode.Loose} colorMode="dark" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
            onMoveEnd={() => loaded.current && setSaved((s) => s)} deleteKeyCode={["Backspace", "Delete"]} fitView fitViewOptions={{ padding: 0.3, maxZoom: 1 }} minZoom={0.2} maxZoom={2} proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ style: { strokeWidth: 2 } }} className="!bg-transparent">
            <Background gap={22} size={1.2} />
            <Controls position="bottom-left" className="!bottom-[7.5rem]" />
            <MiniMap position="bottom-right" pannable zoomable nodeColor={(n) => ({ bot: "#38bdf8", agent: "#a78bfa", prompt: "#34d399", skill: "#fcd34d", point: "#fb7185", method: "#d6b37a" } as any)[n.type ?? "prompt"]} className="!bg-panel max-xl:!hidden" />
          </ReactFlow>
          {!nodes.length && (
            <div className="pointer-events-none absolute inset-x-0 bottom-32 top-12 flex items-center justify-center p-6">
              <div className="max-w-md rounded-2xl border border-dashed border-line bg-panel/80 p-5 text-center text-[13px] text-muted">
                <MapIcon className="mx-auto mb-2 size-6 text-accent-2" />
                <div className="font-semibold text-text">Build your first method</div>
                Drop a bot or agent on the map, add a Prompt (“stop loss 5%, take profit 10%”) or a Skill, and drag a line between them. Press ▶ to apply. Group several instructions into a Method to reuse the same mix on many bots.
              </div>
            </div>
          )}
          {/* Prompt box: build and edit the map by typing (works in the floating window too). */}
          <div className="absolute inset-x-2 bottom-2 z-20 sm:inset-x-3 sm:bottom-3">
            <div className="mb-1.5 flex gap-1 overflow-x-auto pb-0.5">
              {["Method “Safe” with stop loss 5%, take profit 10% for all bots", "Add all my agents", "Change Safe to take profit 12%", "Rename Safe to Careful", "Run Safe", "Show my map"].map((ex) => (
                <button key={ex} onClick={() => setCmd(ex)} className="shrink-0 rounded-full border border-line bg-panel/90 px-2.5 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-text">{ex}</button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void sendCmd(); }} className="flex items-end gap-2 rounded-2xl border border-line-2 bg-panel/95 p-2 shadow-2xl backdrop-blur focus-within:border-accent/60">
              <Sparkles className="mb-2 ml-1 size-4 shrink-0 text-accent-2" />
              <textarea value={cmd} onChange={(e) => setCmd(e.target.value)} disabled={cmdBusy} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendCmd(); } }}
                placeholder="Tell the map what to build or change: “create a method called Safe with stop loss 5%, take profit 10% for all bots and run it”, “connect Safe to ETH Accumulation”, “remove SOL Momentum”…"
                className="nowheel min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-snug outline-none placeholder:text-faint" />
              <button type="submit" disabled={cmdBusy || !cmd.trim()} className="shrink-0 rounded-xl bg-grad px-3.5 py-2 text-[12.5px] font-semibold text-bg disabled:opacity-40">{cmdBusy ? <Loader2 className="size-4 animate-spin" /> : "Build"}</button>
            </form>
          </div>
          {result && (
            <div className="absolute bottom-[7.5rem] left-14 z-10 max-h-[40%] w-[min(520px,calc(100%-14rem))] overflow-y-auto rounded-xl border border-line bg-panel/95 p-3 text-[12px] shadow-2xl backdrop-blur">
              <div className="mb-1 flex items-center text-[12px] font-semibold">Last run <span className="ml-1 font-normal text-faint">· {ago(result.at)}</span><button onClick={() => setResult(null)} className="ml-auto text-faint hover:text-text"><X className="size-3.5" /></button></div>
              <pre className="whitespace-pre-wrap font-sans leading-relaxed text-muted">{result.lines.join("\n")}</pre>
            </div>
          )}
        </div>
        {history && <MapHistory onClose={() => { setHistory(false); try { localStorage.setItem("merod-map-history", "0"); } catch { /* ignore */ } }} />}
      </div>
      {creating && <NewInstruction kind={creating} onClose={() => setCreating(null)} onCreated={(row) => { setPal((p: any) => ({ ...p, [creating === "skill" ? "skills" : "points"]: [row, ...p[creating === "skill" ? "skills" : "points"]] })); addNode(creating, { refId: row.id, label: row.name }); setCreating(null); }} />}
    </Ctx.Provider>
  );
}

function NewInstruction({ kind, onClose, onCreated }: { kind: "skill" | "point"; onClose: () => void; onCreated: (row: any) => void }) {
  const toast = useToast();
  const [name, setName] = useState(""), [text, setText] = useState(""), [everywhere, setEverywhere] = useState(false), [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { const r = await api("/api/map/instruction", { method: "POST", json: { kind, name, text, everywhere, tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }); onCreated(r.item); }
    catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="surface w-full max-w-md rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-[14px] font-semibold">New {kind}</div>
        <p className="mt-1 text-[12px] text-muted">{kind === "skill" ? "A standing way of trading, e.g. “always use a 5% stop-loss and take profit at 12%, $25 per trade”." : "A specific instruction for now, e.g. “only buy on a 3% dip today” or “no new buys until Friday”."}</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" className="mt-3 w-full rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/60" />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={kind === "skill" ? "Always use a 5% stop-loss…" : "Buy on a 2% dip today…"} className="mt-2 w-full rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/60" />
        <label className="mt-2 flex items-start gap-2 text-[12px] text-muted"><input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} className="mt-0.5" />Also switch it on everywhere (all bots, agents and Merod). Leave off to only affect what you attach it to on the map.</label>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted">Cancel</button>
          <button onClick={save} disabled={busy || text.trim().length < 3} className="rounded-lg bg-grad px-3 py-1.5 text-[12.5px] font-semibold text-bg disabled:opacity-50">{busy ? "Saving…" : `Add ${kind} to map`}</button>
        </div>
      </div>
    </div>
  );
}

export default function MapPage() {
  return <ReactFlowProvider><MapEditor /></ReactFlowProvider>;
}
