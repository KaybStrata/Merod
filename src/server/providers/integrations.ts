import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { publish } from "../realtime";
import { APPROVAL_GATED } from "./catalog";
import { allProviders, findProvider } from "./custom";
import { credentialSource, deleteCredential, getCredential, maskedCredentials, setCredential, setUserCredential, listUserCredentials } from "./credentials";
import { providerFetch } from "./http";
import type { IntegrationStatus, ProviderContext, ProviderEnv } from "./types";

interface ConfigRow {
  provider_id: string; environment: ProviderEnv; status: IntegrationStatus; enabled: boolean; approval_status: string;
  settings: Record<string, string>; last_success_at: string | null; last_tested_at: string | null; last_error: string | null;
  credentials_rotated_at: string | null;
}

export async function getConfig(providerId: string, env: ProviderEnv): Promise<ConfigRow> {
  const row = await one<ConfigRow>("SELECT * FROM provider_configs WHERE provider_id=$1 AND environment=$2", [providerId, env]);
  return row ?? { provider_id: providerId, environment: env, status: "not_configured", enabled: false, approval_status: "not_requested",
    settings: {}, last_success_at: null, last_tested_at: null, last_error: null, credentials_rotated_at: null };
}

async function upsertConfig(providerId: string, env: ProviderEnv, patch: Partial<ConfigRow>) {
  const cur = await getConfig(providerId, env);
  const next = { ...cur, ...patch };
  await q(
    `INSERT INTO provider_configs (provider_id, environment, status, enabled, approval_status, settings, last_success_at, last_tested_at, last_error, credentials_rotated_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (provider_id, environment) DO UPDATE SET status=$3, enabled=$4, approval_status=$5, settings=$6, last_success_at=$7,
       last_tested_at=$8, last_error=$9, credentials_rotated_at=$10, updated_at=now()`,
    [providerId, env, next.status, next.enabled, next.approval_status, JSON.stringify(next.settings ?? {}), next.last_success_at,
     next.last_tested_at, next.last_error, next.credentials_rotated_at]);
  return next;
}

/**
 * Provider context. With `userId`, the user's own pasted keys take precedence (bring-your-own-key);
 * with `userOnly`, ONLY the user's keys are used (never platform keys) — required for personal-account trading.
 */
export function contextFor(providerId: string, env: ProviderEnv, opts: { userId?: string; userOnly?: boolean } = {}): ProviderContext {
  return {
    env,
    cred: async (n) => {
      if (opts.userOnly && opts.userId) {
        const { one } = await import("../db");
        const r = await one<{ ciphertext: string }>("SELECT 1 AS x, ciphertext FROM user_provider_secrets WHERE user_id=$1 AND provider_id=$2 AND environment=$3 AND name=$4", [opts.userId, providerId, env, n]);
        return r ? getCredential(providerId, env, n, opts.userId) : undefined;
      }
      return getCredential(providerId, env, n, opts.userId);
    },
    setting: async (k) => {
      const def = await findProvider(providerId);
      const cfg = await getConfig(providerId, env);
      return cfg.settings?.[k] || def?.settings.find((s) => s.key === k)?.defaults[env] || undefined;
    },
    fetch: (url, init) => providerFetch(providerId, env, url, init),
  };
}

async function requiredCredsPresent(providerId: string, env: ProviderEnv) {
  const def = (await findProvider(providerId))!;
  const results = await Promise.all(def.credentials.filter((c) => c.required).map((c) => credentialSource(providerId, env, c.name)));
  return results.every(Boolean);
}

/** Merged view used by /admin/integrations. Never includes secret values. */
export async function listIntegrations() {
  const out = [];
  for (const def of await allProviders()) {
    const envs = [];
    for (const env of def.environments) {
      const cfg = await getConfig(def.id, env);
      const creds = await Promise.all(def.credentials.map(async (c) => ({
        name: c.name, label: c.label, secret: c.secret, required: c.required, help: c.help,
        source: await credentialSource(def.id, env, c.name),
      })));
      const masked = await maskedCredentials(def.id, env);
      for (const c of creds) (c as any).last4 = masked.find((m) => m.name === c.name)?.last4 ?? null;
      const stats = await one<any>(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS requests_24h,
                count(*) FILTER (WHERE kind='error' AND created_at > now() - interval '24 hours') AS errors_24h,
                count(*) FILTER (WHERE kind='rate_limit' AND created_at > now() - interval '24 hours') AS rate_limited_24h,
                avg(latency_ms) FILTER (WHERE created_at > now() - interval '24 hours') AS avg_latency_ms
           FROM provider_events WHERE provider_id=$1 AND environment=$2`, [def.id, env]);
      const errors = await q("SELECT status_code, message, created_at FROM provider_events WHERE provider_id=$1 AND environment=$2 AND kind IN ('error','rate_limit') ORDER BY id DESC LIMIT 5", [def.id, env]);
      // Status shown is derived honestly: credentials appearing does not mean "connected".
      let status: IntegrationStatus = cfg.status;
      const hasCreds = def.credentials.length === 0 || (await requiredCredsPresent(def.id, env));
      if (status === "not_configured" && hasCreds && def.credentials.some((c) => c.required)) status = "credentials_configured";
      if (!hasCreds && ["sandbox_connected", "production_connected", "awaiting_approval", "credentials_configured"].includes(status)) status = "not_configured";
      if (!cfg.enabled && status !== "not_configured" && cfg.status === "disabled") status = "disabled";
      envs.push({
        environment: env, status, enabled: cfg.enabled, approvalStatus: cfg.approval_status, settings: cfg.settings ?? {},
        settingDefaults: Object.fromEntries(def.settings.map((s) => [s.key, s.defaults[env] ?? ""])),
        lastSuccessAt: cfg.last_success_at, lastTestedAt: cfg.last_tested_at, lastError: cfg.last_error,
        credentialsRotatedAt: cfg.credentials_rotated_at, credentials: creds, stats, errors,
      });
    }
    const { test: _t, ...meta } = def;
    out.push({ ...meta, approvalGated: APPROVAL_GATED.has(def.category), envs });
  }
  return out;
}

export async function saveCredentials(adminId: string, providerId: string, env: ProviderEnv, values: Record<string, string>) {
  const def = await findProvider(providerId);
  if (!def) throw new Error("Unknown provider");
  const allowed = new Set(def.credentials.map((c) => c.name));
  const names: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (!allowed.has(name)) throw new Error(`Unknown credential ${name}`);
    if (!value) continue;
    await setCredential(providerId, env, name, value.trim());
    names.push(name);
  }
  const cfg = await getConfig(providerId, env);
  await upsertConfig(providerId, env, {
    status: (await requiredCredsPresent(providerId, env)) ? "credentials_configured" : "not_configured",
    credentials_rotated_at: cfg.last_success_at ? new Date().toISOString() : cfg.credentials_rotated_at,
    last_error: null,
  });
  await audit({ actorType: "admin", actorId: adminId, action: "integration.credentials_saved", target: `${providerId}:${env}`, data: { names } });
}

export async function removeCredential(adminId: string, providerId: string, env: ProviderEnv, name: string) {
  await deleteCredential(providerId, env, name);
  await upsertConfig(providerId, env, { status: "not_configured", enabled: false });
  await audit({ actorType: "admin", actorId: adminId, action: "integration.credential_removed", target: `${providerId}:${env}`, data: { name } });
}

export async function saveSettings(adminId: string, providerId: string, env: ProviderEnv, settings: Record<string, string>) {
  const def = (await findProvider(providerId))!;
  const allowed = new Set(def.settings.map((s) => s.key));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) if (allowed.has(k) && v) {
    if (!/^(https?|wss?):\/\//.test(v)) throw new Error(`${k} must be an http(s)/ws(s) URL`);
    clean[k] = v;
  }
  await upsertConfig(providerId, env, { settings: clean });
  await audit({ actorType: "admin", actorId: adminId, action: "integration.settings_saved", target: `${providerId}:${env}`, data: clean });
}

/** Run the provider's real probe. Only a passing probe yields a *_connected status. */
export async function testIntegration(actorId: string | null, providerId: string, env: ProviderEnv) {
  const def = await findProvider(providerId);
  if (!def) throw new Error("Unknown provider");
  const cfg = await upsertConfig(providerId, env, { status: "testing" });
  const result = await def.test(contextFor(providerId, env));
  const now = new Date().toISOString();
  let status: IntegrationStatus;
  if (!result.ok) status = "connection_error";
  else if (env === "sandbox") status = "sandbox_connected";
  else if (APPROVAL_GATED.has(def.category) && cfg.approval_status !== "approved") status = cfg.approval_status === "denied" ? "restricted" : "awaiting_approval";
  else status = "production_connected";
  if (!cfg.enabled && cfg.status === "disabled") status = "disabled";
  await upsertConfig(providerId, env, {
    status, last_tested_at: now, last_success_at: result.ok ? now : cfg.last_success_at, last_error: result.ok ? null : result.message,
  });
  await q("INSERT INTO provider_events (provider_id, environment, kind, latency_ms, message) VALUES ($1,$2,'test',$3,$4)",
    [providerId, env, result.latencyMs ?? null, `${result.ok ? "PASS" : "FAIL"}: ${result.message}`.slice(0, 500)]);
  await audit({ actorType: actorId ? "admin" : "system", actorId, action: "integration.test", target: `${providerId}:${env}`, data: { ok: result.ok, message: result.message } });
  await publish("admin", "provider_health", { providerId, env, status, message: result.message });
  return { ...result, status };
}

export async function setEnabled(adminId: string, providerId: string, env: ProviderEnv, enabled: boolean) {
  const cfg = await getConfig(providerId, env);
  let status = cfg.status;
  if (!enabled) status = "disabled";
  else if (cfg.status === "disabled") status = cfg.last_success_at ? (env === "sandbox" ? "sandbox_connected" : "awaiting_approval") : "credentials_configured";
  await upsertConfig(providerId, env, { enabled, status });
  await audit({ actorType: "admin", actorId: adminId, action: enabled ? "integration.enabled" : "integration.disabled", target: `${providerId}:${env}` });
  if (enabled && cfg.status === "disabled" && cfg.last_success_at) await testIntegration(adminId, providerId, env);
}

export async function setApproval(adminId: string, providerId: string, approval: "requested" | "approved" | "denied" | "not_requested", reference?: string) {
  await upsertConfig(providerId, "production", { approval_status: approval });
  await q("INSERT INTO compliance_records (kind, reference, details, created_by) VALUES ('provider_approval',$1,$2,$3)",
    [reference ?? null, JSON.stringify({ providerId, approval }), adminId]);
  await audit({ actorType: "admin", actorId: adminId, action: "integration.approval", target: `${providerId}:production`, data: { approval, reference } });
  const cfg = await getConfig(providerId, "production");
  if (cfg.last_success_at) await testIntegration(adminId, providerId, "production");
}

/** Is a provider usable for live traffic right now? */
export async function providerUsable(providerId: string, env: ProviderEnv) {
  const cfg = await getConfig(providerId, env);
  if (!cfg.enabled) return false;
  return env === "sandbox" ? cfg.status === "sandbox_connected" : cfg.status === "production_connected";
}

/* ───────── Bring-your-own keys (any user) ───────── */
export async function userKeyProviders() {
  const defs = (await allProviders()).filter((d) => d.userKeys && d.credentials.length);
  return defs.map(({ test: _t, ...d }) => d);
}

export async function saveUserKeys(userId: string, providerId: string, env: ProviderEnv, values: Record<string, string>) {
  const def = await findProvider(providerId);
  if (!def?.userKeys) throw new Error("This provider does not accept personal keys");
  const allowed = new Set(def.credentials.map((c) => c.name));
  for (const [name, value] of Object.entries(values)) {
    if (!allowed.has(name)) throw new Error(`Unknown credential ${name}`);
    if (value?.trim()) await setUserCredential(userId, providerId, env, name, value.trim());
  }
  await (await import("../audit")).audit({ actorType: "user", actorId: userId, userId, action: "user_keys.saved", target: `${providerId}:${env}`, data: { names: Object.keys(values) } });
}

/** Test a user's own keys (platform keys are never used for this test). */
export async function testUserKeys(userId: string, providerId: string, env: ProviderEnv) {
  const def = await findProvider(providerId);
  if (!def?.userKeys) throw new Error("This provider does not accept personal keys");
  const result = await def.test(contextFor(providerId, env, { userId, userOnly: true }));
  const { q } = await import("../db");
  await q("UPDATE user_provider_secrets SET status=$4, last_error=$5, tested_at=now() WHERE user_id=$1 AND provider_id=$2 AND environment=$3",
    [userId, providerId, env, result.ok ? "connected" : result.unverified ? "untested" : "error", result.ok ? null : result.message.slice(0, 300)]);
  return result;
}
export { listUserCredentials };
