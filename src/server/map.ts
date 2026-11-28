import "@/lib/server-only-shim";
import { one, q } from "./db";
import { HttpError } from "./errors";
import { extractRules, parseExpiry } from "./skills";
import { parseEdits, applyEdits, fmtEdit } from "./ai/bulk-edit";

/**
 * Map: the user's canvas of bots, agents, prompts, skills, points and methods.
 *
 * Wiring rules (edges can be drawn in either direction):
 *  - A prompt / skill / point attached to a bot or agent is an instruction FOR that bot or agent.
 *  - A method groups instructions: everything attached to the method flows to every bot/agent attached to it.
 *  - Instructions can be chained (prompt → skill → bot): the whole chain reaches the bot.
 *  - A prompt (or method) attached to nothing runs on its own, exactly as if typed into the prompt box (e.g. "create a bot…").
 * Running applies instructions the same way the prompt box does: stop-loss / take-profit / amount / dip settings are
 * written to the bot or agent; "turn off"/"turn on" pauses or resumes it; anything else is sent to Merod addressed to it.
 */
export type NodeType = "bot" | "agent" | "prompt" | "skill" | "point" | "method" | "auton" | "auto";
export type MapNode = { id: string; type: NodeType; position: { x: number; y: number }; data: { refId?: string; label?: string; text?: string; color?: string; note?: string } };
export type MapEdge = { id: string; source: string; target: string; label?: string };

// "auto" = an auto switch box (data.text = trainer | gainer | adjuster | scanner). It chains like an instruction:
// attached to bots/agents (directly or through skills/methods) it switches on for just those; on its own it's for everything.
const INSTR = new Set<NodeType>(["prompt", "skill", "point", "method", "auto"]);
const TARGET = new Set<NodeType>(["bot", "agent"]);

export async function listMaps(userId: string) {
  return q<any>("SELECT id, name, updated_at, jsonb_array_length(nodes) AS node_count FROM strategy_maps WHERE user_id=$1 ORDER BY updated_at DESC", [userId]);
}
export async function getMap(userId: string, id?: string | null) {
  let m = id ? await one<any>("SELECT * FROM strategy_maps WHERE id=$1 AND user_id=$2", [id, userId]) : await one<any>("SELECT * FROM strategy_maps WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1", [userId]);
  if (!m && id) throw new HttpError(404, "Map not found");
  if (!m) m = await one<any>("INSERT INTO strategy_maps (user_id, name) VALUES ($1,'My map') RETURNING *", [userId]);
  return m;
}
export async function createMap(userId: string, name: string) {
  const n = await one<{ n: number }>("SELECT count(*)::int AS n FROM strategy_maps WHERE user_id=$1", [userId]);
  if ((n?.n ?? 0) >= 50) throw new HttpError(400, "You can have up to 50 maps.");
  return one<any>("INSERT INTO strategy_maps (user_id, name) VALUES ($1,$2) RETURNING *", [userId, name.slice(0, 80) || "New map"]);
}
export async function saveMap(userId: string, id: string, b: { name?: string; nodes?: MapNode[]; edges?: MapEdge[]; viewport?: unknown }) {
  if (b.nodes && b.nodes.length > 500) throw new HttpError(400, "A map can hold up to 500 items.");
  if (b.edges && b.edges.length > 2000) throw new HttpError(400, "A map can hold up to 2000 connections.");
  const r = await one<any>(
    `UPDATE strategy_maps SET name=COALESCE($3,name), nodes=COALESCE($4,nodes), edges=COALESCE($5,edges), viewport=COALESCE($6,viewport), updated_at=now()
      WHERE id=$1 AND user_id=$2 RETURNING id, updated_at`,
    [id, userId, b.name ?? null, b.nodes ? JSON.stringify(b.nodes) : null, b.edges ? JSON.stringify(b.edges) : null, b.viewport ? JSON.stringify(b.viewport) : null]);
  if (!r) throw new HttpError(404, "Map not found");
  return r;
}
export async function deleteMap(userId: string, id: string) {
  await q("DELETE FROM strategy_maps WHERE id=$1 AND user_id=$2", [id, userId]);
}

/** Everything the user can drop onto the map. */
export async function palette(userId: string) {
  const [bots, agents, skills] = await Promise.all([
    q<any>("SELECT id, name, status, strategy_id AS detail FROM trading_bots WHERE user_id=$1 AND status NOT IN ('archived') ORDER BY created_at DESC LIMIT 300", [userId]),
    q<any>("SELECT a.id, a.name, a.status, a.role AS detail, f.name AS fleet FROM agents a LEFT JOIN agent_fleets f ON f.id=a.fleet_id WHERE a.user_id=$1 AND a.status NOT IN ('archived') ORDER BY a.created_at DESC LIMIT 300", [userId]).catch(() =>
      q<any>("SELECT id, name, status, role AS detail FROM agents WHERE user_id=$1 AND status NOT IN ('archived') ORDER BY created_at DESC LIMIT 300", [userId])),
    q<any>("SELECT id, name, instructions, kind, active, expires_at FROM skills WHERE user_id=$1 ORDER BY created_at DESC LIMIT 300", [userId]),
  ]);
  return { bots, agents, skills: skills.filter((s: any) => s.kind !== "point"), points: skills.filter((s: any) => s.kind === "point") };
}

/** A skill or point made on the map: by default it only affects what it's attached to (not switched on everywhere). */
export async function createMapInstruction(userId: string, kind: "skill" | "point", name: string, text: string, everywhere: boolean, tz = "UTC") {
  const t = text.trim().slice(0, 2000);
  if (t.length < 3) throw new HttpError(400, "Write the instruction first.");
  if (everywhere) {
    const { createSkill } = await import("./skills");
    return (await createSkill(userId, name, t, kind, tz)).skill;
  }
  return one<any>("INSERT INTO skills (user_id, name, instructions, rules, kind, expires_at, active) VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING *",
    [userId, (name || t.split(/[.,;\n]/)[0]).trim().slice(0, 60), t, JSON.stringify(extractRules(t)), kind, kind === "point" ? parseExpiry(t, tz) : null]);
}

type Instr = { node: MapNode; text: string; name: string; edits: ReturnType<typeof parseEdits> };

/** Run the whole map, or only what a given method / bot / agent / prompt node touches. */
export async function runMap(userId: string, mapId: string, opts: { nodeId?: string; isOwner: boolean; tz?: string }) {
  const m = await getMap(userId, mapId);
  const nodes: MapNode[] = m.nodes ?? [], edges: MapEdge[] = m.edges ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    (adj.get(e.source) ?? adj.set(e.source, new Set()).get(e.source)!).add(e.target);
    (adj.get(e.target) ?? adj.set(e.target, new Set()).get(e.target)!).add(e.source);
  }
  /** All instruction/method nodes connected to `start` without passing through another bot or agent. */
  const reach = (start: string) => {
    const seen = new Set<string>([start]), out: MapNode[] = [], queue = [start];
    while (queue.length) {
      for (const nb of adj.get(queue.shift()!) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const n = byId.get(nb)!;
        if (INSTR.has(n.type)) { out.push(n); queue.push(nb); }
      }
    }
    return out;
  };
  const targetsOf = (start: string) => {
    const seen = new Set<string>([start]), out: MapNode[] = [], queue = [start];
    while (queue.length) {
      for (const nb of adj.get(queue.shift()!) ?? []) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const n = byId.get(nb)!;
        if (TARGET.has(n.type)) out.push(n); else if (INSTR.has(n.type)) queue.push(nb);
      }
    }
    return out;
  };

  // Which bots/agents and which free-standing prompts this run covers.
  let targets = nodes.filter((n) => TARGET.has(n.type) && (adj.get(n.id)?.size ?? 0) > 0);
  let loose = nodes.filter((n) => n.type === "prompt" && targetsOf(n.id).length === 0 && n.data.text?.trim());
  if (opts.nodeId) {
    const start = byId.get(opts.nodeId);
    if (!start) throw new HttpError(404, "That item isn't on the map any more");
    if (TARGET.has(start.type)) { targets = [start]; loose = []; }
    else {
      targets = targetsOf(start.id);
      const group = new Set([start.id, ...reach(start.id).map((n) => n.id)]);
      loose = targets.length ? [] : nodes.filter((n) => n.type === "prompt" && group.has(n.id) && n.data.text?.trim());
    }
  }
  // Auto switch boxes: on for the bots/agents they reach, or for everything when attached to none.
  const autoLines: string[] = [];
  const { setMode, MODE_INFO } = await import("./auto-modes");
  const autoSettings = async (an: MapNode) => {
    const txt: string[] = [];
    for (const i of reach(an.id)) {
      if (i.type === "prompt" && i.data.text) txt.push(i.data.text);
      if ((i.type === "skill" || i.type === "point") && i.data.refId) { const sk = await one<any>("SELECT instructions FROM skills WHERE id=$1 AND user_id=$2", [i.data.refId, userId]); if (sk) txt.push(sk.instructions); }
    }
    const all = txt.join(" ").toLowerCase(), s: Record<string, number> = {};
    const pct = all.match(/(\d+(?:\.\d+)?)\s*%/); if (pct) s.share = Math.min(1, Math.max(0.01, Number(pct[1]) / 100));
    const cap = all.match(/(?:cap|max(?:imum)?|up to)\s*\$?\s*(\d[\d,]*)/); if (cap) s.max_usd = Number(cap[1].replace(/,/g, ""));
    return Object.keys(s).length ? s : undefined;
  };
  const autoNodes = nodes.filter((n) => n.type === "auto" && ["trainer", "gainer", "adjuster", "scanner"].includes(n.data.text ?? "")
    && (!opts.nodeId || n.id === opts.nodeId || reach(n.id).some((x) => x.id === opts.nodeId) || targetsOf(n.id).some((x) => x.id === opts.nodeId)));
  for (const an of autoNodes) {
    const mode = an.data.text as "trainer" | "gainer" | "adjuster" | "scanner";
    const tg = targetsOf(an.id).filter((x) => x.data.refId);
    const st = mode === "gainer" ? await autoSettings(an) : undefined;
    if (tg.length) { for (const x of tg) await setMode(userId, mode, true, x.type as "bot" | "agent", x.data.refId!, st); autoLines.push(`${MODE_INFO[mode].name}: on for ${tg.map((x) => x.data.label ?? x.type).join(", ")}.`); }
    else { await setMode(userId, mode, true, "all", "", st); autoLines.push(`${MODE_INFO[mode].name}: on for all bots and agents.`); }
  }
  if (opts.nodeId && autoNodes.some((a) => a.id === opts.nodeId)) { const res = { at: new Date().toISOString(), lines: autoLines, ran: autoNodes.length }; await q("UPDATE strategy_maps SET last_run=$3 WHERE id=$1 AND user_id=$2", [mapId, userId, JSON.stringify(res)]); return res; }
  // Auton boxes: instructions attached to Auton become its goals; bots/agents attached to it are handed to Auton to manage.
  const autons = nodes.filter((n) => n.type === "auton" && (!opts.nodeId || n.id === opts.nodeId || reach(n.id).some((x) => x.id === opts.nodeId)));
  const autonLines: string[] = [];
  for (const an of autons) {
    const texts: string[] = [];
    for (const i of reach(an.id)) {
      if (i.type === "prompt" && i.data.text?.trim()) texts.push(i.data.text.trim());
      if ((i.type === "skill" || i.type === "point") && i.data.refId) { const sk = await one<any>("SELECT instructions FROM skills WHERE id=$1 AND user_id=$2", [i.data.refId, userId]); if (sk) texts.push(sk.instructions); }
    }
    const managed = [...(adj.get(an.id) ?? [])].map((id) => byId.get(id)!).filter((n) => n && n.type === "bot" && n.data.refId).map((n) => n.data.refId!);
    for (const id of managed) await q("INSERT INTO auton_assets (user_id, kind, ref_id, label) VALUES ($1,'managed_bot',$2,'from map') ON CONFLICT DO NOTHING", [userId, id]).catch(() => {});
    const { runAuton } = await import("./auton/engine");
    const r = await runAuton(userId, { instructions: texts, managedBotIds: managed });
    autonLines.push(`Auton${texts.length ? ` (with ${texts.length} instruction${texts.length === 1 ? "" : "s"} from the map)` : ""}:`, ...r.actions.map((l) => `  ${l}`));
    if (!r.actions.length) autonLines.push("  nothing needed changing");
  }
  if (autons.length && opts.nodeId && autons.some((a) => a.id === opts.nodeId)) { const res = { at: new Date().toISOString(), lines: autonLines, ran: autons.length }; await q("UPDATE strategy_maps SET last_run=$3 WHERE id=$1 AND user_id=$2", [mapId, userId, JSON.stringify(res)]); return res; }
  if (!targets.length && !loose.length && (autons.length || autoNodes.length)) { autonLines.unshift(...autoLines); autoLines.length = 0; }
  if (!targets.length && !loose.length && (autons.length || autonLines.length)) { const res = { at: new Date().toISOString(), lines: autonLines, ran: autons.length }; await q("UPDATE strategy_maps SET last_run=$3 WHERE id=$1 AND user_id=$2", [mapId, userId, JSON.stringify(res)]); return res; }
  if (!targets.length && !loose.length) return { lines: ["Nothing to run: attach a prompt, skill, point or method to a bot or agent (or write a prompt) first."], ran: 0 };

  // Load the skills/points referenced on the map once.
  const skillIds = [...new Set(nodes.filter((n) => (n.type === "skill" || n.type === "point") && n.data.refId).map((n) => n.data.refId!))];
  const skills = new Map((skillIds.length ? await q<any>("SELECT id, name, instructions, rules FROM skills WHERE user_id=$1 AND id = ANY($2::uuid[])", [userId, skillIds]) : []).map((s) => [s.id, s]));
  const instrOf = (n: MapNode): Instr | null => {
    if (n.type === "method" || n.type === "auto") return null;
    if (n.type === "prompt") { const t = (n.data.text ?? "").trim(); return t ? { node: n, text: t, name: n.data.label || "Prompt", edits: parseEdits(t) } : null; }
    const s = n.data.refId ? skills.get(n.data.refId) : null;
    if (!s) return null;
    return { node: n, text: s.instructions, name: s.name, edits: s.rules?.edits && Object.keys(s.rules.edits).length ? s.rules.edits : parseEdits(s.instructions) };
  };

  const lines: string[] = [];
  let ran = 0;
  const { parseControl, runControl } = await import("./ai/control");
  const { handlePrompt } = await import("./ai/interpret");
  for (const t of targets) {
    const row = t.type === "bot"
      ? await one<any>("SELECT id, name, status FROM trading_bots WHERE id=$1 AND user_id=$2", [t.data.refId, userId])
      : await one<any>("SELECT id, name, status FROM agents WHERE id=$1 AND user_id=$2", [t.data.refId, userId]);
    if (!row) { lines.push(`• ${t.data.label ?? "A " + t.type}: no longer exists; remove it from the map.`); continue; }
    const instrs = reach(t.id).map(instrOf).filter(Boolean) as Instr[];
    if (!instrs.length) continue;
    lines.push(`${row.name} (${t.type}):`);
    // Settings from every attached instruction are merged (later ones win), then written once.
    const merged = Object.assign({}, ...instrs.map((i) => i.edits ?? {}));
    if (Object.keys(merged).length) {
      const res = await applyEdits(userId, [{ kind: t.type as "bot" | "agent", id: row.id, name: row.name }], merged);
      lines.push(...res.map((l) => `  ${l}`)); ran++;
    }
    for (const i of instrs) {
      if (i.edits && i.node.type !== "prompt") { lines.push(`  • ${i.name}: settings applied (${fmtEdit(i.edits)}).`); continue; }
      if (i.edits) continue; // a prompt that only set numbers: already applied above
      if (i.node.type !== "prompt") { lines.push(`  • ${i.name}: attached as guidance (no stop-loss/take-profit/amount/dip numbers to apply).`); continue; }
      const ctl = await parseControl(userId, `${i.text} ${row.name}`).catch(() => null);
      if (ctl && ctl.targets.some((x) => x.id === row.id)) {
        const res = await runControl(userId, ctl.verb, ctl.targets.filter((x) => x.id === row.id), opts.isOwner);
        lines.push(...res.map((l) => `  ${l}`)); ran++; continue;
      }
      const r: any = await handlePrompt(userId, { text: `@${row.name} ${i.text}`, tz: opts.tz });
      lines.push(`  • “${i.text.slice(0, 80)}” → ${String(r?.message?.content ?? "sent to Merod").split("\n")[0].slice(0, 220)}`); ran++;
    }
  }
  for (const p of loose) {
    const r: any = await handlePrompt(userId, { text: p.data.text!.trim(), tz: opts.tz });
    lines.push(`Prompt “${p.data.text!.trim().slice(0, 80)}” → ${String(r?.message?.content ?? "sent to Merod").split("\n")[0].slice(0, 220)}`); ran++;
  }
  if (autoLines.length) lines.push(...autoLines);
  if (autonLines.length) lines.push(...autonLines);
  const result = { at: new Date().toISOString(), lines, ran: ran + autons.length + autoNodes.length };
  await q("UPDATE strategy_maps SET last_run=$3 WHERE id=$1 AND user_id=$2", [mapId, userId, JSON.stringify(result)]);
  return result;
}
