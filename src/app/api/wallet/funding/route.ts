import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/server/auth";
import { ok, parse, rateLimit, route } from "@/server/http";
import { one, q } from "@/server/db";
import { HttpError } from "@/server/errors";
import {
  fundingOverview, paperCash, addAddress, removeAddress, depositInfo, createCryptoTransfer, confirmCryptoTransfer, cancelRequest, linkBank, achTransfer,
} from "@/server/wallet/funding";

/** GET: funding overview (rails, address book, banks, limits, requests, history) · ?receipt=<txId> · ?deposit=<accountId>. */
export const GET = route(async (req) => {
  const u = await requireUser();
  const sp = new URL(req.url).searchParams;
  const receipt = sp.get("receipt");
  if (receipt) {
    const t = await one<any>(`SELECT tr.*, a.symbol, t.label AS account_label, t.provider_id FROM transactions tr LEFT JOIN assets a ON a.id=tr.asset_id
                                JOIN trading_accounts t ON t.id=tr.account_id WHERE tr.id=$1 AND tr.user_id=$2`, [receipt, u.id]);
    if (!t) throw new HttpError(404, "Receipt not found");
    return ok({ receipt: t });
  }
  const dep = sp.get("deposit");
  if (dep) return ok({ deposit: await depositInfo(u.id, dep) });
  const overview = await fundingOverview(u.id);
  const recent = await q(`SELECT tr.id, tr.kind, tr.amount, tr.amount_usd, tr.status, tr.created_at, tr.receipt, a.symbol, t.label AS account_label FROM transactions tr
                            LEFT JOIN assets a ON a.id=tr.asset_id JOIN trading_accounts t ON t.id=tr.account_id
                           WHERE tr.user_id=$1 ORDER BY tr.created_at DESC LIMIT 40`, [u.id]);
  return ok({ ...overview, recent, funding: overview.flags.funding, withdrawals: overview.flags.withdrawals });
});

const uuid = z.string().uuid();
const code = z.string().max(8).optional();
const idem = z.string().min(8).max(100).optional();
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("paper_deposit"), accountId: uuid, amount: z.number().positive().max(1_000_000), idempotencyKey: idem }),
  z.object({ action: z.literal("paper_withdraw"), accountId: uuid, amount: z.number().positive().max(1_000_000), idempotencyKey: idem }),
  z.object({ action: z.literal("add_address"), label: z.string().min(1).max(60), network: z.string().max(20), address: z.string().min(20).max(120), code }),
  z.object({ action: z.literal("remove_address"), id: uuid }),
  z.object({ action: z.literal("crypto_transfer"), accountId: uuid, assetId: uuid, amount: z.number().positive(), addressId: uuid, code, idempotencyKey: idem }),
  z.object({ action: z.literal("crypto_transfer_signed"), id: uuid, txHash: z.string().min(32).max(140) }),
  z.object({ action: z.literal("cancel"), id: uuid }),
  z.object({ action: z.literal("link_bank"), accountId: uuid, processorToken: z.string().min(10).max(200), nickname: z.string().max(40).optional(), code }),
  z.object({ action: z.literal("ach_deposit"), accountId: uuid, bankLinkId: uuid, amount: z.number().positive().max(250_000), idempotencyKey: idem }),
  z.object({ action: z.literal("ach_withdraw"), accountId: uuid, bankLinkId: uuid, amount: z.number().positive().max(250_000), code, idempotencyKey: idem }),
]);

export const POST = route(async (req) => {
  const u = await requireUser();
  await rateLimit(`funding:${u.id}`, 30, 3600);
  const b = await parse(req, Body);
  const key = ("idempotencyKey" in b && b.idempotencyKey) || randomUUID();
  switch (b.action) {
    case "paper_deposit": return ok({ request: await paperCash(u.id, b.accountId, "deposit", b.amount, key) });
    case "paper_withdraw": return ok({ request: await paperCash(u.id, b.accountId, "withdrawal", b.amount, key) });
    case "add_address": return ok({ address: await addAddress(u.id, b) });
    case "remove_address": await removeAddress(u.id, b.id); return ok({ ok: true });
    case "crypto_transfer": return ok({ request: await createCryptoTransfer(u.id, { ...b, idempotencyKey: key }) });
    case "crypto_transfer_signed": await confirmCryptoTransfer(u.id, b.id, b.txHash); return ok({ ok: true });
    case "cancel": await cancelRequest(u.id, b.id); return ok({ ok: true });
    case "link_bank": return ok({ bank: await linkBank(u.id, b) });
    case "ach_deposit": return ok({ request: await achTransfer(u.id, { ...b, direction: "deposit", idempotencyKey: key }) });
    case "ach_withdraw": return ok({ request: await achTransfer(u.id, { ...b, direction: "withdrawal", idempotencyKey: key }) });
  }
});
