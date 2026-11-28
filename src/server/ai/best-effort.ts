import "@/lib/server-only-shim";
import { one } from "../db";
import { gatherFacts, factsAnswer, type AssetFacts } from "./market-answers";
import { readAsset } from "./advice";
import { statusSnapshot, statusAnswer } from "./status";

/**
 * Modo without any outside AI: when a request doesn't match a command it can run, it still answers from real data
 * instead of saying it's confused or needs another AI:
 *   - every coin/stock named → live price + full-history read (trend, range, highs, suggestion), and any dates asked about;
 *   - anything about bots, agents, trades, portfolio, money → a status answer from your live account;
 *   - then the closest commands it can run right now, so one tap does it.
 */
const CATALOG = [
  "all bots $35 per trade", "increase every bot's budget by 20%", "stop loss 8% on all bots", "take profit 10% on all bots", "give all agents $5,000 capital",
  "turn off all bots", "turn on all bots", "buy $100 of BTC", "sell half my ETH", "alert me if BTC drops below 60000", "create a bot that buys SOL dips of 3% and sells at +5%",
  "create 3 agents that trade ETH", "how is my portfolio doing?", "how are my bots doing?", "any suggestions?", "should I buy SOL?", "give me live updates on BTC",
  "what was BTC in March 2021?", "compare NVDA and AMD over 1 year", "create a skill: always use a 5% stop loss", "every day at 9am buy $20 of BTC", "mimic the top 20 crypto traders this week",
  "open purchase history", "turn Modo on", "max slippage 3%", "pause everything",
];
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9$% ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|all|my|me|you|can|please|with|this|that|what|how)$/.test(w)));

export function closestCommands(text: string, n = 4) {
  const q = words(text);
  return CATALOG.map((c) => { const w = words(c); let s = 0; for (const x of q) if (w.has(x) || [...w].some((y) => y.startsWith(x.slice(0, 4)))) s++; return { c, s }; })
    .sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.c);
}

/** Default size for a buy that didn't say how much: the user's Skill $ per trade, else $100 capped at their max order. */
export async function defaultBuyUsd(userId: string) {
  const { activeRules } = await import("../skills");
  const r = await activeRules(userId).catch(() => ({} as any));
  if (r?.edits?.amountUsd) return Number(r.edits.amountUsd);
  const risk = await one<any>("SELECT max_order_usd FROM risk_settings WHERE user_id=$1", [userId]).catch(() => null);
  const cap = Number(risk?.max_order_usd ?? 0);
  return cap > 0 ? Math.min(100, cap) : 100;
}

export async function bestEffort(userId: string, text: string): Promise<string> {
  const out: string[] = [];
  const { facts, dates } = await gatherFacts(text, { userId }).catch(() => ({ facts: [] as AssetFacts[], dates: [] }));
  const assets = facts.filter((f) => f.live || f.history?.bars?.length);
  if (assets.length) {
    out.push(assets.slice(0, 12).map(readAsset).join("\n"));
    if (dates.length) { const h = factsAnswer(assets, dates); if (h) out.push(h); }
  }
  if (!assets.length || /\b(bots?|agents?|portfolio|trades?|positions?|orders?|p&l|pnl|profit|loss|balance|money|account|holdings?|doing|status)\b/i.test(text)) {
    const snap = await statusSnapshot(userId).catch(() => null);
    if (snap) out.push(statusAnswer(text, snap));
  }
  const cmds = closestCommands(text);
  out.push(`To act on this, the closest things I can run right now (tap one, or say it your way with these words):\n${cmds.map((c) => `• ${c}`).join("\n")}`);
  return out.filter(Boolean).join("\n\n");
}
