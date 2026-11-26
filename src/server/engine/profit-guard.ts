import "@/lib/server-only-shim";
import { one } from "../db";

const px = (n: number) => n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 4, minimumFractionDigits: 2 })}` : `$${n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;

/**
 * "Only sell when profitable" (Settings → Risk, or the prompt box): bots and agents hold a sell until the price is at least
 * min_profit_pct above what they paid. Returns null when the sell may go ahead, or a plain-English note when it's held.
 * A sell with no known cost basis is allowed (nothing to compare against).
 */
export async function heldForProfit(userId: string, price: number, cost: number | null | undefined, symbol: string): Promise<string | null> {
  const r = await one<{ on: boolean; min: string }>("SELECT sell_only_in_profit AS on, min_profit_pct AS min FROM risk_settings WHERE user_id=$1", [userId]).catch(() => null);
  if (!r?.on || !cost || !(cost > 0) || !(price > 0)) return null;
  const min = Math.max(0, Number(r.min ?? 0.5));
  const need = cost * (1 + min / 100);
  if (price >= need) return null;
  const g = ((price - cost) / cost) * 100;
  return `${symbol}: sell held, only selling in profit. Bought at ${px(cost)}, now ${px(price)} (${g >= 0 ? "up" : "down"} ${Math.abs(g).toFixed(2)}%); sells once it reaches ${px(need)} (up ${min}%).`;
}
