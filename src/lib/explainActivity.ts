/**
 * Plain-language explanation of one Activity message, shown when you hover it: what happened, why, and what you can do.
 * Built only from the message itself (no extra calls), so it's instant.
 */
type Item = { source: string; kind: string; actor: string; title: string; body?: string; side?: "buy" | "sell"; pnl?: number; pnlPct?: number; coin?: { symbol?: string; price?: number; move?: number | null; source?: string } };

const WHO: Record<string, string> = { bot: "One of your bots", agent: "One of your AI bots", auto: "Auto trading", modo: "Modo", order: "An order", copy: "Mimic (copy trading)", auton: "Auton", update: "Learning", merod: "Merod" };
const KIND: Record<string, string> = {
  thought: "a thought — what it noticed while watching the market (nothing was bought or sold)",
  analysis: "an analysis — numbers it checked before deciding",
  decision: "a decision — what it chose to do next",
  execution: "an action — an order was placed, filled or changed",
  warning: "a warning — something stopped or needs your attention",
  state: "a status change — it started, paused or changed settings",
};

/** Known rejection / block reasons → what they mean and what to do. */
const REASONS: [RegExp, string][] = [
  [/view only|discoverable/i, "That coin/stock has no exchange connected for real-money trading. Paper trades now go through anyway (they only need a price) — rejections like this one happened before that fix."],
  [/your (point|skill).*blocks buying|skills\/points say never buy/i, "One of your own skills or points says not to buy this. Turn it off or delete it in Skills (prompt box) or Auton → Skills & points."],
  [/only allows buying|only-trade list/i, "A skill of yours limits buying to certain coins only. Turn that skill off to trade anything."],
  [/need \$[\d.,]+, available|not enough cash|insufficient/i, "There wasn't enough cash in the account for this order. With “Never block” on, paper orders are shrunk to the cash you have instead."],
  [/no position to sell|holding .* selling/i, "It tried to sell more than it holds (or nothing at all), so there was nothing to sell."],
  [/daily (spend|limit|loss)|daily spend cap|budget .* exceeded|max loss/i, "A daily or budget limit was hit. Bot budgets and daily limits are now removed for your account."],
  [/max(imum)? order|vs limit|exceeds automation permissions/i, "The order was bigger than an order-size or automation limit. Those limits are now off for your account."],
  [/liquidity/i, "The coin trades very thinly (little money in its market), which can make prices jump. With “Never block” on this no longer stops bots or prompts."],
  [/risk flags|new_listing|unverified|token_screening/i, "The coin is new, unverified or flagged as risky. With “Never block” on this no longer stops bots or prompts — the warning is just shown."],
  [/slippage/i, "The expected fill price was too far from the market price. With “Never block” on this no longer stops bots or prompts."],
  [/stale price/i, "The last price was too old to trust. With “Never block” on the last known price is used."],
  [/no price available/i, "No price exists for this coin/stock right now, so nothing could be bought or sold. It'll go through once a price arrives."],
  [/emergency stop/i, "Your emergency stop is on (Settings → Risk). It pauses everything until you turn it off."],
  [/approval|confirm/i, "It's waiting for your OK. With “Never block” on, bots and prompts don't wait for approval."],
  [/bots are disabled|prompt trading is disabled|permitted/i, "A permission setting blocked it. Those permissions are now on for your account."],
  [/real.money|live .* (disabled|not activated)|jurisdiction|provider/i, "Real-money trading needs the real-money switch, 2FA and a connected broker/exchange. Paper trading isn't affected."],
  [/simulated fill/i, "“Simulated fill” means paper money: the trade was filled at the live market price, but no real money moved."],
];

const money = (n: number) => `$${Math.abs(n) >= 1 ? Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 }) : Math.abs(n).toPrecision(3)}`;
const num = (s: string) => Number(s.replace(/,/g, ""));

export function explainActivity(i: Item): { headline: string; lines: string[] } {
  const text = `${i.title} ${i.body ?? ""}`;
  const who = WHO[i.source] ?? i.actor ?? "Merod";
  const lines: string[] = [];
  let headline = `${who} posted ${KIND[i.kind] ?? "an update"}.`;

  const bought = i.title.match(/^(Bought|Sold)\s+([\d.,e+]+)\s+(\S+)\s+@\s+\$([\d.,e\-]+)/i);
  const rejected = i.title.match(/^(Buy|Sell)\s+(\S+)\s+\$([\d.,]+):\s*rejected/i);
  if (bought) {
    const qty = num(bought[2]), px = num(bought[4]), total = qty * px;
    headline = `${who} ${bought[1].toLowerCase() === "bought" ? "bought" : "sold"} ${qty.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${bought[3]} at ${money(px)} each — about ${money(total)} in total.`;
    if (i.pnl !== undefined) lines.push(`${i.pnl >= 0 ? "Profit" : "Loss"} on this sale: ${i.pnl >= 0 ? "+" : "−"}${money(i.pnl)}${i.pnlPct !== undefined ? ` (${i.pnlPct >= 0 ? "+" : ""}${i.pnlPct.toFixed(2)}%)` : ""} versus what it paid.`);
  } else if (rejected) {
    headline = `${who} tried to ${rejected[1].toLowerCase()} ${money(num(rejected[3]))} of ${rejected[2]}, but the order was rejected.`;
  } else if (/rejected|blocked|halted|couldn't|failed/i.test(text)) {
    headline = `${who}: something was stopped or failed.`;
  }
  for (const [re, why] of REASONS) if (re.test(text)) { lines.push(why); if (lines.length >= 3) break; }
  if (i.coin?.symbol && i.coin.price) lines.push(`${i.coin.symbol} price at the time: ${money(i.coin.price)}${i.coin.move != null ? ` (${i.coin.move >= 0 ? "+" : ""}${Number(i.coin.move).toFixed(2)}% in 24h)` : ""}${i.coin.source ? ` · from ${i.coin.source}` : ""}.`);
  if (!bought && !rejected && i.body) lines.push(i.body);
  if (/^paper|simulated/i.test(`${i.actor} ${text}`) && !lines.some((l) => l.includes("paper money"))) lines.push("This was paper money (practice): no real money moved.");
  return { headline, lines };
}
