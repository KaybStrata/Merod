import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { getMap, listMaps, palette, createMap } from "@/server/map";

/** GET ?id= → { map, maps, palette } (creates "My map" the first time). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams, id = sp.get("id");
  // ?meta=1: just when the map last changed (the open Map polls this to pick up changes made from the prompt box).
  if (sp.get("meta") === "1" && id) {
    const { one } = await import("@/server/db");
    return ok({ updated_at: (await one<any>("SELECT updated_at FROM strategy_maps WHERE id=$1 AND user_id=$2", [id, u.id]))?.updated_at ?? null });
  }
  const map = await getMap(u.id, id);
  const [maps, pal] = await Promise.all([listMaps(u.id), palette(u.id)]);
  return ok({ map, maps, palette: pal });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ name: z.string().min(1).max(80) }));
  return ok({ map: await createMap(u.id, b.name) });
});
