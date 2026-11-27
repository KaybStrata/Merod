import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { getMap, listMaps, palette, createMap } from "@/server/map";

/** GET ?id= → { map, maps, palette } (creates "My map" the first time). */
export const GET = route(async (req) => {
  const u = await requireUser();
  const id = new URL(req.url).searchParams.get("id");
  const map = await getMap(u.id, id);
  const [maps, pal] = await Promise.all([listMaps(u.id), palette(u.id)]);
  return ok({ map, maps, palette: pal });
});

export const POST = route(async (req) => {
  const u = await requireUser();
  const b = await parse(req, z.object({ name: z.string().min(1).max(80) }));
  return ok({ map: await createMap(u.id, b.name) });
});
