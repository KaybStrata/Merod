import "@/lib/server-only-shim";
import { one, q } from "./db";
import { HttpError } from "./errors";
import { analyze, runAction, type Action } from "./trade-updates";

/**
 * Advisor: runs on its own (worker loop) for every user who switched it on, until they switch it off.
 * Each pass looks at:
 *   market  – coins and stocks the user holds or watches (big moves, profit to take, losses to protect) and the
 *             strongest/weakest liquid movers in the catalog,
 *   trades / bots / agents – the same analysis as Talk → Update (losing bots, loose stop-losses, losing coins,
 *             winners that deserve more), plus bots in error, agents blocked by risk, running bots that never trade,
 *   prompts  – prompts Merod couldn't act on, and prompts typed again and again that could be a schedule.
 * Tips are de-duplicated (the same tip isn't repeated within 12 hours) and can carry an action the user applies with
 * one click. Nothing is ever applied without that click.
 */
export type Topic = "market" | "trades" | "bots" | "agents" | "prompts";
export type TipAction = Action | { type: "prompt"; text: string };
type Tip = { topic: Topic; title: string; body: string; link?: string; action?: TipAction; priority: 1 | 2 | 3; key: string };
const TOPICS: Topic[] = ["market", "trades", "bots", "agents", "prompts"];

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const money = (n: number) => `$${Math.abs(n) >= 1 ? Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : Math.abs(n).toPrecision(3)}`;
const day = () => new Date().toISOString().slice(0, 10);

export async function getAdvisor(userId: string) {
  const s = await one<any>("SELECT * FROM advisor_settings WHERE user_id=$1", [userId]);
  return s ?? { user_id: userId, active: false, every_sec: 30, every_min: 1, topics: Object.fromEntries(TOPICS.map((t) => [t, true])), notify: false, last_run_at: null };
}
export async function setAdvisor(userId: string, o: { active?: boolean; everySec?: number; everyMin?: number; topics?: Partial<Record<Topic, boolean>>; notify?: boolean }) {
  const cur = await getAdvisor(userId);
  // How often it checks, in seconds (30 s … 1 day). everyMin is still accepted from older clients.
  const every = Math.max(30, Math.min(86_400, Math.round(o.everySec ?? (o.everyMin != null ? o.everyMin * 60 : cur.every_sec ?? 30))));
  const topics = { ...(cur.topics ?? {}), ...(o.topics ?? {}) };
  const turningOn = o.active === true && !cur.active;
  return one<any>(
    `INSERT INTO advisor_settings (user_id, active, every_sec, every_min, topics, notify, next_run_at) VALUES ($1,$2,$3::int,GREATEST(2, CEIL($3::int/60.0)::int),$4,$5, now())
     ON CONFLICT (user_id) DO UPDATE SET active=$2, every_sec=$3::int, every_min=GREATEST(2, CEIL($3::int/60.0)::int), topics=$4, notify=$5, updated_at=now(),
       next_run_at = CASE WHEN $6 THEN now() ELSE advisor_settings.next_run_at END
     RETURNING *`, [userId, o.active ?? cur.active ?? false, every, JSON.stringify(topics), o.notify ?? cur.notify ?? false, turningOn]);
}
export async function listTips(userId: string, limit = 50) {
  return q<any>("SELECT * FROM advisor_tips WHERE user_id=$1 AND dismissed_at IS NULL ORDER BY (applied_at IS NULL) DESC, priority, id DESC LIMIT $2", [userId, limit]);
}

/* ───────── Generators ───────── */
async function marketTips(userId: string): Promise<Tip[]> {
  const out: Tip[] = [];
  const held = await q<any>(
    `SELECT a.id, a.symbol, a.asset_class, a.last_price, a.change_24h, sum(p.quantity) AS qty, sum(p.quantity*p.avg_cost)/NULLIF(sum(p.quantity),0) AS cost
       FROM positions p JOIN assets a ON a.id=p.asset_id
      WHERE p.user_id=$1 AND p.quantity > 0 AND a.last_price IS NOT NULL AND NOT ('demo_data' = ANY(a.risk_flags))
      GROUP BY a.id`, [userId]);
  for (const h of held) {
    const px = Number(h.last_price), cost = Number(h.cost), value = px * Number(h.qty);
    if (!(cost > 0) || value < 5) continue;
    const g = (px / cost - 1) * 100;
    const qty = Number(h.qty), pnl = (px - cost) * qty, d24 = Number(h.change_24h ?? 0);
    const dayTxt = Number.isFinite(d24) && d24 !== 0 ? ` In the last 24h it moved ${pct(d24)}.` : "";
    const held_ = `You hold ${+qty.toPrecision(5)} ${h.symbol} worth ${money(value)}, bought at about ${money(cost)}; it's ${money(px)} now`;
    if (g >= 15) out.push({ topic: "market", priority: 1, key: `tp:${h.id}:${Math.floor(g / 10)}`, title: `${h.symbol} is ${pct(g)} above your entry`,
      body: `${held_}, an unrealized gain of +${money(pnl)}.${dayTxt} Why act: after a run like this, coins often give back part of the move. Selling half locks in about +${money(pnl / 2)} and leaves the rest to keep riding. "Do it" asks Merod to sell 50% of your ${h.symbol}; you approve the order before anything is sold.`,
      link: `/terminal/${h.id}`, action: { type: "prompt", text: `sell 50% of my ${h.symbol}` } });
    else if (g <= -10) out.push({ topic: "market", priority: 1, key: `dd:${h.id}:${Math.floor(-g / 10)}`, title: `${h.symbol} is ${pct(g)} below your entry`,
      body: `${held_}, an unrealized loss of -${money(-pnl)}.${dayTxt} Why act: without a stop-loss a falling coin can keep sliding, and small coins can go much lower. "Do it" sets a price alert 5% lower, at ${money(px * 0.95)}, so you're told before it falls further; to cut the loss now instead, say "sell my ${h.symbol}".`,
      link: `/terminal/${h.id}`, action: { type: "prompt", text: `alert me if ${h.symbol} drops below ${+(px * 0.95).toPrecision(4)}` } });
    const ch = Number(h.change_24h ?? 0);
    if (Math.abs(ch) >= 8 && g > -10 && g < 15) out.push({ topic: "market", priority: 2, key: `mv:${h.id}:${day()}:${ch > 0 ? "u" : "d"}`, title: `${h.symbol} ${pct(ch)} in 24h (you hold it)`, body: `A ${Math.abs(ch) >= 15 ? "very " : ""}large move on a coin/stock you own. Check whether your bots' stop-loss and take-profit still fit.`, link: `/terminal/${h.id}` });
  }
  const watched = await q<any>(
    `SELECT DISTINCT a.id, a.symbol, a.change_24h, a.last_price, wi.target_price FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id JOIN assets a ON a.id=wi.asset_id
      WHERE w.user_id=$1 AND a.last_price IS NOT NULL AND NOT ('demo_data' = ANY(a.risk_flags))`, [userId]).catch(() => []);
  for (const w of watched) {
    const ch = Number(w.change_24h ?? 0);
    if (Math.abs(ch) >= 7 && !held.some((h) => h.id === w.id)) out.push({ topic: "market", priority: 2, key: `wl:${w.id}:${day()}:${ch > 0 ? "u" : "d"}`, title: `Watchlist: ${w.symbol} ${pct(ch)} in 24h`, body: ch > 0 ? `Strong move on a coin/stock you're watching. Momentum often continues for a while, but chasing a spike is risky: consider a small position or waiting for a pullback.` : `${w.symbol} dropped hard. If you liked it higher, this may be a better entry, or a sign to stay away; check the news first.`, link: `/research/${w.id}`, action: { type: "prompt", text: `research ${w.symbol}` } });
    if (w.target_price && Number(w.last_price) <= Number(w.target_price) * 1.01 && Number(w.last_price) >= Number(w.target_price) * 0.97) out.push({ topic: "market", priority: 1, key: `tg:${w.id}:${day()}`, title: `${w.symbol} reached your target ${money(Number(w.target_price))}`, body: `It's ${money(Number(w.last_price))} now.`, link: `/terminal/${w.id}`, action: { type: "prompt", text: `buy $100 of ${w.symbol}` } });
  }
  // Strongest and weakest liquid movers (crypto and stocks), once per day per asset.
  const movers = await q<any>(
    `(SELECT id, symbol, asset_class, change_24h, 'up' AS dir FROM assets WHERE last_price IS NOT NULL AND change_24h IS NOT NULL AND NOT ('demo_data' = ANY(risk_flags)) AND NOT ('low_liquidity' = ANY(risk_flags))
        AND (COALESCE(liquidity_usd,0) >= 1000000 OR COALESCE(market_cap,0) >= 100000000) AND price_updated_at > now() - interval '6 hours' ORDER BY change_24h DESC LIMIT 2)
     UNION ALL
     (SELECT id, symbol, asset_class, change_24h, 'down' AS dir FROM assets WHERE last_price IS NOT NULL AND change_24h IS NOT NULL AND NOT ('demo_data' = ANY(risk_flags)) AND NOT ('low_liquidity' = ANY(risk_flags))
        AND COALESCE(market_cap,0) >= 1000000000 AND price_updated_at > now() - interval '6 hours' ORDER BY change_24h ASC LIMIT 1)`).catch(() => []);
  for (const m of movers) {
    const ch = Number(m.change_24h);
    if (m.dir === "up" && ch >= 6) out.push({ topic: "market", priority: 3, key: `mom:${m.id}:${day()}`, title: `Momentum: ${m.symbol} ${pct(ch)} today`, body: `One of the strongest liquid ${m.asset_class === "crypto" ? "coins" : "stocks"} right now. Good candidate for a momentum bot with a tight stop-loss, or just to watch.`, link: `/research/${m.id}`, action: { type: "prompt", text: `research ${m.symbol}` } });
    if (m.dir === "down" && ch <= -6) out.push({ topic: "market", priority: 3, key: `dip:${m.id}:${day()}`, title: `Large-cap dip: ${m.symbol} ${pct(ch)} today`, body: `A big name down sharply. Dip-buying large caps has worked better than small caps, but wait for it to stop falling.`, link: `/research/${m.id}`, action: { type: "prompt", text: `research ${m.symbol}` } });
  }
  return out;
}

async function tradingTips(userId: string, topics: Record<string, boolean>): Promise<Tip[]> {
  const out: Tip[] = [];
  const a = await analyze(userId, 24);
  for (const d of a.decisions) {
    const topic: Topic = d.action.type === "point" ? "trades" : d.action.kind === "agent" ? "agents" : "bots";
    if (!topics[topic]) continue;
    const key = d.action.type === "point" ? `avoid:${d.action.name}` : `${d.action.type}:${d.action.id}:${d.action.type === "edit" ? Object.keys(d.action.edit).join(",") : ""}`;
    out.push({ topic, priority: d.safe ? 1 : 2, key, title: d.title, body: d.why, action: d.action });
  }
  if (topics.trades && a.stats.closed >= 5) {
    const s = a.stats;
    out.push({ topic: "trades", priority: 3, key: `day:${day()}:${Math.floor(s.closed / 10)}`, title: `Last 24h: ${s.winRate}% of ${s.closed} trades won, ${s.net >= 0 ? "+" : "-"}${money(s.net)}`,
      body: `${s.best ? `Best: ${s.best.name} (+${money(s.best.net)}). ` : ""}${s.worst ? `Worst: ${s.worst.name} (-${money(s.worst.net)}). ` : ""}${(s.winRate ?? 0) < 45 ? "More losers than winners: smaller sizes or tighter stops until it improves." : "Keep doing what works; consider moving size from the worst performer to the best."}`, link: "/review" });
  }
  if (topics.bots) {
    for (const n of a.stats.idle.slice(0, 3)) out.push({ topic: "bots", priority: 3, key: `idle:${n}:${day()}`, title: `${n} hasn't traded in 24h`, body: `It's running but its conditions never triggered. Loosen its entry (e.g. a smaller dip) or point it at more active coins, or turn it off to free its budget.`, link: "/bots" });
    const broken = await q<any>("SELECT id, name, status FROM trading_bots WHERE user_id=$1 AND status IN ('error','halted')", [userId]);
    for (const b of broken) out.push({ topic: "bots", priority: 1, key: `err:${b.id}:${day()}`, title: `${b.name} is ${b.status}`, body: `This bot stopped on its own. Open it to see the last error, fix it and restart it.`, link: `/bots/${b.id}` });
  }
  if (topics.agents) {
    const ag = await q<any>("SELECT id, name, status FROM agents WHERE user_id=$1 AND status IN ('risk_blocked','failed','pending_approval')", [userId]).catch(() => []);
    for (const x of ag) out.push({ topic: "agents", priority: x.status === "pending_approval" ? 2 : 1, key: `ag:${x.id}:${x.status}:${day()}`, title: `${x.name} is ${x.status.replace("_", " ")}`, body: x.status === "pending_approval" ? "It's waiting for you to approve it before it can trade." : x.status === "risk_blocked" ? "Its risk limits stopped it. Raise its allocation or limits, or let it rest." : "It failed; open it to see why.", link: `/agents/${x.id}` });
  }
  return out;
}

async function promptTips(userId: string): Promise<Tip[]> {
  const out: Tip[] = [];
  const unclear = await one<{ n: number }>("SELECT count(*)::int AS n FROM trading_prompts WHERE user_id=$1 AND role='assistant' AND status IN ('clarify','rejected') AND created_at > now() - interval '24 hours'", [userId]);
  if ((unclear?.n ?? 0) >= 3) out.push({ topic: "prompts", priority: 2, key: `unclear:${day()}`, title: `${unclear!.n} prompts today needed clarifying or were rejected`, body: `Naming the coin/stock, an amount and what should happen works best, e.g. “buy $50 of SOL, stop loss 5%, take profit 10%”. You can also save how you like to trade as a Skill so Merod stops asking.`, link: "/talk" });
  const repeats = await q<any>(
    `SELECT lower(regexp_replace(content, '\\s+', ' ', 'g')) AS t, count(*)::int AS n FROM trading_prompts
      WHERE user_id=$1 AND role='user' AND created_at > now() - interval '7 days' AND length(content) BETWEEN 8 AND 300
      GROUP BY 1 HAVING count(*) >= 3 ORDER BY 2 DESC LIMIT 2`, [userId]);
  for (const r of repeats) {
    if (/^(every|schedule|show|what|how|why|status)/.test(r.t)) continue;
    out.push({ topic: "prompts", priority: 3, key: `rep:${r.t.slice(0, 60)}`, title: `You've typed “${r.t.slice(0, 50)}” ${r.n} times this week`, body: `Make it automatic: Merod can run it on a schedule (e.g. every morning at 9am) or you can save it as a Shortcut.`, action: { type: "prompt", text: `every day at 9am ${r.t}` } });
  }
  return out;
}

/** One Advisor pass for a user: generates, de-duplicates and stores new tips. */
export async function runAdvisor(userId: string) {
  const s = await getAdvisor(userId);
  const topics: Record<string, boolean> = { ...Object.fromEntries(TOPICS.map((t) => [t, true])), ...(s.topics ?? {}) };
  const tips: Tip[] = [];
  const safe = async (f: () => Promise<Tip[]>) => { try { tips.push(...(await f())); } catch (e: any) { console.error("[advisor]", e?.message); } };
  if (topics.market) await safe(() => marketTips(userId));
  if (topics.trades || topics.bots || topics.agents) await safe(() => tradingTips(userId, topics));
  if (topics.prompts) await safe(() => promptTips(userId));
  const fresh: any[] = [];
  for (const t of tips.sort((a, b) => a.priority - b.priority)) {
    if (fresh.length >= 8) break;
    const seen = await one("SELECT 1 FROM advisor_tips WHERE user_id=$1 AND dedupe_key=$2 AND created_at > now() - interval '12 hours'", [userId, t.key]);
    if (seen) continue;
    const family = t.key.split(":").slice(0, 2).join(":");
    await q("UPDATE advisor_tips SET dismissed_at=now() WHERE user_id=$1 AND dismissed_at IS NULL AND applied_at IS NULL AND (dedupe_key = $2 OR dedupe_key LIKE $2 || ':%')", [userId, family]);
    fresh.push(await one<any>("INSERT INTO advisor_tips (user_id, topic, title, body, link, action, priority, dedupe_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [userId, t.topic, t.title.slice(0, 200), t.body.slice(0, 1000), t.link ?? null, t.action ? JSON.stringify(t.action) : null, t.priority, t.key.slice(0, 200)]));
  }
  await q("UPDATE advisor_settings SET last_run_at=now() WHERE user_id=$1", [userId]);
  if (fresh.length) {
    const { publish } = await import("./realtime");
    await publish(`user:${userId}`, "advisor", { count: fresh.length }).catch(() => {});
    if (s.notify) {
      const { notify } = await import("./engine/engine");
      for (const t of fresh.filter((x) => x.priority === 1).slice(0, 3)) await notify(userId, "advisor", `Advisor: ${t.title}`, t.body, "/advisor").catch(() => {});
    }
  }
  return fresh;
}

/** Worker: run every user's Advisor that's due. */
export async function runDueAdvisors() {
  const due = await q<any>("UPDATE advisor_settings SET next_run_at = now() + make_interval(secs => every_sec) WHERE active AND next_run_at <= now() RETURNING user_id");
  for (const d of due) await runAdvisor(d.user_id).catch((e) => console.error("[advisor]", d.user_id, e?.message));
  return due.length;
}

/** The user pressed Apply (or Dismiss) on a tip. */
export async function actOnTip(userId: string, id: number, act: "apply" | "dismiss", opts: { isOwner: boolean; tz?: string }) {
  const t = await one<any>("SELECT * FROM advisor_tips WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!t) throw new HttpError(404, "Tip not found");
  if (act === "dismiss") { await q("UPDATE advisor_tips SET dismissed_at=now() WHERE id=$1", [id]); return { note: "Dismissed" }; }
  if (t.applied_at) return { note: t.applied_note ?? "Already done" };
  if (!t.action) throw new HttpError(400, "This tip has nothing to apply; open it instead.");
  let note: string;
  if (t.action.type === "prompt") {
    const { handlePrompt } = await import("./ai/interpret");
    const r: any = await handlePrompt(userId, { text: t.action.text, tz: opts.tz });
    note = `Sent to Merod: “${t.action.text}”. ${String(r?.message?.content ?? "").split("\n")[0].slice(0, 200)}`;
  } else note = await runAction(userId, t.action, opts.isOwner);
  await q("UPDATE advisor_tips SET applied_at=now(), applied_note=$2 WHERE id=$1", [id, note.slice(0, 500)]);
  return { note };
}
