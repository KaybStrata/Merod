import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";
import { one } from "@/server/db";

export const dynamic = "force-dynamic";

/** Opens the user's most recently traded asset, else SOL, else the largest asset. */
export default async function TerminalIndex() {
  const u = await getUser();
  const recent = u ? await one<{ asset_id: string }>("SELECT asset_id FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [u.id]) : null;
  const fallback = recent ?? (await one<{ asset_id: string }>("SELECT id AS asset_id FROM assets WHERE symbol='SOL' AND venue='solana' LIMIT 1"))
    ?? (await one<{ asset_id: string }>("SELECT id AS asset_id FROM assets ORDER BY market_cap DESC NULLS LAST LIMIT 1"));
  if (!fallback) redirect("/discover");
  redirect(`/terminal/${fallback.asset_id}`);
}
