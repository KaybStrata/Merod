import { z } from "zod";
import { requireAdmin } from "@/server/auth";
import { ok, parse, route } from "@/server/http";
import { one, q } from "@/server/db";
import { audit } from "@/server/audit";
import { HttpError } from "@/server/errors";
import { PROVIDERS } from "@/server/providers/catalog";

const Create = z.object({
  name: z.string().min(2).max(60),
  category: z.enum(["crypto_execution", "stock_execution", "market_data", "blockchain_infra", "wallet", "ai"]),
  description: z.string().max(500).default(""),
  docsUrl: z.string().url().max(500).optional().or(z.literal("")),
  baseUrl: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Base URL must use https://"),
  authStyle: z.enum(["header", "bearer", "query", "basic", "none"]),
  authHeader: z.string().max(60).regex(/^[A-Za-z0-9_-]*$/, "Header/param names may only contain letters, numbers, - and _").optional(),
  testPath: z.string().max(300).default("/"),
  testExpect: z.string().max(100).optional(),
});

/** Register any additional REST API without a deploy. Execution still needs a reviewed adapter. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const b = await parse(req, Create);
  const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  if (!slug) throw new HttpError(400, "Name must contain letters or numbers");
  const id = `custom_${slug}`;
  if (PROVIDERS.some((p) => p.id === id) || (await one("SELECT 1 FROM custom_providers WHERE id=$1", [id]))) throw new HttpError(409, "A provider with that name already exists");
  const host = new URL(b.baseUrl).hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith(".internal")) throw new HttpError(400, "Private/internal hosts are not allowed");
  await q(`INSERT INTO custom_providers (id, name, category, description, docs_url, base_url, auth_style, auth_header, test_path, test_expect, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, b.name, b.category, b.description, b.docsUrl || null, b.baseUrl, b.authStyle, b.authHeader || null, b.testPath.startsWith("/") ? b.testPath : `/${b.testPath}`, b.testExpect || null, admin.id]);
  await audit({ actorType: "admin", actorId: admin.id, action: "integration.custom_created", target: id, data: { baseUrl: b.baseUrl, authStyle: b.authStyle } });
  return ok({ id });
});

export const DELETE = route(async (req) => {
  const admin = await requireAdmin();
  const { id } = await parse(req, z.object({ id: z.string().startsWith("custom_") }));
  await q("DELETE FROM provider_secrets WHERE provider_id=$1", [id]);
  await q("DELETE FROM provider_configs WHERE provider_id=$1", [id]);
  await q("DELETE FROM user_provider_secrets WHERE provider_id=$1", [id]);
  await q("DELETE FROM custom_providers WHERE id=$1", [id]);
  await audit({ actorType: "admin", actorId: admin.id, action: "integration.custom_deleted", target: id });
  return ok({ ok: true });
});
