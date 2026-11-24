/**
 * Idempotent seed: feature flags (real-money OFF, paper ON), strategies, bootstrap asset catalog,
 * simulated chart history (labeled), optional DEMO launch tokens, and an optional admin account.
 * Safe to run on every deploy.
 */
import { pool, q, one } from "@/server/db";
import { ensureFlags } from "@/server/flags";
import { SEED_ASSETS, DEMO_LAUNCHES } from "@/server/market/catalog";
import { backfillSimulatedBars } from "@/server/market/prices";
import { STRATEGIES } from "@/server/bots/strategies";
import { hashPassword } from "@/server/crypto";

const demo = (process.env.MEROD_DEMO_DATA ?? (process.env.MEROD_ENV === "production" ? "false" : "true")) === "true";

await ensureFlags();
// Hard safety: real-money flags are forced OFF by seed unless explicitly allowed by env.
if (process.env.MEROD_ALLOW_LIVE_FLAGS !== "true") {
  await q(`UPDATE feature_flags SET enabled=false WHERE key IN ('live_crypto_trading','live_brokerage_trading','automated_real_money','copy_trading','funding','withdrawals')`);
}
await q("UPDATE feature_flags SET enabled=true WHERE key='paper_trading'");
console.log("✔ feature flags (real-money disabled, paper enabled)");

for (const s of STRATEGIES) {
  await q(`INSERT INTO bot_strategies (id, name, description, category, param_schema) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category, param_schema=EXCLUDED.param_schema`,
    [s.id, s.name, s.description, s.category, JSON.stringify(s.params)]);
}
console.log(`✔ ${STRATEGIES.length} bot strategies`);

let created = 0;
for (const a of SEED_ASSETS) {
  const row = await one<{ id: string; inserted: boolean }>(
    `INSERT INTO assets (asset_class, symbol, name, venue, identifier, decimals, coingecko_id, categories, tradability, last_price, change_24h, market_cap, volume_24h, price_source, price_updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,$12,'simulated',now())
     ON CONFLICT (venue, identifier) DO UPDATE SET name=EXCLUDED.name, categories=EXCLUDED.categories, coingecko_id=EXCLUDED.coingecko_id, decimals=EXCLUDED.decimals
     RETURNING id, (xmax = 0) AS inserted`,
    [a.asset_class, a.symbol, a.name, a.venue, a.identifier, a.decimals ?? null, a.coingecko_id ?? null, a.categories ?? [], a.tradability ?? "paper_tradable",
     a.base, a.market_cap ?? null, a.base * 1e6]);
  const id = row!.id;
  for (const p of a.providers) await q("INSERT INTO asset_providers (asset_id, provider_id, provider_symbol) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [id, p, a.symbol]);
  const scheme = a.asset_class === "crypto" ? (a.identifier === "native" ? "native" : a.venue === "solana" ? "mint" : a.venue === "sui" || a.venue === "aptos" ? "coin_type" : "erc20") : "ticker";
  await q("INSERT INTO asset_identifiers (asset_id, scheme, value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [id, scheme, `${a.venue}:${a.identifier}`]);
  if (a.coingecko_id) await q("INSERT INTO asset_identifiers (asset_id, scheme, value) VALUES ($1,'coingecko',$2) ON CONFLICT DO NOTHING", [id, a.coingecko_id]);
  const bars = await one<{ n: number }>("SELECT count(*)::int AS n FROM price_bars WHERE asset_id=$1", [id]);
  if (!bars?.n) { await backfillSimulatedBars(id, a.base, a.asset_class); created++; }
}
console.log(`✔ ${SEED_ASSETS.length} catalog assets (${created} with new simulated history)`);

if (demo) {
  for (const d of DEMO_LAUNCHES) {
    const r = await one<{ id: string }>(
      `INSERT INTO assets (asset_class, symbol, name, venue, identifier, decimals, categories, risk_flags, tradability, lifecycle, last_price, change_24h, liquidity_usd, volume_24h, market_cap, price_source, price_updated_at, launched_at)
       VALUES ('crypto',$1,$2,'solana-demo',$3,6,'{meme,new}','{demo_data,new_listing,unverified}','paper_tradable',$4,$5,0,$6,$7,$8,'simulated',now(), now() - make_interval(mins => $9))
       ON CONFLICT (venue, identifier) DO UPDATE SET launched_at = now() - make_interval(mins => $9) RETURNING id`,
      [d.symbol, d.name, `demo-${d.symbol.toLowerCase()}`, d.lifecycle, d.base, d.liq, d.liq * 2.2, d.base * 1e9, d.minsAgo]);
    const bars = await one<{ n: number }>("SELECT count(*)::int AS n FROM price_bars WHERE asset_id=$1", [r!.id]);
    if (!bars?.n) await backfillSimulatedBars(r!.id, d.base, "crypto");
  }
  console.log(`✔ ${DEMO_LAUNCHES.length} DEMO launch tokens (paper only, labeled DEMO DATA)`);
} else {
  await q("UPDATE assets SET tradability='restricted' WHERE 'demo_data' = ANY(risk_flags)");
}

if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const exists = await one<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1)", [process.env.ADMIN_EMAIL]);
  if (!exists) {
    if (process.env.ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");
    const u = await one<{ id: string }>("INSERT INTO users (email, password_hash, role) VALUES ($1,$2,'admin') RETURNING id", [process.env.ADMIN_EMAIL, hashPassword(process.env.ADMIN_PASSWORD)]);
    await q("INSERT INTO user_profiles (user_id, handle, display_name) VALUES ($1,'admin','Merod Admin')", [u!.id]);
    await q("INSERT INTO risk_settings (user_id) VALUES ($1)", [u!.id]);
    await q("INSERT INTO trading_permissions (user_id) VALUES ($1)", [u!.id]);
    await q(`INSERT INTO trading_accounts (user_id, kind, provider_id, label, cash_balance, metadata) VALUES ($1,'paper','paper','Paper Trading (Simulated)',100000,'{"starting_balance":100000}')`, [u!.id]);
    await q("INSERT INTO watchlists (user_id, name) VALUES ($1,'My Watchlist')", [u!.id]);
    console.log(`✔ admin account ${process.env.ADMIN_EMAIL} — enable 2FA on first login`);
  } else {
    await q("UPDATE users SET role='admin' WHERE id=$1", [exists.id]);
  }
}
/* ───── Owner handover (opt-in): OWNER_EMAIL names the ONE super-admin account. ─────
   Every other super admin becomes a regular admin, and their copy/mimic bots are paused
   (copy & mimic trading are owner-only). The email lives in the environment, never in code. */
{
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail) {
    const owner = await one<{ id: string; role: string }>("SELECT id, role FROM users WHERE lower(email)=$1", [ownerEmail]);
    if (owner) {
      const demoted = await q<{ id: string }>("UPDATE users SET role='admin', updated_at=now() WHERE role='super_admin' AND id<>$1 RETURNING id", [owner.id]);
      if (owner.role !== "super_admin") await q("UPDATE users SET role='super_admin', status='active', updated_at=now() WHERE id=$1", [owner.id]);
      await q("UPDATE copy_follows SET status='paused' WHERE follower_id<>$1 AND status='active'", [owner.id]).catch(() => {});
      const { audit } = await import("@/server/audit");
      await audit({ actorType: "system", actorId: "owner-handover", userId: owner.id, action: "auth.owner_set", data: { demoted: demoted.length } });
      console.log(`✔ owner account is the only super admin (${demoted.length} other super admin(s) moved to admin)`);
    } else {
      console.log("• OWNER_EMAIL has no account yet: sign up with that email and the super-admin setup code");
    }
  }
}

await pool.end();
console.log("Seed complete");

