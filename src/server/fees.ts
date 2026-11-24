import "@/lib/server-only-shim";
import { one, q } from "./db";
import { audit } from "./audit";
import { HttpError } from "./errors";
import { publish } from "./realtime";

/**
 * Platform fee configuration (super admin only).
 *  performance: pct of REALIZED PROFIT on closing (sell) fills — nothing charged on losses or on buys.
 *  commission:  pct of the notional value of every fill.
 * Default: 7% performance fee. Paper accounts are charged in virtual dollars (labeled simulated).
 */
export type FeeMode = "performance" | "commission";
export interface FeeConfig { mode: FeeMode; pct: number }
export const DEFAULT_FEES: FeeConfig = { mode: "performance", pct: 7 };
export const MAX_FEE_PCT = 50;

let cache: { at: number; v: FeeConfig } | null = null;
export async function getFeeConfig(): Promise<FeeConfig> {
  if (cache && Date.now() - cache.at < 5000) return cache.v;
  const r = await one<{ value: FeeConfig }>("SELECT value FROM platform_settings WHERE key='fees'").catch(() => null);
  const v = r?.value && (r.value.mode === "performance" || r.value.mode === "commission") && Number.isFinite(Number(r.value.pct)) ? { mode: r.value.mode, pct: Number(r.value.pct) } : DEFAULT_FEES;
  cache = { at: Date.now(), v };
  return v;
}

/** Fee owed on one fill. realizedGross is the profit before this fee (sells only). */
export function computeFee(cfg: FeeConfig, f: { side: "buy" | "sell"; notional: number; realizedGross: number }) {
  if (cfg.pct <= 0) return 0;
  const raw = cfg.mode === "performance" ? (f.side === "sell" && f.realizedGross > 0 ? f.realizedGross * cfg.pct / 100 : 0) : f.notional * cfg.pct / 100;
  return Math.round(raw * 100) / 100;
}

export function describeFee(cfg: FeeConfig) {
  return cfg.mode === "performance" ? `Merod performance fee: ${cfg.pct}% of realized profit on closing trades (no fee on losses)` : `Merod commission: ${cfg.pct}% of trade value`;
}

export async function setFeeConfig(superAdminId: string, next: FeeConfig, reason: string) {
  if (!["performance", "commission"].includes(next.mode)) throw new HttpError(400, "Invalid fee mode");
  if (!(next.pct >= 0 && next.pct <= MAX_FEE_PCT)) throw new HttpError(400, `Fee must be between 0% and ${MAX_FEE_PCT}%`);
  const before = await getFeeConfig();
  const value = { mode: next.mode, pct: Math.round(next.pct * 100) / 100 };
  await q(`INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('fees',$1,$2,now())
           ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=now()`, [JSON.stringify(value), superAdminId]);
  cache = null;
  await q("INSERT INTO compliance_records (kind, reference, details, created_by) VALUES ('fee_change',$1,$2,$3)", [reason, JSON.stringify({ before, after: value }), superAdminId]);
  await audit({ actorType: "admin", actorId: superAdminId, action: "fees.updated", target: "platform_settings:fees", data: { before, after: value, reason } });
  await publish("admin", "fees", value);
  return value;
}

export async function feeStats() {
  return one<any>(`SELECT COALESCE(SUM(platform_fee_usd) FILTER (WHERE is_paper),0) AS paper_total,
                          COALESCE(SUM(platform_fee_usd) FILTER (WHERE NOT is_paper),0) AS live_total,
                          COALESCE(SUM(platform_fee_usd) FILTER (WHERE created_at > now() - interval '30 days'),0) AS last_30d,
                          count(*) FILTER (WHERE platform_fee_usd > 0)::int AS charged_orders
                     FROM orders`);
}
