import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { HttpError } from "@/server/errors";
import { buildReview, MAX_S, MIN_S } from "@/server/review/build";
import { PRESETS, ytdSeconds } from "@/lib/timeDial";
import { q, one } from "@/server/db";

/** Review for a window that ends now: ?seconds= (60 … 5y) or ?range=1D|1W|1M|3M|YTD|1Y|ALL, optional &compare=1. */
export const GET = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`review:${u.id}`, 60, 60);
  const sp = new URL(req.url).searchParams;
  let secs: number;
  const range = sp.get("range");
  if (sp.get("seconds")) secs = Math.floor(Number(sp.get("seconds")));
  else if (range === "YTD") secs = ytdSeconds();
  else if (range === "ALL") {
    const born = await one<any>("SELECT extract(epoch from created_at)::bigint AS t FROM users WHERE id=$1", [u.id]);
    secs = Math.min(MAX_S, Math.max(MIN_S, Math.floor(Date.now() / 1000) - Number(born?.t ?? 0)));
  } else secs = (PRESETS as Record<string, number>)[range ?? "1W"] ?? PRESETS["1W"];
  if (!(secs >= MIN_S && secs <= MAX_S)) throw new HttpError(400, "Pick a window between 1 minute and 5 years");
  const review = await buildReview(u.id, { seconds: secs, compare: sp.get("compare") === "1" });
  const schedule = await one<any>("SELECT every_sec, next_at, email FROM review_schedules WHERE user_id=$1", [u.id]);
  return ok({ review, schedule });
});

/** Scheduled reviews: { everySec: null (off) | ≥ 3600, email? }. */
export const PUT = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ everySec: z.number().int().min(3600).max(MAX_S).nullable(), email: z.boolean().optional() }));
  if (b.everySec == null) { await q("DELETE FROM review_schedules WHERE user_id=$1", [u.id]); return ok({ schedule: null }); }
  const row = await one<any>(`INSERT INTO review_schedules (user_id, every_sec, next_at, email) VALUES ($1,$2, now() + make_interval(secs => $2), $3)
                              ON CONFLICT (user_id) DO UPDATE SET every_sec=EXCLUDED.every_sec, next_at=EXCLUDED.next_at, email=EXCLUDED.email, updated_at=now() RETURNING every_sec, next_at, email`,
    [u.id, b.everySec, b.email ?? false]);
  return ok({ schedule: row });
});
