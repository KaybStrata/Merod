import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { listRooms, postMessage, roomMessages } from "@/server/agents/service";

/** Agent rooms. GET ?room=… returns messages; without room lists rooms. POST: user intervention message. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const room = new URL(req.url).searchParams.get("room");
  return ok(room ? { messages: await roomMessages(u.id, room) } : { rooms: await listRooms(u.id) });
});
export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`room:${u.id}`, 30, 60);
  const b = await parse(req, z.object({ room: z.string().max(60), body: z.string().min(1).max(2000), recipients: z.array(z.string().max(60)).max(20).optional() }));
  const fleetId = b.room.startsWith("fleet:") ? b.room.slice(6) : null;
  if (fleetId) {
    const f = await (await import("@/server/db")).one("SELECT 1 FROM agent_fleets WHERE id=$1 AND user_id=$2", [fleetId, u.id]);
    if (!f) return ok({ error: "Room not found" }, { status: 404 });
  }
  return ok({ message: await postMessage(u.id, { room: b.room, fleetId, senderLabel: `@${u.handle} (you)`, recipients: b.recipients, msgType: "instruction", body: b.body }) });
});
