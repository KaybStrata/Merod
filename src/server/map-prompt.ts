import "@/lib/server-only-shim";
import { q } from "./db";
import { getMap, saveMap, runMap, type MapNode, type MapEdge } from "./map";
import { parseTargets, parseEdits, fmtEdit } from "./ai/bulk-edit";

/**
 * Build Map setups from the prompt box:
 *   "create a map method called Safe with stop loss 5%, take profit 10% for all bots"
 *   "on the map, connect SOL Momentum and BTC Dipper to a method: $25 per trade, buy on a 3% dip, and run it"
 *   "add all my agents to the map" · "map my skill Careful to ETH Accumulation" · "show my map"
 * Creates the boxes (method, prompt with the instructions, any named skills/points, the bots/agents), wires them,
 * saves the map, and runs it when asked ("and run it", "apply it").
 */
const MAPPY = /\b(map|method)\b/i;
const VERB = /\b(create|make|build|add|put|connect|attach|link|wire|set ?up|design|new|map|remove|delete|rename|change|update|edit|run|apply|clear|reset|wipe|disconnect|unlink|detach)\b/i;

export function isMapCommand(text: string) {
  const t = text.toLowerCase();
  if (!MAPPY.test(t)) return false;
  if (/^(what|how|why|show|open|view|list)\b/.test(t) && !/\b(create|make|build|add|connect)\b/.test(t)) return /\b(show|open|view|list)\b.*\bmap\b/.test(t);
  return VERB.test(t);
}

/** force: the text came from the Map's own prompt bar, so it's about the map even without the word "map". */
export async function mapCommand(userId: string, text: string, opts: { isOwner: boolean; tz?: string; force?: boolean }): Promise<string | null> {
  if (!opts.force && !isMapCommand(text)) return null;
  const t = text.trim().replace(/^(on|in) (the |my )?map[:,]?\s*/i, "");
  const m = await getMap(userId);
  let nodes: MapNode[] = m.nodes ?? [], edges: MapEdge[] = m.edges ?? [];

  /* ── Editing what's already on the map ── */
  const clean = (x: string) => x.replace(/["“”']/g, "").replace(/\b(the|my|method|box|prompt|bot|agent|skill|point)\b/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const find = (name: string) => {
    const n = clean(name);
    if (!n) return [] as MapNode[];
    const exact = nodes.filter((x) => (x.data.label ?? "").toLowerCase() === n);
    return exact.length ? exact : nodes.filter((x) => (x.data.label ?? "").toLowerCase().includes(n) || (n.length > 3 && n.includes((x.data.label ?? "").toLowerCase()) && (x.data.label ?? "").length > 3));
  };
  const linkedTo = (id: string) => edges.filter((e) => e.source === id || e.target === id).map((e) => (e.source === id ? e.target : e.source));
  const save = async (msg: string) => { await saveMap(userId, m.id, { nodes, edges }); return `${msg} Open the Map to see it.`; };

  if (/\b(clear|empty|reset|wipe)\b/i.test(t) && /\b(map|everything|all)\b/i.test(t) && !/\b(stop|loss|profit)\b/i.test(t)) {
    const n = nodes.length; nodes = []; edges = [];
    return save(`Cleared your map “${m.name}” (${n} boxes removed). Your bots, agents, skills and points themselves are untouched.`);
  }
  let mm = t.match(/^\s*rename\s+(.+?)\s+(?:to|as)\s+["“']?(.+?)["”']?\s*$/i);
  if (mm) {
    const hit = find(mm[1]);
    if (!hit.length) return `There's nothing called “${mm[1]}” on your map. Boxes: ${nodes.map((x) => x.data.label).filter(Boolean).slice(0, 12).join(", ") || "none"}.`;
    for (const x of hit) if (x.type === "method" || x.type === "prompt") x.data.label = mm[2].slice(0, 120);
    return save(`Renamed “${mm[1]}” to “${mm[2]}”.`);
  }
  mm = t.match(/^\s*(?:remove|delete|take)\s+(.+?)(?:\s+(?:from|off)\s+(?:the\s+|my\s+)?map)?\s*$/i);
  if (mm && !/\b(stop.?loss|take.?profit)\b/i.test(mm[1])) {
    const hit = /^(everything|all)$/i.test(clean(mm[1])) ? [...nodes] : find(mm[1]);
    if (!hit.length) return `There's nothing called “${mm[1]}” on your map.`;
    const ids = new Set(hit.map((x) => x.id));
    nodes = nodes.filter((x) => !ids.has(x.id)); edges = edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
    return save(`Removed ${hit.map((x) => `“${x.data.label ?? x.type}”`).join(", ")} from the map (only the boxes; the bots/agents/skills themselves stay).`);
  }
  mm = t.match(/^\s*(?:disconnect|unlink|detach)\s+(.+?)\s+from\s+(.+?)\s*$/i);
  if (mm) {
    const a = find(mm[1]), b = find(mm[2]);
    if (!a.length || !b.length) return `I couldn't find ${!a.length ? `“${mm[1]}”` : `“${mm[2]}”`} on your map.`;
    const A = new Set(a.map((x) => x.id)), B = new Set(b.map((x) => x.id));
    const before = edges.length;
    edges = edges.filter((e) => !((A.has(e.source) && B.has(e.target)) || (B.has(e.source) && A.has(e.target))));
    return save(before === edges.length ? `“${mm[1]}” and “${mm[2]}” weren't connected.` : `Disconnected “${mm[1]}” from “${mm[2]}”.`);
  }
  mm = t.match(/^\s*(?:change|update|edit|set)\s+(.+?)\s+(?:to|with|so it|:)\s*([\s\S]+)$/i);
  if (mm) {
    const hit = find(mm[1]).filter((x) => x.type === "method" || x.type === "prompt");
    if (hit.length) {
      const target = hit[0], instr = mm[2].replace(/,?\s*\b(and )?(then )?(run|apply) (it|them|now)\b.*$/i, "").trim();
      let promptNode = target.type === "prompt" ? target : nodes.find((x) => x.type === "prompt" && linkedTo(target.id).includes(x.id));
      if (promptNode) promptNode.data.text = instr;
      else {
        promptNode = { id: `prompt-${Math.random().toString(36).slice(2, 10)}`, type: "prompt", position: { x: target.position.x - 300, y: target.position.y }, data: { label: target.data.label, text: instr } };
        nodes.push(promptNode); edges.push({ id: `e-${Math.random().toString(36).slice(2, 10)}`, source: promptNode.id, target: target.id });
      }
      let msg = `“${target.data.label}” now says: “${instr}”.`;
      if (/\b(run|apply)\b/i.test(mm[2])) { await saveMap(userId, m.id, { nodes, edges }); const r = await runMap(userId, m.id, { nodeId: target.id, isOwner: opts.isOwner, tz: opts.tz }); return `${msg}\nRan it:\n${r.lines.join("\n")}`; }
      return save(`${msg} Say “run ${target.data.label}” to apply it.`);
    }
  }
  mm = t.match(/^\s*(?:run|apply|execute)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:on|from)\s+the\s+map)?\s*$/i);
  if (mm) {
    if (/^(map|it|everything|all)$/i.test(clean(mm[1]) || "map")) { const r = await runMap(userId, m.id, { isOwner: opts.isOwner, tz: opts.tz }); return `Ran your whole map:\n${r.lines.join("\n")}`; }
    const hit = find(mm[1]);
    if (hit.length) { const r = await runMap(userId, m.id, { nodeId: hit[0].id, isOwner: opts.isOwner, tz: opts.tz }); return `Ran “${hit[0].data.label}”:\n${r.lines.join("\n")}`; }
  }
  // Connect something already on the map to bots/agents: "connect Safe to ETH Accumulation and BTC Dipper".
  mm = t.match(/^\s*(?:connect|attach|link|wire)\s+(.+?)\s+(?:to|with)\s+(.+?)\s*$/i);
  if (mm) {
    const src = find(mm[1]).filter((x) => x.type !== "bot" && x.type !== "agent");
    if (src.length) {
      const tg = (await parseTargets(userId, mm[2])) ?? [];
      if (tg.length) {
        const maxY = nodes.reduce((a, n) => Math.max(a, n.position.y), 0);
        let i = 0;
        for (const x of tg) {
          let n = nodes.find((y) => y.type === x.kind && y.data.refId === x.id);
          if (!n) { n = { id: `${x.kind}-${Math.random().toString(36).slice(2, 10)}`, type: x.kind, position: { x: src[0].position.x + 340, y: maxY + 150 * ++i }, data: { refId: x.id, label: x.name } }; nodes.push(n); }
          if (!edges.some((e) => (e.source === src[0].id && e.target === n!.id) || (e.target === src[0].id && e.source === n!.id))) edges.push({ id: `e-${Math.random().toString(36).slice(2, 10)}`, source: src[0].id, target: n.id });
        }
        return save(`Connected “${src[0].data.label}” to ${tg.map((x) => x.name).join(", ")}.`);
      }
    }
  }

  if (/^(show|open|view|list)\b/i.test(t)) {
    const count = (k: string) => nodes.filter((n) => n.type === k).length;
    return `Your map “${m.name}”: ${nodes.length} boxes (${count("bot")} bots, ${count("agent")} agents, ${count("method")} methods, ${count("prompt")} prompts, ${count("skill") + count("point")} skills/points) and ${edges.length} connections. Open it with the Map button.`;
  }

  const uid = () => Math.random().toString(36).slice(2, 10);
  const targets = (await parseTargets(userId, t.replace(/\b(map|method)\b/gi, " "))) ?? [];
  // Skills / points named in the prompt ("skill Careful", "point no-buys").
  const sk = await q<any>("SELECT id, name, kind FROM skills WHERE user_id=$1", [userId]);
  const named = sk.filter((s) => s.name.length > 2 && new RegExp(`\\b${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
  // Instructions: what comes after "with", ":", "that", "to" (minus the targets and the run request).
  let instr = (t.match(/(?:\bwith\b|:|\bthat\b|\bwhich\b|\bto use\b)\s*([\s\S]+)$/i)?.[1] ?? "").replace(/\b(?:for|on|to)\s+(?:all|every|each|my)\b[\s\S]*$/i, "").replace(/,?\s*\b(and )?(then )?(run|apply|execute|activate) (it|them|this|now)\b.*$/i, "").trim();
  for (const x of targets) instr = instr.replace(new RegExp(x.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").trim();
  instr = instr.replace(/^(and|,)\s*/i, "").replace(/\s*(,|and)\s*$/i, "").trim();
  const edit = instr ? parseEdits(instr) : null;
  const name = t.match(/\b(?:called|named|titled)\s+["“']?(.{1,40}?)["”']?(?=\s+(?:with|for|that|which|to|on|and)\b|[,.:]|$)/i)?.[1]?.trim()
    ?? (edit ? fmtEdit(edit).slice(0, 40) : targets.length ? `${targets.length} ${targets.length === 1 ? targets[0].name : "items"}` : "New method");
  if (!targets.length && !instr && !named.length) {
    return "Tell me what to put on the map, e.g. “create a map method called Safe with stop loss 5%, take profit 10% for all bots” or “add all my agents to the map”.";
  }

  // Lay out new boxes to the right of what's already there.
  const maxX = nodes.reduce((a, n) => Math.max(a, n.position.x), -320);
  const baseX = maxX + 360, baseY = 0;
  const add = (n: MapNode) => { nodes.push(n); return n; };
  const link = (a: string, b: string) => { if (!edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a))) edges.push({ id: `e-${uid()}`, source: a, target: b }); };
  const findRef = (type: string, refId: string) => nodes.find((n) => n.type === type && n.data.refId === refId);

  const hasInstr = !!instr || named.length > 0;
  const method = hasInstr && (targets.length > 1 || /\bmethod\b/i.test(t)) ? add({ id: `method-${uid()}`, type: "method", position: { x: baseX + 300, y: baseY }, data: { label: name } }) : null;
  let row = 0;
  const instrNodes: MapNode[] = [];
  if (instr) instrNodes.push(add({ id: `prompt-${uid()}`, type: "prompt", position: { x: baseX, y: baseY + row++ * 190 }, data: { label: name, text: instr } }));
  for (const s of named) instrNodes.push(findRef(s.kind, s.id) ?? add({ id: `${s.kind}-${uid()}`, type: s.kind, position: { x: baseX, y: baseY + row++ * 190 }, data: { refId: s.id, label: s.name } }));
  const targetNodes = targets.map((x, i) => findRef(x.kind, x.id) ?? add({ id: `${x.kind}-${uid()}`, type: x.kind, position: { x: baseX + (method ? 640 : 340), y: baseY + i * 150 }, data: { refId: x.id, label: x.name } }));
  for (const i of instrNodes) { if (method) link(i.id, method.id); else for (const tn of targetNodes) link(i.id, tn.id); }
  if (method) for (const tn of targetNodes) link(method.id, tn.id);
  await saveMap(userId, m.id, { nodes, edges });

  const parts = [`Added to your map “${m.name}”: ${[method ? `method “${name}”` : null, instr ? `prompt “${instr.slice(0, 80)}”` : null, named.length ? named.map((s) => `${s.kind} “${s.name}”`).join(", ") : null, targets.length ? `${targets.length} bot${targets.length === 1 ? "" : "s"}/agent${targets.length === 1 ? "" : "s"} (${targets.slice(0, 6).map((x) => x.name).join(", ")}${targets.length > 6 ? "…" : ""})` : null].filter(Boolean).join(", ")}, all connected.`];
  if (/\b(run|apply|execute|activate)\b/i.test(t) && hasInstr && targets.length) {
    const r = await runMap(userId, m.id, { nodeId: method?.id ?? targetNodes[0].id, isOwner: opts.isOwner, tz: opts.tz });
    parts.push(`Ran it:\n${r.lines.join("\n")}`);
  } else if (hasInstr && targets.length) parts.push("Press ▶ on it in the Map (or say “run it”) to apply.");
  parts.push("Open it with the Map button to see or change it.");
  return parts.join("\n");
}
