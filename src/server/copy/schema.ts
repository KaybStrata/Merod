import { z } from "zod";

/** Sizing and safety settings for one copy-trading follow. */
export const CopySettings = z.object({
  accountId: z.string().uuid().nullable().optional(),
  sizing: z.enum(["fixed", "percent"]).default("fixed"),
  fixedUsd: z.number().min(1).max(1_000_000).default(50),
  percent: z.number().min(0.1).max(1000).default(10),
  maxTradeUsd: z.number().min(0).max(1e12).default(0),
  maxDailyUsd: z.number().min(0).max(1e12).default(0),
  copySells: z.boolean().default(true),
  includeExternal: z.boolean().default(true),
  includePaper: z.boolean().default(true),
});

/** For edits: same fields, all optional and WITHOUT defaults, so changing one setting never resets the others. */
export const CopySettingsPatch = z.object({
  accountId: z.string().uuid().nullable().optional(),
  sizing: z.enum(["fixed", "percent"]).optional(),
  fixedUsd: z.number().min(1).max(1_000_000).optional(),
  percent: z.number().min(0.1).max(1000).optional(),
  maxTradeUsd: z.number().min(0).max(1e12).optional(),
  maxDailyUsd: z.number().min(0).max(1e12).optional(),
  copySells: z.boolean().optional(),
  includeExternal: z.boolean().optional(),
  includePaper: z.boolean().optional(),
  status: z.enum(["active", "paused"]).optional(),
});
