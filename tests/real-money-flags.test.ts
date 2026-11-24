import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { setFlag } from "@/server/admin/service";
import { ensureFlags } from "@/server/flags";

test("real-money switches: locked without the server unlock, but switching off is always instant", async () => {
  await ensureFlags();
  const admin = await newUser();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [admin]);
  const prev = process.env.MEROD_ALLOW_LIVE_FLAGS;
  delete process.env.MEROD_ALLOW_LIVE_FLAGS;
  try {
    await assert.rejects(setFlag(admin, "live_crypto_trading", true, "REF-1", "000000"), /locked for this deployment/);
    await q("UPDATE feature_flags SET enabled=true WHERE key='live_crypto_trading'");
    await setFlag(admin, "live_crypto_trading", false); // no reference, no 2FA
    assert.equal((await one<any>("SELECT enabled FROM feature_flags WHERE key='live_crypto_trading'"))!.enabled, false);
  } finally {
    if (prev === undefined) delete process.env.MEROD_ALLOW_LIVE_FLAGS; else process.env.MEROD_ALLOW_LIVE_FLAGS = prev;
  }
});
