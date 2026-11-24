import { requireUser } from "@/server/auth";
import { rateLimit, route } from "@/server/http";
import { think } from "@/server/modo/engine";

/** Streams Modo's thought process live (Server-Sent Events): one `step` event per step, then `done`. */
export const GET = route(async () => {
  const u = await requireUser();
  await rateLimit(`modo:${u.id}`, 40, 3600);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        const ideas = await think(u.id, async (text, kind = "think") => { send("step", { text, kind, at: Date.now() }); await new Promise((r) => setTimeout(r, 120)); });
        send("done", { ideas: ideas.length });
      } catch (e: any) {
        send("step", { text: `I hit a problem while thinking: ${String(e?.message ?? e).slice(0, 160)}`, kind: "warn", at: Date.now() });
        send("done", { ideas: 0 });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
});

export const maxDuration = 120;
