import "@/lib/server-only-shim";
import { q, one } from "../db";

/** Break even for the paper book: the starting balance (or the amount of your last reset) plus deposits minus withdrawals since. */
export async function investedPaper(userId: string): Promise<number> {
  const be = await one<any>(
    `WITH acct AS (SELECT id, COALESCE((metadata->>'starting_balance')::numeric, 100000) AS start FROM trading_accounts WHERE user_id=$1 AND kind='paper'),
          lr AS (SELECT DISTINCT ON (account_id) account_id, amount_usd, created_at FROM transactions WHERE user_id=$1 AND kind='reset' ORDER BY account_id, created_at DESC)
     SELECT COALESCE(SUM(COALESCE(lr.amount_usd, a.start)), 0)
            + COALESCE((SELECT SUM(t.amount_usd) FROM transactions t JOIN acct a2 ON a2.id=t.account_id LEFT JOIN lr l2 ON l2.account_id=t.account_id
                         WHERE (t.kind IN ('deposit','withdrawal') OR (t.kind='transfer' AND t.receipt ? 'e_wallet')) AND t.status='confirmed' AND (l2.created_at IS NULL OR t.created_at > l2.created_at)), 0) AS invested
       FROM acct a LEFT JOIN lr ON lr.account_id=a.id`, [userId]);
  return Number(be?.invested ?? 0);
}

/** Paper book value right now (cash + holdings at the latest prices) and its unrealized P&L. */
export async function livePaper(userId: string) {
  const cash = Number((await one<any>("SELECT COALESCE(SUM(cash_balance),0) AS c FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [userId]))?.c ?? 0);
  const h = await q<any>(`SELECT SUM(p.quantity * COALESCE(a.last_price,0)) AS v, SUM(p.quantity * (COALESCE(a.last_price,0) - p.avg_cost)) AS u
                            FROM positions p JOIN trading_accounts t ON t.id=p.account_id JOIN assets a ON a.id=p.asset_id WHERE p.user_id=$1 AND t.kind='paper' AND p.quantity>0`, [userId]);
  return { cash, value: cash + Number(h[0]?.v ?? 0), unrealized: Number(h[0]?.u ?? 0) };
}
