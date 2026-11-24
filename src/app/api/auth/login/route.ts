import { z } from "zod";
import { login } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { headers } from "next/headers";

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const POST = route(async (req) => {
  const b = await parse(req, Body);
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? "local";
  await rateLimit(`login:${ip}`, 20, 900);
  await rateLimit(`login:${b.email.toLowerCase()}`, 8, 900); // brute-force protection per account
  const r = await login(b.email, b.password);
  return ok(r);
});
