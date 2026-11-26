import { redirect } from "next/navigation";
import { one } from "@/server/db";

/** Trade: open the trading terminal on the most liquid real asset (BTC when available). */
export default async function TradePage() {
  const a = await one<{ id: string }>(
    `SELECT id FROM assets WHERE NOT ('demo_data'=ANY(risk_flags)) AND last_price IS NOT NULL ORDER BY (upper(symbol)='BTC') DESC, volume_24h DESC NULLS LAST LIMIT 1`);
  redirect(a ? `/terminal/${a.id}` : "/discover");
}
