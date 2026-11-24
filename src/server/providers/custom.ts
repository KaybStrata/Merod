import "@/lib/server-only-shim";
import { one, q } from "../db";
import { PROVIDERS } from "./catalog";
import { readJson } from "./http";
import type { ProviderDefinition } from "./types";

/**
 * Admin-registered custom REST providers. Lets Merod connect ANY additional API by pasting
 * a base URL + key, without a code deploy. Custom providers are usable for connectivity tests
 * and market-data lookups; execution still requires a reviewed adapter.
 */
export interface CustomProviderRow {
  id: string; name: string; category: ProviderDefinition["category"]; description: string; docs_url: string | null; base_url: string;
  auth_style: "header" | "bearer" | "query" | "basic" | "none"; auth_header: string | null; test_path: string; test_expect: string | null;
}

export function customToDefinition(c: CustomProviderRow): ProviderDefinition {
  const credentials = c.auth_style === "none" ? [] : c.auth_style === "basic"
    ? [{ name: "USERNAME", label: "Username / key ID", secret: true, required: true }, { name: "PASSWORD", label: "Password / secret", secret: true, required: true }]
    : [{ name: "API_KEY", label: c.auth_style === "query" ? `API key (query param “${c.auth_header ?? "apikey"}”)` : c.auth_style === "bearer" ? "Bearer token" : `API key (header “${c.auth_header ?? "x-api-key"}”)`, secret: true, required: true }];
  return {
    id: c.id, name: c.name, category: c.category, phase: 6, description: c.description || "Custom REST integration", custom: true, userKeys: "service",
    docsUrl: c.docs_url ?? c.base_url, signupUrl: c.docs_url ?? c.base_url, authMethod: c.auth_style === "bearer" ? "bearer" : c.auth_style === "basic" ? "basic" : c.auth_style === "none" ? "none" : "api_key",
    credentials, settings: [{ key: "base_url", label: "Base URL", defaults: { sandbox: c.base_url, production: c.base_url } }],
    supportsWebhooks: false, supportsOAuth: false, assetClasses: [], networks: [], capabilities: ["custom"], environments: ["sandbox", "production"],
    commercialRequirements: "Custom integration — review the provider's terms. Execution through custom providers requires a reviewed adapter.",
    troubleshooting: ["Check base URL, auth style and test path"],
    test: async (ctx) => {
      const t = Date.now();
      try {
        const base = (await ctx.setting("base_url")) ?? c.base_url;
        const url = new URL(c.test_path, base.endsWith("/") ? base : base + "/");
        const headers: Record<string, string> = { accept: "application/json" };
        if (c.auth_style === "header") headers[c.auth_header ?? "x-api-key"] = (await ctx.cred("API_KEY"))!;
        if (c.auth_style === "bearer") headers.Authorization = `Bearer ${await ctx.cred("API_KEY")}`;
        if (c.auth_style === "query") url.searchParams.set(c.auth_header ?? "apikey", (await ctx.cred("API_KEY"))!);
        if (c.auth_style === "basic") headers.Authorization = `Basic ${Buffer.from(`${await ctx.cred("USERNAME")}:${await ctx.cred("PASSWORD")}`).toString("base64")}`;
        if (c.auth_style !== "none" && Object.values(headers).some((v) => v.includes("undefined")) ) throw new Error("Missing credentials");
        const j = await readJson(await ctx.fetch(url.toString(), { headers }), c.id);
        if (c.test_expect && (j === null || typeof j !== "object" || !(c.test_expect in j))) throw new Error(`Response missing expected key “${c.test_expect}”`);
        return { ok: true, message: `HTTP 200 from ${url.pathname}`, latencyMs: Date.now() - t };
      } catch (e: any) { return { ok: false, message: e.message, latencyMs: Date.now() - t }; }
    },
  };
}

export async function allProviders(): Promise<ProviderDefinition[]> {
  const rows = await q<CustomProviderRow>("SELECT * FROM custom_providers ORDER BY created_at").catch(() => []);
  return [...PROVIDERS, ...rows.map(customToDefinition)];
}
export async function findProvider(id: string): Promise<ProviderDefinition | undefined> {
  const built = PROVIDERS.find((p) => p.id === id);
  if (built) return built;
  const row = await one<CustomProviderRow>("SELECT * FROM custom_providers WHERE id=$1", [id]).catch(() => null);
  return row ? customToDefinition(row) : undefined;
}
