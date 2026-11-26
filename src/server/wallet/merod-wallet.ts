import "@/lib/server-only-shim";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { decrypt, encrypt } from "../crypto";
import { getCredential } from "../providers/credentials";
import { verifyStepUp } from "../auth";
import { getFlags } from "../flags";

/**
 * MEROD WALLET — the owner's own Solana wallet inside Merod.
 * Merod generates the keypair and stores the secret encrypted (AES-GCM with MEROD_MASTER_KEY, bound to the account),
 * so real Jupiter swaps from this wallet are signed automatically, including by bots when "automated real money" is on.
 * Safety: owner only; per-trade and daily USD caps checked before signing; withdrawals need 2FA; the secret is never
 * returned by any API or written to logs. It's a hot wallet: fund it only with what you're willing to risk.
 */
const SOL_MINT = "So11111111111111111111111111111111111111112";
const aad = (accountId: string) => `merod-wallet:${accountId}`;

export async function rpc() {
  const helius = await getCredential("helius", "production", "HELIUS_API_KEY").catch(() => undefined);
  return new Connection(helius ? `https://mainnet.helius-rpc.com/?api-key=${helius}` : "https://api.mainnet-beta.solana.com", "confirmed");
}

/** One Merod Wallet by id, or the user's oldest when no id is given. */
export async function getMerodWallet(userId: string, accountId?: string | null) {
  return one<any>(`SELECT t.*, k.public_key FROM trading_accounts t JOIN merod_wallet_keys k ON k.account_id=t.id
                    WHERE t.user_id=$1 AND t.status='active' AND ($2::uuid IS NULL OR t.id=$2) ORDER BY t.created_at LIMIT 1`, [userId, accountId ?? null]);
}
export async function listMerodWallets(userId: string) {
  return q<any>(`SELECT t.*, k.public_key FROM trading_accounts t JOIN merod_wallet_keys k ON k.account_id=t.id WHERE t.user_id=$1 AND t.status='active' ORDER BY t.created_at`, [userId]);
}

/** Create a new Merod Wallet. No limit on how many: each gets its own keypair, name, caps and balances. */
export async function createMerodWallet(userId: string, name?: string) {
  const kp = Keypair.generate();
  const pub = kp.publicKey.toBase58();
  const n = Number((await one<any>("SELECT count(*)::int AS n FROM trading_accounts WHERE user_id=$1 AND provider_id='merod_wallet'", [userId]))?.n ?? 0);
  const label = (name?.trim() || (n ? `Merod Wallet ${n + 1}` : "Merod Wallet")).slice(0, 60);
  const acct = await one<any>(
    `INSERT INTO trading_accounts (user_id, kind, provider_id, label, external_ref, network, status, metadata)
     VALUES ($1,'wallet','merod_wallet',$4,$2,'solana','active',$3) RETURNING id`,
    [userId, pub, JSON.stringify({ environment: "production", merod_wallet: true, limits: { perTradeUsd: 100, dailyUsd: 500 }, pay_with: "USDC" }), label]);
  await q("INSERT INTO merod_wallet_keys (account_id, user_id, public_key, enc_secret) VALUES ($1,$2,$3,$4)",
    [acct.id, userId, pub, encrypt(Buffer.from(kp.secretKey).toString("base64"), aad(acct.id))]);
  await audit({ actorType: "user", actorId: userId, userId, action: "merod_wallet.created", target: acct.id, data: { publicKey: pub } });
  return { id: acct.id, address: pub };
}

async function keypairFor(accountId: string) {
  const k = await one<any>("SELECT enc_secret FROM merod_wallet_keys WHERE account_id=$1", [accountId]);
  if (!k) throw new HttpError(404, "Merod Wallet key not found");
  return Keypair.fromSecretKey(Buffer.from(decrypt(k.enc_secret, aad(accountId)), "base64"));
}

/** SOL + SPL token balances, valued with Merod's live prices where known. */
export async function balances(address: string) {
  const conn = await rpc();
  const owner = new PublicKey(address);
  const [lamports, tokens] = await Promise.all([
    conn.getBalance(owner),
    conn.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }).catch(() => ({ value: [] as any[] })),
  ]);
  const sol = lamports / LAMPORTS_PER_SOL;
  const rows = tokens.value.map((t: any) => ({ mint: t.account.data.parsed.info.mint as string, amount: Number(t.account.data.parsed.info.tokenAmount.uiAmount ?? 0) })).filter((t) => t.amount > 0);
  const mints = [SOL_MINT, ...rows.map((r) => r.mint)];
  const known = await q<any>("SELECT id, symbol, name, identifier, last_price, logo_url FROM assets WHERE venue='solana' AND (identifier = ANY($1) OR (identifier='native' AND upper(symbol)='SOL'))", [mints]);
  const solAsset = known.find((a) => a.identifier === "native" || a.identifier === SOL_MINT) ?? (await one<any>("SELECT id, symbol, last_price FROM assets WHERE upper(symbol)='SOL' AND asset_class='crypto' ORDER BY market_cap DESC NULLS LAST LIMIT 1"));
  const out = [{ symbol: "SOL", name: "Solana", mint: SOL_MINT, assetId: solAsset?.id ?? null, amount: sol, price: solAsset?.last_price != null ? Number(solAsset.last_price) : null }];
  for (const r of rows) {
    const a = known.find((k) => k.identifier === r.mint);
    const usdc = r.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    out.push({ symbol: a?.symbol ?? (usdc ? "USDC" : `${r.mint.slice(0, 4)}…`), name: a?.name ?? (usdc ? "USD Coin" : "Unknown token"), mint: r.mint, assetId: a?.id ?? null, amount: r.amount, price: usdc ? 1 : a?.last_price != null ? Number(a.last_price) : null });
  }
  const valued = out.map((b) => ({ ...b, usd: b.price != null ? b.price * b.amount : null }));
  return { sol, tokens: valued, totalUsd: valued.reduce((s, b) => s + (b.usd ?? 0), 0) };
}

async function oneStatus(w: any) {
  let bal: any = null, error: string | null = null;
  try { bal = await balances(w.external_ref); } catch (e: any) { error = `Couldn't read balances: ${String(e.message).slice(0, 120)}`; }
  const spent = await one<any>("SELECT COALESCE(SUM(notional_usd),0) AS s FROM orders WHERE account_id=$1 AND side='buy' AND status IN ('filled','submitted','partially_filled') AND created_at > date_trunc('day', now())", [w.id]);
  return { id: w.id, name: w.label, address: w.external_ref, limits: w.metadata?.limits ?? { perTradeUsd: 100, dailyUsd: 500 }, payWith: w.metadata?.pay_with ?? "USDC", spentTodayUsd: Number(spent?.s ?? 0), balances: bal, error, createdAt: w.created_at };
}
export async function walletStatus(userId: string) {
  const list = await listMerodWallets(userId);
  const flags = await getFlags();
  const wallets = await Promise.all(list.map(oneStatus));
  return { exists: wallets.length > 0, wallets, totalUsd: wallets.reduce((s, w) => s + (w.balances?.totalUsd ?? 0), 0), liveCrypto: !!flags.live_crypto_trading, automated: !!flags.automated_real_money };
}

export async function updateSettings(userId: string, accountId: string, s: { perTradeUsd?: number; dailyUsd?: number; payWith?: "USDC" | "SOL"; name?: string }) {
  const w = await getMerodWallet(userId, accountId);
  if (!w) throw new HttpError(404, "Merod Wallet not found");
  const limits = { ...(w.metadata?.limits ?? {}), ...(s.perTradeUsd ? { perTradeUsd: s.perTradeUsd } : {}), ...(s.dailyUsd ? { dailyUsd: s.dailyUsd } : {}) };
  await q("UPDATE trading_accounts SET metadata = metadata || $2::jsonb, label=COALESCE($3, label) WHERE id=$1", [w.id, JSON.stringify({ limits, ...(s.payWith ? { pay_with: s.payWith } : {}) }), s.name?.trim()?.slice(0, 60) || null]);
  await audit({ actorType: "user", actorId: userId, userId, action: "merod_wallet.settings", target: w.id, data: { limits, payWith: s.payWith, name: s.name } });
  return walletStatus(userId);
}

/** Called by the engine when a Jupiter order from the Merod Wallet is waiting for a signature. Checks caps, signs, submits. */
export async function autoSign(orderId: string) {
  const o = await one<any>("SELECT o.*, t.metadata AS acct_meta, t.user_id AS owner FROM orders o JOIN trading_accounts t ON t.id=o.account_id WHERE o.id=$1", [orderId]);
  if (!o?.unsigned_tx?.tx) return;
  const { submitSigned } = await import("../engine/engine");
  const limits = o.acct_meta?.limits ?? { perTradeUsd: 100, dailyUsd: 500 };
  const usd = Number(o.notional_usd ?? o.quote?.notionalUsd ?? 0);
  if (o.side === "buy") {
    if (usd > Number(limits.perTradeUsd)) return reject(o, `Above your Merod Wallet per-trade cap ($${limits.perTradeUsd})`);
    const spent = await one<any>("SELECT COALESCE(SUM(notional_usd),0) AS s FROM orders WHERE account_id=$1 AND side='buy' AND id<>$2 AND status IN ('filled','submitted','partially_filled') AND created_at > date_trunc('day', now())", [o.account_id, o.id]);
    if (Number(spent?.s ?? 0) + usd > Number(limits.dailyUsd)) return reject(o, `Would exceed your Merod Wallet daily cap ($${limits.dailyUsd})`);
  }
  const kp = await keypairFor(o.account_id);
  const tx = VersionedTransaction.deserialize(Buffer.from(o.unsigned_tx.tx, "base64"));
  if (!tx.message.staticAccountKeys.some((k) => k.equals(kp.publicKey))) return reject(o, "Transaction isn't for this wallet");
  tx.sign([kp]);
  try { await submitSigned(orderId, o.owner, { signedTransaction: Buffer.from(tx.serialize()).toString("base64") }); }
  catch (e: any) { await q("UPDATE orders SET status='failed', status_reason=$2, updated_at=now() WHERE id=$1", [orderId, `Swap failed: ${String(e.message).slice(0, 300)}`]); }
}
async function reject(o: any, reason: string) {
  await q("UPDATE orders SET status='rejected', status_reason=$2, updated_at=now() WHERE id=$1", [o.id, reason]);
  await audit({ actorType: "system", userId: o.user_id, action: "order.rejected", target: o.id, data: { reason } });
}

/** Send SOL out of the Merod Wallet (2FA required). Keeps 0.002 SOL for fees/rent. */
export async function withdrawSol(userId: string, accountId: string, to: string, amountSol: number, code: string) {
  if (!(await verifyStepUp(userId, code))) throw new HttpError(403, "Invalid 2FA code (turn on 2FA in Settings → Security first)");
  const w = await getMerodWallet(userId, accountId);
  if (!w) throw new HttpError(404, "Merod Wallet not found");
  let dest: PublicKey;
  try { dest = new PublicKey(to); } catch { throw new HttpError(400, "That isn't a valid Solana address"); }
  const conn = await rpc();
  const kp = await keypairFor(w.id);
  const bal = (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
  if (amountSol <= 0 || amountSol > bal - 0.002) throw new HttpError(400, `You can send up to ${Math.max(0, bal - 0.002).toFixed(4)} SOL`);
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: dest, lamports: Math.floor(amountSol * LAMPORTS_PER_SOL) }));
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await audit({ actorType: "user", actorId: userId, userId, action: "merod_wallet.withdraw", target: w.id, data: { to, amountSol, signature: sig } });
  return { signature: sig };
}
