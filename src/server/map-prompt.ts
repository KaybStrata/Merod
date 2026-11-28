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
const VERB = /\b(create|make|build|add|put|connect|attach|link|wire|set ?up|design|new|map)\b/i;

export function isMapCommand(text: string) {
  const t = text.toLowerCase();
  if (!MAPPY.test(t)) return false;
  if (/^(what|how|why|show|open|view|list)\b/.test(t) && !/\b(create|make|build|add|connect)\b/.test(t)) return /\b(show|open|view|list)\b.*\bmap\b/.test(t);
  return VERB.test(t);
}

export async function mapCommand(userId: string, text: string, opts: { isOwner: boolean; tz?: string }): Promise<string | null> {
  if (!isMapCommand(text)) return null;
  const t = text.trim();
  const m = await getMap(userId);
  const nodes: MapNode[] = m.nodes ?? [], edges: MapEdge[] = m.edges ?? [];

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
