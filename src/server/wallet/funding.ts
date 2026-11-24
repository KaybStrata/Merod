import "@/lib/server-only-shim";
import QRCode from "qrcode";
import { one, q, tx } from "../db";
import { audit } from "../audit";
import { verifyStepUp } from "../auth";
import { HttpError } from "../errors";
import { getFlags } from "../flags";
import { publish } from "../realtime";
import { notify } from "../engine/engine";
import { contextFor, providerUsable } from "../providers/integrations";
import { readJson } from "../providers/http";
import { ADDRESS_RULES } from "./service";

/**
 * Funding: deposits, withdrawals and third-party crypto transfers.
 *  • Paper accounts: virtual cash deposit/withdraw (labeled simulated) — always available.
 *  • Crypto (non-custodial): deposits go straight to the user's own wallet address; transfers out are
 *    prepared as UNSIGNED transactions that the user's wallet signs. Merod never holds keys.
 *    Safeguards: address book with a 24h cooling period, 2FA step-up, daily USD limit, network/asset checks.
 *  • Stock funding: ACH deposits/withdrawals through the Alpaca Broker API transfer endpoints.
 *  Real-money paths require the `funding` / `withdrawals` feature flags (OFF until compliance approval).
 */

export const COOLING_HOURS = 24;
const PAPER_MAX_BALANCE = 10_000_000;

const EVM_CHAIN: Record<string, number> = { ethereum: 1, base: 8453, polygon: 137, arbitrum: 42161, avalanche: 43114, bsc: 56 };

/* ───────────── Overview ───────────── */
export async function fundingOverview(userId: string) {
  const [flags, accounts, addresses, banks, requests, risk, used] = await Promise.all([
    getFlags(),
    q<any>("SELECT id, kind, provider_id, label, network, external_ref, cash_balance, metadata, status FROM trading_accounts WHERE user_id=$1 AND status <> 'disconnected' ORDER BY kind, created_at", [userId]),
    q<any>("SELECT id, label, network, address, usable_after, last_used_at, created_at FROM withdrawal_addresses WHERE user_id=$1 ORDER BY created_at DESC", [userId]),
    q<any>("SELECT id, account_id, provider_id, nickname, mask, status, created_at FROM bank_links WHERE user_id=$1 AND status <> 'removed'", [userId]),
    q<any>(`SELECT f.*, a.symbol, t.label AS account_label, w.label AS address_label, w.address FROM funding_requests f
              LEFT JOIN assets a ON a.id=f.asset_id JOIN trading_accounts t ON t.id=f.account_id LEFT JOIN withdrawal_addresses w ON w.id=f.address_id
             WHERE f.user_id=$1 ORDER BY f.created_at DESC LIMIT 50`, [userId]),
    one<any>("SELECT max_daily_withdrawal_usd FROM risk_settings WHERE user_id=$1", [userId]),
    one<any>(`SELECT COALESCE(SUM(amount_usd),0) AS used FROM funding_requests WHERE user_id=$1 AND direction='withdrawal' AND rail <> 'paper'
               AND status NOT IN ('failed','cancelled','blocked') AND created_at > now() - interval '24 hours'`, [userId]),
  ]);
  const brokerReady = await providerUsable("alpaca_broker", "production") || await providerUsable("alpaca_broker", "sandbox");
  return {
    flags: { funding: flags.funding, withdrawals: flags.withdrawals },
    accounts, addresses: addresses.map((a) => ({ ...a, usable: new Date(a.usable_after) <= new Date() })), banks, requests,
    limits: { maxDailyWithdrawalUsd: Number(risk?.max_daily_withdrawal_usd ?? 10000), usedLast24hUsd: Number(used?.used ?? 0), coolingHours: COOLING_HOURS },
    rails: {
      paper: { available: true, note: "Virtual funds for paper trading (simulated)." },
      crypto: { available: flags.withdrawals, note: flags.withdrawals ? "Transfers are signed by your own wallet." : "Crypto withdrawals are disabled until compliance approval." },
      ach: { available: flags.funding && brokerReady, note: !flags.funding ? "Bank funding is disabled until compliance approval." : !brokerReady ? "Requires the Alpaca Broker API integration to be connected." : "ACH via Alpaca Broker API." },
    },
    networks: Object.entries(ADDRESS_RULES).map(([id, r]) => ({ id, label: r.label })),
  };
}

/* ───────────── Paper (simulated) ───────────── */
export async function paperCash(userId: string, accountId: string, direction: "deposit" | "withdrawal", amount: number, idem: string) {
  if (!(await getFlags()).paper_trading) throw new HttpError(403, "Paper trading is disabled");
  if (!(amount > 0) || amount > 1_000_000) throw new HttpError(400, "Amount must be between $0 and $1,000,000");
  return tx(async (c) => {
    const dup = await one<any>("SELECT * FROM funding_requests WHERE user_id=$1 AND idempotency_key=$2", [userId, idem], c);
    if (dup) return dup;
    const acct = await one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2 FOR UPDATE", [accountId, userId], c);
    if (!acct || acct.kind !== "paper") throw new HttpError(400, "Choose a paper trading account");
    const bal = Number(acct.cash_balance);
    if (direction === "withdrawal" && amount > bal) throw new HttpError(400, `Insufficient paper cash ($${bal.toFixed(2)} available)`);
    if (direction === "deposit" && bal + amount > PAPER_MAX_BALANCE) throw new HttpError(400, "Paper balance cap is $10,000,000");
    const delta = direction === "deposit" ? amount : -amount;
    await c.query("UPDATE trading_accounts SET cash_balance=cash_balance+$2 WHERE id=$1", [accountId, delta]);
    const req = await one<any>(
      `INSERT INTO funding_requests (user_id, account_id, direction, rail, amount, amount_usd, status, status_reason, idempotency_key)
       VALUES ($1,$2,$3,'paper',$4,$4,'completed','Simulated (paper trading)',$5) RETURNING *`, [userId, accountId, direction, amount, idem], c);
    await c.query(`INSERT INTO transactions (user_id, account_id, kind, amount, amount_usd, status, reference, receipt) VALUES ($1,$2,$3,$4,$4,'confirmed',$5,$6)`,
      [userId, accountId, direction, delta, req.id, JSON.stringify({ simulated: true, rail: "paper", note: "Virtual funds — no real money moved" })]);
    await audit({ actorType: "user", actorId: userId, userId, action: `funding.paper_${direction}`, target: req.id, data: { amount } }, c);
    return req;
  });
}

/* ───────────── Address book (third-party wallets) ───────────── */
export async function addAddress(userId: string, a: { label: string; network: string; address: string; code?: string }) {
  const rule = ADDRESS_RULES[a.network];
  if (!rule) throw new HttpError(400, "Unsupported network");
  if (!rule.re.test(a.address)) throw new HttpError(400, `That is not a valid ${rule.label} address`);
  if (!(await verifyStepUp(userId, a.code))) throw new HttpError(401, "A valid 2FA code is required to add a withdrawal address (enable 2FA in Settings → Security)");
  const r = await one<any>(
    `INSERT INTO withdrawal_addresses (user_id, label, network, address, usable_after) VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5))
     ON CONFLICT (user_id, network, address) DO NOTHING RETURNING *`, [userId, a.label.slice(0, 60), a.network, a.address, COOLING_HOURS]);
  if (!r) throw new HttpError(409, "That address is already in your address book");
  await audit({ actorType: "user", actorId: userId, userId, action: "funding.address_added", target: r.id, data: { network: a.network, address: a.address } });
  await notify(userId, "system", "New withdrawal address added", `${rule.label} ${a.address.slice(0, 6)}…${a.address.slice(-4)} — usable after a ${COOLING_HOURS}h security hold. If this wasn't you, remove it and change your password.`, "/wallet");
  return r;
}
export async function removeAddress(userId: string, id: string) {
  const r = await one("DELETE FROM withdrawal_addresses WHERE id=$1 AND user_id=$2 AND NOT EXISTS (SELECT 1 FROM funding_requests WHERE address_id=$1 AND status IN ('pending_signature','submitted')) RETURNING id", [id, userId]);
  if (!r) throw new HttpError(409, "Address not found or used by a pending transfer");
  await audit({ actorType: "user", actorId: userId, userId, action: "funding.address_removed", target: id });
}

/* ───────────── Crypto deposit info ───────────── */
export async function depositInfo(userId: string, accountId: string) {
  const acct = await one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [accountId, userId]);
  if (!acct) throw new HttpError(404, "Account not found");
  if (acct.kind !== "wallet" || !acct.external_ref) throw new HttpError(400, "Choose a connected crypto wallet to receive a deposit");
  const assets = await q<any>("SELECT id, symbol, name, identifier FROM assets WHERE venue=$1 AND asset_class='crypto' AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 20", [acct.network]);
  return {
    network: acct.network, networkLabel: ADDRESS_RULES[acct.network]?.label ?? acct.network, address: acct.external_ref,
    qr: await QRCode.toDataURL(acct.external_ref, { margin: 1, width: 220 }), assets,
    warning: `Only send ${ADDRESS_RULES[acct.network]?.label ?? acct.network} network assets to this address. Assets sent on another network may be lost permanently.`,
    custody: "This is your own wallet address. Funds arrive directly in your wallet — Merod never takes custody.",
  };
}

/* ───────────── Crypto transfer to a third-party wallet ───────────── */
function erc20TransferData(to: string, amountBase: bigint) {
  return "0xa9059cbb" + to.toLowerCase().replace(/^0x/, "").padStart(64, "0") + amountBase.toString(16).padStart(64, "0");
}
function toBaseUnits(amount: number, decimals: number): bigint {
  const [i, f = ""] = amount.toFixed(Math.min(decimals, 18)).split(".");
  return BigInt(i + f.padEnd(decimals, "0").slice(0, decimals));
}

export async function createCryptoTransfer(userId: string, r: { accountId: string; assetId: string; amount: number; addressId: string; code?: string; idempotencyKey: string }) {
  const existing = await one<any>("SELECT * FROM funding_requests WHERE user_id=$1 AND idempotency_key=$2", [userId, r.idempotencyKey]);
  if (existing) return existing;
  // 2FA step-up first, always — even while withdrawals are disabled.
  if (!(await verifyStepUp(userId, r.code))) {
    await audit({ actorType: "user", actorId: userId, userId, action: "funding.transfer_stepup_failed" });
    throw new HttpError(401, "A valid 2FA code is required for every transfer (enable 2FA in Settings → Security)");
  }
  const [acct, asset, addr, risk] = await Promise.all([
    one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [r.accountId, userId]),
    one<any>("SELECT * FROM assets WHERE id=$1", [r.assetId]),
    one<any>("SELECT * FROM withdrawal_addresses WHERE id=$1 AND user_id=$2", [r.addressId, userId]),
    one<any>("SELECT max_daily_withdrawal_usd FROM risk_settings WHERE user_id=$1", [userId]),
  ]);
  if (!acct || !asset || !addr) throw new HttpError(404, "Account, asset or address not found");
  if (acct.kind === "paper") throw new HttpError(400, "Paper holdings are simulated and cannot be sent to an external wallet");
  if (acct.kind !== "wallet" || !acct.external_ref) throw new HttpError(400, "Transfers must come from one of your connected crypto wallets");
  if (asset.asset_class !== "crypto" || asset.venue !== acct.network) throw new HttpError(400, `${asset.symbol} on ${asset.venue} can't be sent from a ${acct.network} wallet`);
  if (addr.network !== acct.network) throw new HttpError(400, `Destination is a ${addr.network} address but the asset is on ${acct.network}`);
  if (addr.address.toLowerCase() === acct.external_ref.toLowerCase()) throw new HttpError(400, "Destination is the same wallet");
  if (new Date(addr.usable_after) > new Date()) throw new HttpError(423, `New address is in its ${COOLING_HOURS}h security hold until ${new Date(addr.usable_after).toLocaleString()}`);
  const px = Number(asset.last_price ?? 0);
  if (asset.price_source === "simulated" || !px) throw new HttpError(409, "A real market price is required to value this transfer (connect a market-data provider)");
  const usdValue = r.amount * px;
  const used = await one<any>(`SELECT COALESCE(SUM(amount_usd),0) AS u FROM funding_requests WHERE user_id=$1 AND direction='withdrawal' AND rail='crypto'
                                AND status NOT IN ('failed','cancelled','blocked') AND created_at > now() - interval '24 hours'`, [userId]);
  const limit = Number(risk?.max_daily_withdrawal_usd ?? 10000);
  if (Number(used.u) + usdValue > limit) throw new HttpError(422, `Exceeds your 24h withdrawal limit ($${limit.toLocaleString()}; $${Number(used.u).toFixed(2)} used)`);
  const flags = await getFlags();
  await audit({ actorType: "user", actorId: userId, userId, action: "funding.transfer_requested", data: { asset: asset.symbol, network: acct.network, amount: r.amount, to: addr.address, enabled: flags.withdrawals } });
  if (!flags.withdrawals) throw new HttpError(403, "Crypto transfers are disabled until compliance approval (withdrawals flag off)");

  // Build the unsigned transaction / transfer intent for the user's wallet to sign.
  const decimals = asset.decimals ?? 18;
  let unsigned: any;
  if (EVM_CHAIN[acct.network]) {
    const base = toBaseUnits(r.amount, decimals);
    unsigned = asset.identifier === "native"
      ? { chainId: EVM_CHAIN[acct.network], from: acct.external_ref, to: addr.address, value: "0x" + base.toString(16), data: "0x" }
      : { chainId: EVM_CHAIN[acct.network], from: acct.external_ref, to: asset.identifier, value: "0x0", data: erc20TransferData(addr.address, base) };
  } else {
    // Solana / Sui / Aptos / Bitcoin: wallet adapters construct the transfer from this intent.
    unsigned = { kind: "transfer_intent", network: acct.network, from: acct.external_ref, to: addr.address, asset: asset.identifier, amountBaseUnits: toBaseUnits(r.amount, decimals).toString(), decimals };
  }
  const req = await one<any>(
    `INSERT INTO funding_requests (user_id, account_id, direction, rail, asset_id, network, amount, amount_usd, address_id, status, status_reason, unsigned_tx, idempotency_key)
     VALUES ($1,$2,'withdrawal','crypto',$3,$4,$5,$6,$7,'pending_signature','Sign with your wallet to send',$8,$9) RETURNING *`,
    [userId, acct.id, asset.id, acct.network, r.amount, usdValue, addr.id, JSON.stringify(unsigned), r.idempotencyKey]);
  await q("UPDATE withdrawal_addresses SET last_used_at=now() WHERE id=$1", [addr.id]);
  return req;
}

/** The user's wallet signed + broadcast the transfer; record the hash. */
export async function confirmCryptoTransfer(userId: string, id: string, txHash: string) {
  const f = await one<any>("SELECT * FROM funding_requests WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!f || f.status !== "pending_signature") throw new HttpError(409, "Transfer is not awaiting a signature");
  if (!/^[A-Za-z0-9]{32,128}$/.test(txHash.replace(/^0x/, ""))) throw new HttpError(400, "Invalid transaction hash");
  await q("UPDATE funding_requests SET status='submitted', tx_hash=$2, status_reason='Broadcast — awaiting confirmations', updated_at=now() WHERE id=$1", [id, txHash]);
  await q(`INSERT INTO transactions (user_id, account_id, kind, asset_id, amount, amount_usd, status, tx_hash, reference, receipt) VALUES ($1,$2,'transfer',$3,$4,$5,'pending',$6,$7,$8)`,
    [userId, f.account_id, f.asset_id, -Number(f.amount), -Number(f.amount_usd ?? 0), txHash, id, JSON.stringify({ rail: "crypto", network: f.network, non_custodial: true })]);
  await audit({ actorType: "user", actorId: userId, userId, action: "funding.transfer_signed", target: id, data: { txHash } });
  await publish(`user:${userId}`, "funding", { id, status: "submitted" });
}

export async function cancelRequest(userId: string, id: string) {
  const r = await one("UPDATE funding_requests SET status='cancelled', updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('pending_signature','pending') RETURNING id", [id, userId]);
  if (!r) throw new HttpError(409, "Only unsigned / pending requests can be cancelled");
  await audit({ actorType: "user", actorId: userId, userId, action: "funding.cancelled", target: id });
}

/* ───────────── ACH via Alpaca Broker API (stock funding & cash withdrawal) ───────────── */
async function broker() {
  const env = (await providerUsable("alpaca_broker", "production")) ? "production" : (await providerUsable("alpaca_broker", "sandbox")) ? "sandbox" : null;
  if (!env) throw new HttpError(409, "Bank funding requires the Alpaca Broker API integration (Admin → Integrations)");
  const ctx = contextFor("alpaca_broker", env);
  const key = await ctx.cred("ALPACA_BROKER_API_KEY"), secret = await ctx.cred("ALPACA_BROKER_API_SECRET");
  return { ctx, base: (await ctx.setting("base_url"))!, headers: { Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`, "content-type": "application/json" } };
}
async function brokerAccount(userId: string, accountId: string) {
  const acct = await one<any>("SELECT * FROM trading_accounts WHERE id=$1 AND user_id=$2", [accountId, userId]);
  if (!acct || acct.kind !== "brokerage" || acct.provider_id !== "alpaca_broker" || !acct.external_ref)
    throw new HttpError(400, "Bank transfers need a Merod brokerage account (Alpaca Broker). Connected third-party brokerages are funded at your broker.");
  return acct;
}

/** Link a bank via a Plaid processor token (no raw account numbers touch Merod). */
export async function linkBank(userId: string, b: { accountId: string; processorToken: string; nickname?: string; code?: string }) {
  if (!(await getFlags()).funding) throw new HttpError(403, "Bank funding is disabled until compliance approval (funding flag off)");
  if (!(await verifyStepUp(userId, b.code))) throw new HttpError(401, "A valid 2FA code is required to link a bank");
  const acct = await brokerAccount(userId, b.accountId);
  const { ctx, base, headers } = await broker();
  const j = await readJson(await ctx.fetch(`${base}/v1/accounts/${acct.external_ref}/ach_relationships`, { method: "POST", headers, body: JSON.stringify({ processor_token: b.processorToken }) }), "alpaca_broker");
  const row = await one<any>("INSERT INTO bank_links (user_id, account_id, provider_id, external_ref, nickname, mask, status) VALUES ($1,$2,'alpaca_broker',$3,$4,$5,$6) RETURNING *",
    [userId, acct.id, j.id, b.nickname ?? j.nickname ?? "Bank account", j.bank_account_number?.slice(-4) ?? null, String(j.status ?? "pending").toLowerCase() === "approved" ? "approved" : "pending"]);
  await audit({ actorType: "user", actorId: userId, userId, action: "funding.bank_linked", target: row.id });
  return row;
}

export async function achTransfer(userId: string, b: { accountId: string; bankLinkId: string; amount: number; direction: "deposit" | "withdrawal"; code?: string; idempotencyKey: string }) {
  const existing = await one<any>("SELECT * FROM funding_requests WHERE user_id=$1 AND idempotency_key=$2", [userId, b.idempotencyKey]);
  if (existing) return existing;
  if (b.direction === "withdrawal" && !(await verifyStepUp(userId, b.code))) throw new HttpError(401, "A valid 2FA code is required for cash withdrawals");
  const flags = await getFlags();
  await audit({ actorType: "user", actorId: userId, userId, action: `funding.ach_${b.direction}_requested`, data: { amount: b.amount, enabled: b.direction === "deposit" ? flags.funding : flags.withdrawals } });
  if (b.direction === "deposit" && !flags.funding) throw new HttpError(403, "Bank deposits are disabled until compliance approval (funding flag off)");
  if (b.direction === "withdrawal" && !flags.withdrawals) throw new HttpError(403, "Cash withdrawals are disabled until compliance approval (withdrawals flag off)");
  if (b.direction === "withdrawal") {
    const risk = await one<any>("SELECT max_daily_withdrawal_usd FROM risk_settings WHERE user_id=$1", [userId]);
    const used = await one<any>(`SELECT COALESCE(SUM(amount_usd),0) AS u FROM funding_requests WHERE user_id=$1 AND direction='withdrawal' AND rail='ach' AND status NOT IN ('failed','cancelled','blocked') AND created_at > now() - interval '24 hours'`, [userId]);
    if (Number(used.u) + b.amount > Number(risk?.max_daily_withdrawal_usd ?? 10000)) throw new HttpError(422, "Exceeds your 24h withdrawal limit");
  }
  const acct = await brokerAccount(userId, b.accountId);
  const bank = await one<any>("SELECT * FROM bank_links WHERE id=$1 AND user_id=$2 AND account_id=$3 AND status='approved'", [b.bankLinkId, userId, acct.id]);
  if (!bank) throw new HttpError(400, "Choose an approved linked bank account");
  const { ctx, base, headers } = await broker();
  const j = await readJson(await ctx.fetch(`${base}/v1/accounts/${acct.external_ref}/transfers`, { method: "POST", headers,
    body: JSON.stringify({ transfer_type: "ach", relationship_id: bank.external_ref, amount: b.amount.toFixed(2), direction: b.direction === "deposit" ? "INCOMING" : "OUTGOING" }) }), "alpaca_broker");
  const req = await one<any>(
    `INSERT INTO funding_requests (user_id, account_id, direction, rail, amount, amount_usd, bank_link_id, status, status_reason, provider_ref, idempotency_key)
     VALUES ($1,$2,$3,'ach',$4,$4,$5,'submitted',$6,$7,$8) RETURNING *`,
    [userId, acct.id, b.direction, b.amount, bank.id, `ACH ${String(j.status ?? "queued").toLowerCase()} — typically 1–3 business days`, j.id, b.idempotencyKey]);
  await q(`INSERT INTO transactions (user_id, account_id, kind, amount, amount_usd, status, reference, receipt) VALUES ($1,$2,$3,$4,$4,'pending',$5,$6)`,
    [userId, acct.id, b.direction, b.direction === "deposit" ? b.amount : -b.amount, req.id, JSON.stringify({ rail: "ach", provider: "alpaca_broker", provider_ref: j.id })]);
  return req;
}
