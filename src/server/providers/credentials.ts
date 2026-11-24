import "@/lib/server-only-shim";
import { one, q } from "../db";
import { decrypt, encrypt } from "../crypto";
import type { ProviderEnv } from "./types";

const aad = (p: string, e: string, n: string) => `provider:${p}:${e}:${n}`;

/**
 * Resolve a credential: encrypted vault (set via /admin/integrations) first, then the hosting
 * provider's environment variables (e.g. Vercel/Railway secrets). Sandbox-specific env vars may be
 * suffixed with _SANDBOX. Values are only ever used server-side.
 */
export async function getCredential(providerId: string, env: ProviderEnv, name: string, userId?: string): Promise<string | undefined> {
  if (userId) {
    const u = await one<{ ciphertext: string }>(
      "SELECT ciphertext FROM user_provider_secrets WHERE user_id=$1 AND provider_id=$2 AND environment=$3 AND name=$4", [userId, providerId, env, name]);
    if (u) return decrypt(u.ciphertext, userAad(userId, providerId, env, name));
  }
  const row = await one<{ ciphertext: string }>(
    "SELECT ciphertext FROM provider_secrets WHERE provider_id=$1 AND environment=$2 AND name=$3", [providerId, env, name]);
  if (row) return decrypt(row.ciphertext, aad(providerId, env, name));
  const fromEnv = env === "sandbox" ? process.env[`${name}_SANDBOX`] ?? process.env[name] : process.env[name];
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

export async function credentialSource(providerId: string, env: ProviderEnv, name: string): Promise<"vault" | "env" | null> {
  const row = await one("SELECT 1 FROM provider_secrets WHERE provider_id=$1 AND environment=$2 AND name=$3", [providerId, env, name]);
  if (row) return "vault";
  const v = env === "sandbox" ? process.env[`${name}_SANDBOX`] ?? process.env[name] : process.env[name];
  return v ? "env" : null;
}

export async function setCredential(providerId: string, env: ProviderEnv, name: string, value: string) {
  const last4 = value.length > 8 ? value.slice(-4) : null;
  await q(
    `INSERT INTO provider_secrets (provider_id, environment, name, ciphertext, last4) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider_id, environment, name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, last4=EXCLUDED.last4,
       key_version=provider_secrets.key_version+1, created_at=now()`,
    [providerId, env, name, encrypt(value, aad(providerId, env, name)), last4]);
}
export async function deleteCredential(providerId: string, env: ProviderEnv, name: string) {
  await q("DELETE FROM provider_secrets WHERE provider_id=$1 AND environment=$2 AND name=$3", [providerId, env, name]);
}
export async function maskedCredentials(providerId: string, env: ProviderEnv) {
  return q<{ name: string; last4: string | null; created_at: string; key_version: number }>(
    "SELECT name, last4, created_at, key_version FROM provider_secrets WHERE provider_id=$1 AND environment=$2", [providerId, env]);
}

/* ───────── User-supplied keys (bring your own key) ───────── */
const userAad = (u: string, p: string, e: string, n: string) => `user:${u}:provider:${p}:${e}:${n}`;
export async function setUserCredential(userId: string, providerId: string, env: ProviderEnv, name: string, value: string) {
  await q(
    `INSERT INTO user_provider_secrets (user_id, provider_id, environment, name, ciphertext, last4) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, provider_id, environment, name) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, last4=EXCLUDED.last4, status='untested', last_error=NULL, created_at=now()`,
    [userId, providerId, env, name, encrypt(value, userAad(userId, providerId, env, name)), value.length > 8 ? value.slice(-4) : null]);
}
export async function deleteUserCredentials(userId: string, providerId: string, env: ProviderEnv) {
  await q("DELETE FROM user_provider_secrets WHERE user_id=$1 AND provider_id=$2 AND environment=$3", [userId, providerId, env]);
}
export async function listUserCredentials(userId: string) {
  return q<{ provider_id: string; environment: string; name: string; last4: string | null; status: string; last_error: string | null; tested_at: string | null }>(
    "SELECT provider_id, environment, name, last4, status, last_error, tested_at FROM user_provider_secrets WHERE user_id=$1 ORDER BY provider_id", [userId]);
}
export async function userHasCredentials(userId: string, providerId: string, env: ProviderEnv) {
  return !!(await one("SELECT 1 FROM user_provider_secrets WHERE user_id=$1 AND provider_id=$2 AND environment=$3 LIMIT 1", [userId, providerId, env]));
}
