import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, VersionedTransaction, TransactionMessage, PublicKey, SystemProgram } from "@solana/web3.js";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { createMerodWallet, getMerodWallet, updateSettings } from "@/server/wallet/merod-wallet";

test("Merod Wallet: key stored encrypted only, one per user, caps editable", async () => {
  const me = await newUser();
  const w = await createMerodWallet(me);
  assert.doesNotThrow(() => new PublicKey(w.address));
  const k = await one<any>("SELECT * FROM merod_wallet_keys WHERE account_id=$1", [w.id]);
  assert.ok(k.enc_secret && !k.enc_secret.includes(w.address), "secret stored encrypted");
  const acct = await one<any>("SELECT metadata FROM trading_accounts WHERE id=$1", [w.id]);
  assert.ok(!JSON.stringify(acct.metadata).includes(k.enc_secret), "secret never in account metadata");
  await assert.rejects(createMerodWallet(me), /already have/);
  await updateSettings(me, { perTradeUsd: 25, dailyUsd: 50, payWith: "SOL" });
  const after = await getMerodWallet(me);
  assert.equal(after.metadata.limits.perTradeUsd, 25);
  assert.equal(after.metadata.pay_with, "SOL");
});

test("Merod Wallet auto-sign refuses buys above the per-trade cap and signs within it", async () => {
  const me = await newUser();
  const w = await createMerodWallet(me);
  await updateSettings(me, { perTradeUsd: 10, dailyUsd: 100 });
  const asset = (await one<any>("SELECT id FROM assets LIMIT 1"))!;
  const payer = new PublicKey(w.address);
  const msg = new TransactionMessage({ payerKey: payer, recentBlockhash: "11111111111111111111111111111111", instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message();
  const tx64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
  const mk = async (usd: number) => (await one<any>(
    `INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, side, order_type, notional_usd, is_paper, status, unsigned_tx)
     VALUES ($1,$2,$3,'jupiter',gen_random_uuid()::text,'manual','buy','market',$4,false,'pending_approval',$5) RETURNING id`, [me, w.id, asset.id, usd, JSON.stringify({ tx: tx64, network: "solana" })]))!.id;
  const { autoSign } = await import("@/server/wallet/merod-wallet");
  const big = await mk(50);
  await autoSign(big);
  const r = await one<any>("SELECT status, status_reason FROM orders WHERE id=$1", [big]);
  assert.equal(r.status, "rejected"); assert.match(r.status_reason, /per-trade cap/);
  // Within cap: it signs and tries to submit (Jupiter isn't reachable in tests, so it ends failed — but not rejected by caps).
  const small = await mk(5);
  await autoSign(small);
  const s = await one<any>("SELECT status, status_reason FROM orders WHERE id=$1", [small]);
  assert.notEqual(s.status, "rejected");
  await q("DELETE FROM orders WHERE id = ANY($1)", [[big, small]]);
});
