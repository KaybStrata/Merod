import { z } from "zod";

/** The standardised Merod order instruction. Manual UI, AI, shortcuts and bots all produce this. */
export const AssetRefSchema = z.object({
  assetId: z.string().uuid().optional(),
  symbol: z.string().min(1).max(24).optional(),
  venue: z.string().max(32).optional(),
  identifier: z.string().max(120).optional(),
}).refine((a) => a.assetId || a.symbol || a.identifier, "asset requires assetId, symbol or identifier");

export const OrderIntentSchema = z.object({
  asset: AssetRefSchema,
  side: z.enum(["buy", "sell"]),
  orderType: z.enum(["market", "limit", "stop", "stop_limit", "trailing_stop"]).default("market"),
  quantity: z.number().positive().optional(),
  notionalUsd: z.number().positive().max(10_000_000).optional(),
  percentOfPosition: z.number().gt(0).max(100).optional(),
  limitPrice: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  takeProfit: z.number().positive().optional(),
  stopLoss: z.number().positive().optional(),
  trailPercent: z.number().gt(0).max(50).optional(),
  timeInForce: z.enum(["day", "gtc", "ioc"]).default("gtc"),
  maxSlippageBps: z.number().int().min(1).max(5000).optional(),
  spendingLimitUsd: z.number().positive().optional(),
  expiresAt: z.string().datetime().optional(),
  accountId: z.string().uuid().optional(),
  providerId: z.string().max(40).optional(),
}).superRefine((o, ctx) => {
  const sizes = [o.quantity, o.notionalUsd, o.percentOfPosition].filter((v) => v !== undefined).length;
  if (sizes !== 1) ctx.addIssue({ code: "custom", message: "Specify exactly one of quantity, notionalUsd or percentOfPosition" });
  if (o.percentOfPosition !== undefined && o.side !== "sell") ctx.addIssue({ code: "custom", message: "percentOfPosition only applies to sells" });
  if ((o.orderType === "limit" || o.orderType === "stop_limit") && !o.limitPrice) ctx.addIssue({ code: "custom", message: "limitPrice required" });
  if ((o.orderType === "stop" || o.orderType === "stop_limit") && !o.stopPrice) ctx.addIssue({ code: "custom", message: "stopPrice required" });
  if (o.orderType === "trailing_stop" && !o.trailPercent) ctx.addIssue({ code: "custom", message: "trailPercent required" });
});
export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export type OrderSource = "manual" | "prompt" | "shortcut" | "bot" | "conditional" | "system" | "copy" | "auto" | "agent";
export interface EngineContext {
  userId: string;
  source: OrderSource;
  sourceRef?: string;
  idempotencyKey: string;
  actor: { type: "user" | "ai" | "bot" | "shortcut" | "system" | "worker"; id?: string };
  /** True only when a human explicitly approved this exact previewed order in the UI. */
  userConfirmed?: boolean;
  /** Bot-level constraints merged on top of user risk settings. */
  botLimits?: { approvalRequired: boolean; maxSlippageBps: number; minLiquidityUsd: number; maxPositionUsd: number };
  ip?: string;
}

export interface Check { name: string; ok: boolean; message: string; severity?: "block" | "warn" | "approval" }
