import { redirect } from "next/navigation";
import { one } from "@/server/db";

/** Research opens on NVDA (or the largest real asset); search any asset from the top bar. */
export default async function ResearchIndex() {
  const a = await one<{ id: string }>(
    `SELECT id FROM assets WHERE NOT ('demo_data'=ANY(risk_flags)) AND last_price IS NOT NULL ORDER BY (upper(symbol)='NVDA') DESC, market_cap DESC NULLS LAST LIMIT 1`);
  redirect(a ? `/research/${a.id}` : "/discover");
}
