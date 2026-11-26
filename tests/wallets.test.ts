import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one, q } from "@/server/db";
import { extractWallets } from "@/server/copy/wallets";

// Valid-looking base58 Solana addresses (44 chars, no 0/O/I/l).
const A = (i: number) => `${"7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAs".slice(0, 41)}${"abcdefghjk"[i % 10]}${"mnpqrstuvw"[Math.floor(i / 10) % 10]}${"xyzABCDEFG"[Math.floor(i / 100) % 10]}`;

test("wallets: extracts any number of Solana and 0x addresses, skips token mints", async () => {
  const many = Array.from({ length: 120 }, (_, i) => A(i));
  const w = await extractWallets(`mimic ${many.join(", ")} and 0x52908400098527886E0F7030069857D2E4169EE7`);
  assert.equal(w.sol.length, 120); assert.deepEqual(w.evm, ["0x52908400098527886e0f7030069857d2e4169ee7"]);
  const mint = (await one<any>("SELECT identifier FROM assets WHERE venue='solana' AND length(identifier) BETWEEN 32 AND 44 LIMIT 1"))?.identifier;
  if (mint) assert.deepEqual((await extractWallets(`stats ${mint}`)).mints, [mint]);
});

test("prompt box: 'mimic <many addresses>' follows every one (owner), shows in Activity → Mimic; 'stop mimicking' pauses; stats for any number", async () => {
  const u = await newUser();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [u]);
  try {
    const addrs = Array.from({ length: 30 }, (_, i) => A(i + 200));
    const { handlePrompt } = await import("@/server/ai/interpret");
    const r: any = await handlePrompt(u, { text: `mimic these wallets $15 per trade: ${addrs.join("\n")}`, provider: "merod" } as any);
    assert.match(r.message.content, /Now mimicking 30 wallets/, r.message.content);
    assert.match(r.message.content, /\$15 per trade/);
    assert.equal((await one<any>("SELECT count(*)::int AS n FROM copy_follows WHERE follower_id=$1 AND kind='wallet' AND status='active'", [u]))!.n, 30);
    // Shows in the Mimic activity section right away.
    const feed = await q<any>("SELECT count(*)::int AS n FROM copy_follows WHERE follower_id=$1 AND created_at > now() - interval '1 minute'", [u]);
    assert.equal(feed[0].n, 30);

    const s: any = await handlePrompt(u, { text: `give me stats on ${addrs.slice(0, 3).join(" ")} and 0x52908400098527886E0F7030069857D2E4169EE7`, provider: "merod" } as any);
    assert.match(s.message.content, /Wallet stats for 4 addresses/, s.message.content);
    assert.match(s.message.content, /\(mimicking\)/, "marks wallets you already mimic");
    assert.match(s.message.content, /0x 0x52…9ee7: Ethereum\/Base wallets need an Alchemy key/);

    const stop: any = await handlePrompt(u, { text: `stop mimicking ${addrs.slice(0, 10).join(", ")}`, provider: "merod" } as any);
    assert.match(stop.message.content, /Stopped mimicking 10 of 10 wallets/);
    const other = await newUser();
    const no: any = await handlePrompt(other, { text: `mimic ${addrs[0]}`, provider: "merod" } as any);
    assert.match(no.message.content, /only available on the platform owner/);
  } finally { await q("UPDATE users SET role='user' WHERE id=$1", [u]); }
});
