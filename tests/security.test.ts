import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, closePool } from "./helpers";
import { one, q } from "@/server/db";
import { setCredential, getCredential, setUserCredential, deleteCredential } from "@/server/providers/credentials";
import { testIntegration, getConfig } from "@/server/providers/integrations";
import { verifyAuditChain } from "../scripts/audit-chain";

test("provider secrets are stored encrypted, never plaintext", async () => {
  await setCredential("birdeye", "production", "BIRDEYE_API_KEY", "be-secret-value-0001");
  const row = await one<any>("SELECT ciphertext, last4 FROM provider_secrets WHERE provider_id='birdeye' AND name='BIRDEYE_API_KEY'");
  assert.ok(!row.ciphertext.includes("be-secret"));
  assert.equal(row.last4, "0001");
  assert.equal(await getCredential("birdeye", "production", "BIRDEYE_API_KEY"), "be-secret-value-0001");
  await deleteCredential("birdeye", "production", "BIRDEYE_API_KEY");
});

test("user API keys are encrypted per user and isolated", async () => {
  const a = await newUser(), b = await newUser();
  await setUserCredential(a, "openai", "production", "OPENAI_API_KEY", "sk-user-a-key-9999");
  const row = await one<any>("SELECT ciphertext FROM user_provider_secrets WHERE user_id=$1", [a]);
  assert.ok(!row.ciphertext.includes("sk-user"));
  assert.equal(await getCredential("openai", "production", "OPENAI_API_KEY", a), "sk-user-a-key-9999");
  assert.notEqual(await getCredential("openai", "production", "OPENAI_API_KEY", b), "sk-user-a-key-9999");
});

test("a provider is never marked connected without a passing test", async () => {
  const r = await testIntegration(null, "zerox", "production"); // no key configured
  assert.equal(r.ok, false);
  assert.equal((await getConfig("zerox", "production")).status, "connection_error");
});

test("concurrent audit appends never fork the hash chain", async () => {
  const { audit } = await import("@/server/audit");
  await Promise.all(Array.from({ length: 25 }, (_, i) => audit({ actorType: "system", action: "test.concurrent", data: { i, nested: { b: 2, a: 1 } } })));
  const v = await verifyAuditChain();
  assert.equal(v.ok, true, v.message);
});

test("audit log is append-only and hash-chained", async () => {
  await assert.rejects(q("UPDATE audit_logs SET action='x' WHERE id=(SELECT min(id) FROM audit_logs)"), /append-only/);
  await assert.rejects(q("DELETE FROM audit_logs WHERE id=(SELECT min(id) FROM audit_logs)"), /append-only/);
  const v = await verifyAuditChain();
  assert.equal(v.ok, true, v.message);
});

test("real-money feature flags are off after seeding", async () => {
  const rows = await q<any>("SELECT key, enabled FROM feature_flags WHERE key IN ('live_crypto_trading','live_brokerage_trading','automated_real_money','copy_trading','funding','withdrawals')");
  assert.equal(rows.length, 6);
  for (const r of rows) assert.equal(r.enabled, false, r.key);
  assert.equal((await one<any>("SELECT enabled FROM feature_flags WHERE key='paper_trading'")).enabled, true);
});

test.after(closePool);
