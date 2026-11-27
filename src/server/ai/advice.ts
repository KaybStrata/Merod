import "@/lib/server-only-shim";
import { one, q } from "../db";
import { gatherFacts, factsAnswer, money, type AssetFacts, type Bar } from "./market-answers";

/**
 * Prompt box / Modo:
 *   "give me advice" · "any suggestions?" · "should I buy SOL?" · "what should I do with my bots?"
 *       → a read of each coin/stock named (live price + its full history: trend, momentum, range, distance from highs)
 *         with a plain suggestion, plus the Advisor's suggestions about your own trades, bots, agents and prompts.
 *   "give me live updates on BTC and NVDA" · "keep me updated" · "stop live updates"
 *       → switches the always-on Advisor on (or off), adds the named coins/stocks to a "Live updates" watchlist so the
 *         Advisor flags their big moves, and answers with the live picture right now.
 */
export type AdviceIntent = "advice" | "live" | "stop";

export function adviceIntent(text: string): AdviceIntent | null {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (/^(buy|sell|create|make|set|add|remove|delete|cancel|pause|resume|turn)\b/.test(t) && !/\b(live updates?|advisor)\b/.test(t)) return null;
  if (/\b(stop|turn off|end|disable|pause|no more)\b.{0,20}\b(live updates?|updates|advisor|suggestions)\b/.test(t)) return "stop";
  if (/\b(live|real[- ]?time|continuous|ongoing) (updates?|alerts?|feed|advice|suggestions)\b|\bkeep me (posted|updated|informed|in the loop)\b|\b(update|notify) me (on|about|when|whenever|if)\b|\bgive me updates\b|\bturn on (the )?advisor\b/.test(t)) return "live";
  if (/\b(advice|advise|suggest(ion)?s?|recommend(ation)?s?|tips?|ideas?|insights?)\b|\bwhat should i (do|buy|sell|change|trade|hold|watch)\b|\bshould i (buy|sell|hold|keep|exit|take profit|add)\b|\bhow (can|do|could) i (improve|make more|do better|grow|stop losing)\b|\bis (it )?a good time to (buy|sell)\b|\bgood (buy|entry)\b/.test(t)) return "advice";
  return null;
}

const DAY = 86_400;
const pct = (a: number, b: number) => ((b - a) / a) * 100;
const sp = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const near = (b: Bar[], t: number) => { let best: Bar | null = null; for (const x of b) { if (x.t <= t) best = x; else break; } return best; };

/** Plain-language read of one coin/stock from its live price and full available history. */
export function readAsset(f: AssetFacts): string {
  const b = f.history?.bars ?? [], cur = f.live?.price ?? b.at(-1)?.c;
  if (!cur || b.length < 15) return `${f.symbol}: ${cur ? `${money(cur)} now, ` : ""}not enough real price history for a proper read.`;
  const now = Math.floor(Date.now() / 1000);
  const ch = (d: number) => { const p = near(b, now - d * DAY); return p ? pct(p.c, cur) : null; };
  const c7 = ch(7), c30 = ch(30), c90 = ch(90), c365 = ch(365);
  const last = b.slice(-20).map((x) => x.c), last50 = b.slice(-50).map((x) => x.c);
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const ma20 = avg(last), ma50 = last50.length >= 50 ? avg(last50) : null;
  const rets = b.slice(-31).map((x, i, a) => (i ? Math.log(x.c / a[i - 1].c) : 0)).slice(1);
  const vol = Math.sqrt(avg(rets.map((r) => r * r))) * Math.sqrt(365) * 100;
  const hi = Math.max(...b.map((x) => x.h || x.c)), fromHi = pct(hi, cur);
  const lo90 = Math.min(...b.slice(-90).map((x) => x.l || x.c)), hi90 = Math.max(...b.slice(-90).map((x) => x.h || x.c));
  const pos90 = hi90 > lo90 ? ((cur - lo90) / (hi90 - lo90)) * 100 : 50;
  const up = cur > ma20 && (ma50 == null || ma20 > ma50), down = cur < ma20 && (ma50 == null || ma20 < ma50);
  const facts = [`${money(cur)}${f.live?.change24hPct != null ? ` (${sp(f.live.change24hPct)} 24h)` : ""}`, c7 != null ? `7d ${sp(c7)}` : null, c30 != null ? `30d ${sp(c30)}` : null, c90 != null ? `90d ${sp(c90)}` : null, c365 != null ? `1y ${sp(c365)}` : null, `${fromHi.toFixed(0)}% from its high of ${money(hi)}`, `volatility ~${vol.toFixed(0)}%/yr`].filter(Boolean).join(" · ");
  let view: string;
  const stop = Math.max(2, Math.min(15, vol / 8)).toFixed(1);
  if (up && pos90 > 85 && (c7 ?? 0) > 15) view = `Strong uptrend but stretched (top of its 90-day range after ${sp(c7 ?? 0)} in a week). Chasing here is risky; wait for a pullback toward ${money(ma20)} (20-day average) or buy small with a ~${stop}% stop-loss.`;
  else if (up) view = `Uptrend: above its 20-day${ma50 ? " and 50-day" : ""} average. Momentum favors buyers; a position with a ~${stop}% stop-loss under ${money(Math.min(ma20, cur * (1 - Number(stop) / 100)))} keeps risk defined.`;
  else if (down && pos90 < 15) view = `Downtrend near the bottom of its 90-day range. Catching a falling knife is risky; wait for it to close back above ${money(ma20)} before buying, or use small staged buys.`;
  else if (down) view = `Downtrend: below its 20-day${ma50 ? " and 50-day" : ""} average. If you hold it, a stop-loss or trimming protects you; new buyers usually wait for it to reclaim ${money(ma20)}.`;
  else view = `Sideways / mixed: no clear trend. Range trading (buy near ${money(lo90)}, sell near ${money(hi90)}) fits better than momentum.`;
  return `${f.symbol}: ${facts}.\n  → ${view}`;
}

async function liveWatchlist(userId: string) {
  return (await one<{ id: string }>("SELECT id FROM watchlists WHERE user_id=$1 AND name='Live updates' LIMIT 1", [userId]))
    ?? (await one<{ id: string }>("INSERT INTO watchlists (user_id, name) VALUES ($1,'Live updates') RETURNING id", [userId]))!;
}

export async function adviceReply(userId: string, text: string, intent: AdviceIntent): Promise<string> {
  const { setAdvisor, runAdvisor, listTips, getAdvisor } = await import("../advisor");
  if (intent === "stop") {
    await setAdvisor(userId, { active: false });
    return "Live updates are off: the Advisor stopped analysing. Turn it back on any time with the Advisor switch in the left sidebar, or say “give me live updates”.";
  }
  const { facts, dates } = await gatherFacts(text, { userId }).catch(() => ({ facts: [] as AssetFacts[], dates: [] }));
  const assets = facts.filter((f) => f.live || f.history?.bars?.length);
  const out: string[] = [];

  if (intent === "live") {
    const was = (await getAdvisor(userId)).active;
    await setAdvisor(userId, { active: true, topics: { market: true } });
    let added: string[] = [];
    if (assets.length) {
      const wl = await liveWatchlist(userId);
      const ids = await q<any>("SELECT id, symbol FROM assets WHERE upper(symbol) = ANY($1) AND NOT ('demo_data' = ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST", [assets.map((a) => a.symbol.toUpperCase())]);
      const seen = new Set<string>();
      for (const r of ids) { if (seen.has(r.symbol)) continue; seen.add(r.symbol); await q("INSERT INTO watchlist_items (watchlist_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [wl.id, r.id]); added.push(r.symbol); }
    }
    out.push(`${was ? "Live updates are on" : "Live updates are on now"}: the Advisor keeps analysing markets and your trades, bots, agents and prompts around the clock and posts suggestions in the Advisor panel (left sidebar) and Activity → Updates.${added.length ? ` I'm watching ${added.join(", ")} for you (big moves, targets, trend changes).` : ""} Say “stop live updates” to turn it off.`);
    if (assets.length) out.push(`Right now:\n${assets.slice(0, 12).map(readAsset).join("\n")}`);
    const fresh = await runAdvisor(userId).catch(() => []);
    if (fresh.length) out.push(`New suggestions:\n${fresh.slice(0, 5).map((t: any) => `• ${t.title}`).join("\n")}`);
    return out.join("\n\n");
  }

  // Advice
  if (assets.length) {
    out.push(assets.slice(0, 15).map(readAsset).join("\n"));
    if (dates.length) { const hist = factsAnswer(assets, dates); if (hist) out.push(hist); }
  }
  const personal = !assets.length || /\b(my|bots?|agents?|trades?|portfolio|prompts?|strategy|strategies)\b/i.test(text);
  if (personal) {
    await runAdvisor(userId).catch(() => []);
    const tips = (await listTips(userId, 30)).filter((t: any) => !t.applied_at);
    const { analyze } = await import("../trade-updates");
    const a = await analyze(userId, 72).catch(() => null);
    if (a) out.push(a.summary);
    if (tips.length) out.push(`What I'd do:\n${tips.slice(0, 8).map((t: any) => `• ${t.title}: ${String(t.body).split(". ")[0]}.`).join("\n")}\nApply any of them with one click in the Advisor panel (left sidebar).`);
    else if (!assets.length) out.push("Nothing needs changing right now: no losing bots or agents, no positions at risk, no big moves on what you hold or watch. Ask about a specific coin or stock (e.g. “should I buy SOL?”) for a read on it.");
    if (!(await getAdvisor(userId)).active) out.push("Tip: turn on the Advisor (left sidebar) or say “give me live updates” and I'll keep doing this automatically.");
  }
  out.push("This is analysis of real market data and your own trading, not a guarantee; size positions so a stop-loss hit is a loss you're fine with.");
  return out.join("\n\n");
}
