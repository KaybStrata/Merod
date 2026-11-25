import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { one, q } from "@/server/db";

type Ctx = { params: Promise<{ id: string }> };

/**
 * What your bots, auto trading and Modo have been thinking about this asset, newest last, for the chart.
 * Bot observations repeat every tick, so consecutive duplicates are collapsed.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const { id } = await params;
  const hours = Math.min(24 * 30, Math.max(1, Number(new URL(req.url).searchParams.get("hours") ?? 48)));
  const asset = await one<{ symbol: string }>("SELECT symbol FROM assets WHERE id=$1", [id]);
  if (!asset) return ok({ thoughts: [], botIds: [] });
  const bots = await q<{ id: string; name: string }>("SELECT id, name FROM trading_bots WHERE user_id=$1 AND $2 = ANY(asset_ids)", [u.id, id]);
  const logs = bots.length ? await q<any>(
    `SELECT extract(epoch from l.created_at)::bigint AS time, b.name AS who, l.level, l.message AS text FROM bot_activity_logs l JOIN trading_bots b ON b.id=l.bot_id
      WHERE l.bot_id = ANY($1::uuid[]) AND l.created_at > now() - make_interval(hours => $2) ORDER BY l.created_at DESC LIMIT 300`, [bots.map((b) => b.id), hours]) : [];
  const auto = await q<any>(
    `SELECT extract(epoch from created_at)::bigint AS time, CASE WHEN origin='modo' THEN 'Modo' ELSE 'Auto trading' END AS who, 'decision' AS level,
            split_part(explain_before, E'\\n', 1) AS text FROM auto_trades WHERE user_id=$1 AND asset_id=$2 AND created_at > now() - make_interval(hours => $3) ORDER BY created_at DESC LIMIT 50`, [u.id, id, hours]);
  const ideas = await q<any>(
    `SELECT extract(epoch from created_at)::bigint AS time, 'Modo' AS who, 'idea' AS level, upper(side) || ' idea (' || round(confidence*100) || '%): ' || thesis AS text
       FROM modo_ideas WHERE user_id=$1 AND asset_id=$2 AND created_at > now() - make_interval(hours => $3) ORDER BY created_at DESC LIMIT 30`, [u.id, id, hours]);
  const st = await one<{ modo_thoughts: any[] }>("SELECT modo_thoughts FROM auto_trading WHERE user_id=$1", [u.id]);
  const sym = new RegExp(`\\b${asset.symbol.replace(/[^A-Za-z0-9]/g, "")}\\b`, "i");
  const modo = (st?.modo_thoughts ?? []).filter((t: any) => sym.test(t.text)).map((t: any) => ({ time: Math.floor(t.at / 1000), who: "Modo", level: "thought", text: t.text }))
    .filter((t: any) => t.time > Date.now() / 1000 - hours * 3600);
  const all = [...logs, ...auto, ...ideas, ...modo].map((t) => ({ ...t, time: Number(t.time), text: String(t.text).slice(0, 220) })).sort((a, b) => a.time - b.time);
  const out: typeof all = [];
  for (const t of all) { const prev = out[out.length - 1]; if (prev && prev.who === t.who && prev.text === t.text) prev.time = t.time; else out.push(t); }
  return ok({ symbol: asset.symbol, botIds: bots.map((b) => b.id), thoughts: out.slice(-120) });
});
