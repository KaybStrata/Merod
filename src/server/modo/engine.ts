import "@/lib/server-only-shim";
import { one, q } from "../db";
import { getNews } from "../news/service";
import { aiAvailable, llmModoIdeas } from "../ai/llm";

/**
 * MODO — Merod's trading-idea assistant.
 * Thinks in visible steps (streamed to the UI): reads headlines, other Merod traders' flow (anonymous totals),
 * price momentum and the user's own positions; scores each asset with weights it has LEARNED from how its past
 * ideas actually performed; then writes up to 4 ideas (with Claude/ChatGPT when connected, else its own wording).
 * Learning: every idea is checked 1h and 24h later; signal weights move toward what has been right.
 * Ideas are suggestions only: acting on one goes through the normal order engine and your confirmations.
 */
type Step = (text: string, kind?: "read" | "signal" | "think" | "idea" | "learn" | "warn" | "news") => void | Promise<void>;
type Weights = { news: number; crowd: number; momentum: number; own: number };
const DEFAULT_W: Weights = { news: 1, crowd: 1, momentum: 1, own: 1 };

const POS = /\b(surge[sd]?|soar[sd]?|rall(y|ies|ied)|jump[sd]?|gain[sd]?|beat[sd]?|record high|all-time high|upgrade[sd]?|approv(al|ed|es)|partnership|bullish|breakout|inflows?|buyback|outperform|tops)\b/i;
const NEG = /\b(plunge[sd]?|crash(es|ed)?|tumble[sd]?|slump[sd]?|fall[s]?|fell|drop[s]?|sink[s]?|miss(es|ed)?|downgrade[sd]?|lawsuit|sue[sd]?|hack(ed)?|exploit|ban(s|ned)?|probe|bearish|outflows?|fraud|bankrupt|delist(ed)?|layoffs?)\b/i;
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const agoText = (iso: string) => { const m = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000)); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export type NewsFact = { title: string; url: string; source: string; publishedAt: string | null; summary: string; symbols: string[]; why: string; tone: "positive" | "negative" | "neutral" };

/**
 * News facts for this user: real headlines from the news feeds, word for word with source, time and link
 * (never rewritten by AI). Ranked by relevance: assets you hold, then your watchlist, then any ticker news, newest first.
 */
export async function newsFacts(userId: string, limit = 8, items?: any[]): Promise<NewsFact[]> {
  const list = items ?? (await getNews({ limit: 120 }).catch(() => ({ items: [] as any[] }))).items;
  const held = new Set((await q<{ symbol: string }>("SELECT DISTINCT a.symbol FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.user_id=$1 AND p.quantity>0", [userId])).map((r) => r.symbol));
  const watched = new Set((await q<{ symbol: string }>("SELECT DISTINCT a.symbol FROM watchlists w JOIN watchlist_items i ON i.watchlist_id=w.id JOIN assets a ON a.id=i.asset_id WHERE w.user_id=$1", [userId]).catch(() => [])).map((r) => r.symbol));
  const now = Date.now();
  return list.map((a: any) => {
    const h = a.symbols.filter((x: string) => held.has(x)), w = a.symbols.filter((x: string) => watched.has(x));
    const ageH = a.publishedAt ? (now - Date.parse(a.publishedAt)) / 3_600_000 : 48;
    const score = h.length * 6 + w.length * 4 + (a.symbols.length ? 2 : 0) - Math.min(ageH, 72) / 12;
    const tone = POS.test(a.title) && !NEG.test(a.title) ? "positive" : NEG.test(a.title) && !POS.test(a.title) ? "negative" : "neutral";
    const why = h.length ? `You hold ${h.join(", ")}` : w.length ? `On your list: ${w.join(", ")}` : a.symbols.length ? `Mentions ${a.symbols.slice(0, 3).join(", ")}` : "Market news";
    return { score, fact: { title: a.title, url: a.url, source: a.source, publishedAt: a.publishedAt, summary: String(a.summary ?? "").slice(0, 220), symbols: a.symbols.slice(0, 4), why, tone } as NewsFact };
  }).filter((x: any) => x.fact.publishedAt == null || now - Date.parse(x.fact.publishedAt) < 3 * 86_400_000)
    .sort((a: any, b: any) => b.score - a.score).slice(0, limit).map((x: any) => x.fact);
}

export async function modoState(userId: string) {
  const s = await one<{ weights: Weights; stats: any; notes: any[]; updated_at: string }>("SELECT weights, stats, notes, updated_at FROM modo_state WHERE user_id=$1", [userId]);
  return s ?? { weights: DEFAULT_W, stats: {}, notes: [], updated_at: null as any };
}

export async function think(userId: string, step: Step) {
  const state = await modoState(userId);
  const w = { ...DEFAULT_W, ...state.weights };
  await step(`Waking up. Signal weights I've learned so far: news ×${w.news.toFixed(2)}, trader flow ×${w.crowd.toFixed(2)}, momentum ×${w.momentum.toFixed(2)}, your positions ×${w.own.toFixed(2)}.`, "think");

  // 1) News
  const news = await getNews({ limit: 100 }).catch(() => ({ items: [] as any[], sources: [] as any[] }));
  const newsBy = new Map<string, { pos: number; neg: number; titles: string[] }>();
  for (const a of news.items) {
    const tone = (POS.test(a.title) ? 1 : 0) - (NEG.test(a.title) ? 1 : 0);
    for (const s of a.symbols) {
      const e = newsBy.get(s) ?? { pos: 0, neg: 0, titles: [] };
      if (tone > 0) e.pos++; else if (tone < 0) e.neg++;
      if (e.titles.length < 2) e.titles.push(a.title.slice(0, 110));
      newsBy.set(s, e);
    }
  }
  await step(news.items.length ? `Read ${news.items.length} headlines from ${news.sources.filter((s: any) => s.ok).map((s: any) => s.source).join(", ") || "news feeds"}; ${newsBy.size} mention specific tickers.` : "No headlines available right now, so I'll lean on trading flow and momentum.", "read");
  // Relevant news facts, quoted exactly as published.
  const facts = await newsFacts(userId, 4, news.items).catch(() => []);
  for (const f of facts) await step(`${f.source}${f.publishedAt ? `, ${agoText(f.publishedAt)}` : ""}: “${f.title}” (${f.why.toLowerCase()})`, "news");
  const topNews = [...newsBy.entries()].sort((a, b) => (b[1].pos + b[1].neg) - (a[1].pos + a[1].neg)).slice(0, 3);
  for (const [sym, e] of topNews) await step(`${sym} in the news: ${e.pos} positive, ${e.neg} negative. e.g. “${e.titles[0]}”`, "signal");

  // 2) Other traders on Merod (anonymous totals, last 6h)
  // Learned from other users' results: each trader's flow counts 0.5×–1.5× by how profitable their closed trades were (30 days).
  const crowd = await q<{ asset_id: string; symbol: string; net: string; traders: number }>(
    `WITH skill AS (
       SELECT user_id, 0.5 + COALESCE(count(*) FILTER (WHERE realized_pnl > 0)::numeric / NULLIF(count(*),0), 0.5) AS w
         FROM orders WHERE side='sell' AND status='filled' AND updated_at > now() - interval '30 days' GROUP BY user_id)
     SELECT a.id AS asset_id, a.symbol,
            SUM(COALESCE(sk.w, 1) * CASE WHEN o.side='buy' THEN e.quantity*e.price ELSE -e.quantity*e.price END) AS net, count(DISTINCT o.user_id)::int AS traders
       FROM executions e JOIN orders o ON o.id=e.order_id JOIN assets a ON a.id=o.asset_id LEFT JOIN skill sk ON sk.user_id=o.user_id
      WHERE e.executed_at > now() - interval '6 hours' AND o.user_id <> $1 AND o.source NOT IN ('auto','copy') AND NOT ('demo_data' = ANY(a.risk_flags))
      GROUP BY a.id, a.symbol ORDER BY abs(SUM(COALESCE(sk.w, 1) * CASE WHEN o.side='buy' THEN e.quantity*e.price ELSE -e.quantity*e.price END)) DESC LIMIT 15`, [userId]);
  await step(crowd.length ? `Checked the last 6 hours of trading by other Merod users: ${crowd.length} assets with activity (traders with profitable recent trades count more).` : "Other Merod traders have been quiet in the last 6 hours.", "read");
  for (const c of crowd.slice(0, 2)) await step(`${c.traders} trader${c.traders > 1 ? "s" : ""} net ${Number(c.net) >= 0 ? "bought" : "sold"} $${Math.abs(Number(c.net)).toFixed(0)} of ${c.symbol}.`, "signal");

  // 3) Your own book
  const mine = await q<any>(
    `SELECT a.id AS asset_id, a.symbol, SUM(p.quantity) AS qty, SUM(p.quantity*p.avg_cost) AS cost, MAX(a.last_price) AS px
       FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.user_id=$1 AND p.quantity > 0 GROUP BY a.id, a.symbol`, [userId]);
  const losers = await q<{ symbol: string; n: number; pnl: string }>(
    `SELECT a.symbol, count(*)::int AS n, SUM(o.realized_pnl) AS pnl FROM orders o JOIN assets a ON a.id=o.asset_id
      WHERE o.user_id=$1 AND o.side='sell' AND o.status='filled' AND o.updated_at > now() - interval '30 days' GROUP BY a.symbol HAVING SUM(o.realized_pnl) < 0`, [userId]);
  await step(mine.length ? `Looked at your ${mine.length} open position${mine.length > 1 ? "s" : ""}${losers.length ? ` and your recent losses in ${losers.map((l) => l.symbol).join(", ")}` : ""}.` : "You have no open positions, so I'll look for fresh entries.", "read");

  // 4) Candidates + momentum
  const symbols = [...new Set([...newsBy.keys(), ...crowd.map((c) => c.symbol), ...mine.map((m) => m.symbol)])].slice(0, 40);
  const candidates = await q<any>(
    `SELECT DISTINCT ON (upper(a.symbol)) a.id, a.symbol, a.asset_class, a.last_price, a.change_24h, a.price_source, a.volume_24h
       FROM assets a WHERE (upper(a.symbol) = ANY($1) OR a.id IN (SELECT id FROM assets WHERE NOT ('demo_data' = ANY(risk_flags)) ORDER BY volume_24h DESC NULLS LAST LIMIT 12))
        AND NOT ('demo_data' = ANY(a.risk_flags)) AND a.last_price IS NOT NULL ORDER BY upper(a.symbol), a.volume_24h DESC NULLS LAST`, [symbols.map((s) => s.toUpperCase())]);
  await step(`Scoring ${candidates.length} candidate assets.`, "think");

  const scored = candidates.map((a) => {
    const n = newsBy.get(a.symbol);
    const news = n ? clamp((n.pos - n.neg) / Math.max(2, n.pos + n.neg), -1, 1) : 0;
    const c = crowd.find((x) => x.asset_id === a.id || x.symbol === a.symbol);
    const crowdS = c ? clamp(Number(c.net) / 2000, -1, 1) * Math.min(1, c.traders / 3) : 0;
    const ch = Number(a.change_24h ?? 0) / 100;
    const momentum = clamp(ch / 0.08, -1, 1);
    const pos = mine.find((m) => m.asset_id === a.id);
    const loss = losers.find((l) => l.symbol === a.symbol);
    let own = 0;
    if (pos) { const gain = Number(pos.px) * Number(pos.qty) / Number(pos.cost) - 1; own = gain > 0.15 ? -0.6 : gain < -0.1 ? -0.4 : 0.1; }
    if (loss) own -= 0.3;
    const score = w.news * news + w.crowd * crowdS + w.momentum * momentum + w.own * own;
    const agree = [news, crowdS, momentum].filter((x) => Math.sign(x) === Math.sign(score) && Math.abs(x) > 0.15).length;
    return { a, news, crowd: crowdS, momentum, own, score, agree, pos, newsInfo: n, crowdInfo: c };
  }).filter((x) => Math.abs(x.score) > 0.35 && x.agree >= 1).sort((x, y) => Math.abs(y.score) - Math.abs(x.score)).slice(0, 6);

  if (!scored.length) { await step("Nothing stands out right now: no asset has signals that agree strongly enough. Sitting on my hands is a valid call.", "think"); return []; }
  for (const s of scored.slice(0, 3)) await step(`${s.a.symbol}: news ${s.news.toFixed(2)}, flow ${s.crowd.toFixed(2)}, momentum ${s.momentum.toFixed(2)}${s.pos ? ", you hold it" : ""} → score ${s.score.toFixed(2)}.`, "signal");

  // 5) Write the ideas
  const ai = (await aiAvailable("anthropic", userId)) ? { p: "anthropic" as const, m: "claude-opus-5-5" } : (await aiAvailable("openai", userId)) ? { p: "openai" as const, m: (process.env.OPENAI_MODELS ?? "gpt-5").split(",")[0].trim() } : null;
  let ideas: { symbol: string; side: "buy" | "sell"; thesis: string; risk: string; confidence: number }[] = [];
  if (ai) {
    await step(`Asking ${ai.p === "anthropic" ? "Claude" : "ChatGPT"} to weigh these signals and write up the ideas…`, "think");
    const table = scored.map((s) => `${s.a.symbol} (${s.a.asset_class}) price=${s.a.last_price} 24h=${pct(Number(s.a.change_24h ?? 0) / 100)} news=${s.news.toFixed(2)}${s.newsInfo ? ` [${s.newsInfo.pos}+/${s.newsInfo.neg}- e.g. "${s.newsInfo.titles[0]}"]` : ""} trader_flow=${s.crowd.toFixed(2)}${s.crowdInfo ? ` [${s.crowdInfo.traders} traders, net $${Number(s.crowdInfo.net).toFixed(0)}]` : ""} momentum=${s.momentum.toFixed(2)} own=${s.own.toFixed(2)}${s.pos ? " [user holds it]" : ""} weighted_score=${s.score.toFixed(2)}`).join("\n")
      + `\nlearned_weights: ${JSON.stringify(w)}; learned_hit_rates: ${JSON.stringify(state.stats?.hitRates ?? {})}`;
    try { ideas = (await llmModoIdeas(ai.p, ai.m, table, userId)).ideas.filter((i) => scored.some((s) => s.a.symbol === i.symbol)); }
    catch (e: any) { await step(`The AI didn't answer (${String(e.message).slice(0, 80)}); writing the ideas myself.`, "warn"); }
  }
  if (!ideas.length) {
    // Without an AI: bullish → buy idea; bearish → trim idea only if you hold it (Modo never suggests shorting).
    ideas = scored.filter((s) => s.score > 0 || s.pos).slice(0, 3).map((s) => {
      const side: "buy" | "sell" = s.score > 0 ? "buy" : "sell";
      const why = [s.newsInfo && Math.abs(s.news) > 0.15 ? `${s.newsInfo.pos} positive vs ${s.newsInfo.neg} negative headlines` : null,
        s.crowdInfo && Math.abs(s.crowd) > 0.15 ? `${s.crowdInfo.traders} Merod trader${s.crowdInfo.traders > 1 ? "s" : ""} net ${Number(s.crowdInfo.net) > 0 ? "buying" : "selling"}` : null,
        Math.abs(s.momentum) > 0.15 ? `${pct(Number(s.a.change_24h ?? 0) / 100)} over 24h` : null,
        s.pos && s.own < 0 ? "you already hold a sizeable gain or loss here" : null].filter(Boolean).join(", ");
      return { symbol: s.a.symbol, side, thesis: `${side === "sell" ? "Consider trimming" : "Leaning toward buying"} ${s.a.symbol}: ${why || "signals line up"}.`,
        risk: "Signals can reverse quickly and news-driven moves often fade. Size small and use a stop-loss.", confidence: clamp(0.35 + 0.12 * s.agree + Math.abs(s.score) * 0.08, 0, 0.8) };
    });
  }

  // 6) Save (skip repeats of the same idea within 6h)
  const saved: any[] = [];
  for (const i of ideas) {
    const s = scored.find((x) => x.a.symbol === i.symbol)!;
    if (await one("SELECT 1 FROM modo_ideas WHERE user_id=$1 AND symbol=$2 AND side=$3 AND created_at > now() - interval '6 hours'", [userId, i.symbol, i.side])) {
      await step(`${i.side === "buy" ? "Buy" : "Sell"} ${i.symbol} is still my view from earlier.`, "idea"); continue;
    }
    const row = await one<any>(
      `INSERT INTO modo_ideas (user_id, asset_id, symbol, side, thesis, risk, signals, confidence, price_at, price_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [userId, s.a.id, i.symbol, i.side, i.thesis.slice(0, 600), i.risk?.slice(0, 300) ?? null,
       JSON.stringify({ news: +s.news.toFixed(3), crowd: +s.crowd.toFixed(3), momentum: +s.momentum.toFixed(3), own: +s.own.toFixed(3) }), clamp(i.confidence, 0, 0.85), s.a.last_price, s.a.price_source]);
    saved.push(row);
    await step(`Idea: ${i.side.toUpperCase()} ${i.symbol} (${Math.round(clamp(i.confidence, 0, 0.85) * 100)}% confidence). ${i.thesis}`, "idea");
  }
  return saved;
}

/** Learning loop: grade ideas against what the price did, then nudge signal weights toward what worked. */
export async function learn() {
  const due = await q<any>(
    `SELECT m.*, a.last_price AS px_now FROM modo_ideas m JOIN assets a ON a.id=m.asset_id
      WHERE m.price_at > 0 AND ((m.ret_1h IS NULL AND m.created_at < now() - interval '1 hour') OR (m.ret_24h IS NULL AND m.created_at < now() - interval '24 hours'))
      ORDER BY m.created_at LIMIT 200`);
  const users = new Set<string>();
  for (const m of due) {
    const r = (Number(m.px_now) / Number(m.price_at) - 1) * (m.side === "buy" ? 1 : -1);
    if (m.ret_1h == null) await q("UPDATE modo_ideas SET ret_1h=$2 WHERE id=$1", [m.id, r]);
    else await q("UPDATE modo_ideas SET ret_24h=$2, evaluated_at=now() WHERE id=$1", [m.id, r]);
    users.add(m.user_id);
  }
  for (const userId of users) {
    const rows = await q<any>("SELECT signals, COALESCE(ret_24h, ret_1h) AS r FROM modo_ideas WHERE user_id=$1 AND ret_1h IS NOT NULL ORDER BY created_at DESC LIMIT 200", [userId]);
    const stats: Record<string, { n: number; hits: number }> = {};
    for (const row of rows) {
      const sig = row.signals ?? {};
      const dominant = (Object.entries(sig) as [string, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]?.[0];
      if (!dominant) continue;
      stats[dominant] ??= { n: 0, hits: 0 };
      stats[dominant].n++; if (Number(row.r) > 0) stats[dominant].hits++;
    }
    const old = await modoState(userId);
    const w = { ...DEFAULT_W, ...old.weights };
    const notes: any[] = [];
    const hitRates: Record<string, number> = {};
    for (const [k, v] of Object.entries(stats)) {
      hitRates[k] = +(v.hits / v.n).toFixed(2);
      if (v.n < 5) continue;
      const target = clamp(0.4 + (v.hits / v.n) * 1.4, 0.3, 1.8); // 50% hit rate ≈ 1.1 weight
      const next = +(w[k as keyof Weights] * 0.7 + target * 0.3).toFixed(3);
      if (Math.abs(next - w[k as keyof Weights]) >= 0.03) {
        notes.push({ at: new Date().toISOString(), text: `${{ news: "News", crowd: "Trader flow", momentum: "Momentum", own: "Your-position" }[k] ?? k} ideas were right ${Math.round((v.hits / v.n) * 100)}% of the time (${v.n} ideas), so I ${next > w[k as keyof Weights] ? "now trust" : "now discount"} that signal more (×${w[k as keyof Weights].toFixed(2)} → ×${next.toFixed(2)}).` });
        w[k as keyof Weights] = next;
      }
    }
    const total = rows.length, wins = rows.filter((r) => Number(r.r) > 0).length;
    await q(`INSERT INTO modo_state (user_id, weights, stats, notes, updated_at) VALUES ($1,$2,$3,$4,now())
             ON CONFLICT (user_id) DO UPDATE SET weights=$2, stats=$3, notes=$4, updated_at=now()`,
      [userId, JSON.stringify(w), JSON.stringify({ hitRates, graded: total, winRate: total ? +(wins / total).toFixed(2) : null }), JSON.stringify([...notes, ...(old.notes ?? [])].slice(0, 25))]);
  }
  return due.length;
}

export async function recentIdeas(userId: string) {
  return q("SELECT id, asset_id, symbol, side, thesis, risk, signals, confidence, price_at, price_source, ret_1h, ret_24h, created_at FROM modo_ideas WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [userId]);
}
