import "@/lib/server-only-shim";
import { one, q, tx } from "./db";
import { HttpError } from "./errors";
import { audit } from "./audit";

/**
 * E-wallets: named money pots inside Merod ("Savings", "Vacation", "Tax") that profits are channelled into.
 * Not crypto wallets: they hold dollars on Merod's ledger.
 *
 *   - Rules: "20% of all profits → Savings", "50% of SOL Momentum's profits → Vacation". After every winning sell, that
 *     share of the realized profit leaves trading cash and lands in the e-wallet, so it isn't traded again.
 *   - Paper trades: the money really moves out of paper cash (it's counted like a withdrawal, so P&L isn't hurt).
 *   - Real-money trades: Merod can't move money inside your broker, so the share is *earmarked* in the e-wallet
 *     (shown separately) and stays in your broker account.
 *   - Manual moves: trading cash ⇄ e-wallet, e-wallet → e-wallet.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function listWallets(userId: string) {
  const wallets = await q<any>("SELECT * FROM e_wallets WHERE user_id=$1 ORDER BY created_at", [userId]);
  const rules = await q<any>("SELECT * FROM e_wallet_rules WHERE user_id=$1 ORDER BY created_at", [userId]);
  const entries = await q<any>("SELECT e.*, w.name AS wallet FROM e_wallet_entries e JOIN e_wallets w ON w.id=e.wallet_id WHERE e.user_id=$1 ORDER BY e.id DESC LIMIT 200", [userId]);
  return wallets.map((w) => ({ ...w, balance: Number(w.balance), earmarked: Number(w.earmarked), goal_usd: w.goal_usd == null ? null : Number(w.goal_usd),
    rules: rules.filter((r) => r.wallet_id === w.id).map((r) => ({ ...r, percent: Number(r.percent) })), entries: entries.filter((e) => e.wallet_id === w.id).slice(0, 50).map((e) => ({ ...e, amount: Number(e.amount) })) }));
}

export async function findWallet(userId: string, name: string) {
  return one<any>("SELECT * FROM e_wallets WHERE user_id=$1 AND lower(name)=lower($2)", [userId, name.trim()]);
}

export async function createWallet(userId: string, name: string, goalUsd?: number | null, color?: string | null) {
  const n = name.trim().replace(/^["“']|["”']$/g, "").slice(0, 40);
  if (n.length < 1) throw new HttpError(400, "Give the e-wallet a name");
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM e_wallets WHERE user_id=$1", [userId]);
  if ((count?.n ?? 0) >= 50) throw new HttpError(400, "You can have up to 50 e-wallets");
  const existing = await findWallet(userId, n);
  if (existing) return existing;
  const w = await one<any>("INSERT INTO e_wallets (user_id, name, goal_usd, color) VALUES ($1,$2,$3,$4) RETURNING *", [userId, n, goalUsd ?? null, color ?? null]);
  await audit({ actorType: "user", actorId: userId, userId, action: "e_wallet.created", target: w.id, data: { name: n } });
  return w;
}

export async function addRule(userId: string, walletId: string, o: { percent: number; scope?: "all" | "bot" | "agent" | "source"; scopeRef?: string | null; scopeLabel?: string | null }) {
  if (!(o.percent > 0 && o.percent <= 100)) throw new HttpError(400, "Pick a share between 1% and 100%");
  const w = await one<any>("SELECT id FROM e_wallets WHERE id=$1 AND user_id=$2", [walletId, userId]);
  if (!w) throw new HttpError(404, "E-wallet not found");
  const scope = o.scope ?? "all";
  // Same scope → same rule (update the share instead of stacking duplicates).
  const dup = await one<any>("SELECT id FROM e_wallet_rules WHERE user_id=$1 AND wallet_id=$2 AND scope=$3 AND COALESCE(scope_ref,'')=COALESCE($4,'')", [userId, walletId, scope, o.scopeRef ?? null]);
  if (dup) return one<any>("UPDATE e_wallet_rules SET percent=$2, active=true WHERE id=$1 RETURNING *", [dup.id, o.percent]);
  return one<any>("INSERT INTO e_wallet_rules (user_id, wallet_id, scope, scope_ref, scope_label, percent) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [userId, walletId, scope, o.scopeRef ?? null, o.scopeLabel ?? null, o.percent]);
}

/** Available paper cash in an account: cash minus what open orders have reserved. */
async function available(c: any, accountId: string) {
  const a = await one<any>("SELECT cash_balance FROM trading_accounts WHERE id=$1 FOR UPDATE", [accountId], c);
  const res = await one<any>("SELECT COALESCE(SUM(amount),0) AS s FROM cash_reservations WHERE account_id=$1", [accountId], c).catch(() => ({ s: 0 }));
  return Number(a?.cash_balance ?? 0) - Number(res?.s ?? 0);
}

/** Move money: trading cash ⇄ e-wallet, or e-wallet → e-wallet. Paper money only (real money never leaves your broker). */
export async function moveMoney(userId: string, o: { from: { wallet?: string; trading?: boolean }; to: { wallet?: string; trading?: boolean }; amount: number; accountId?: string | null }) {
  const amt = r2(o.amount);
  if (!(amt > 0)) throw new HttpError(400, "Amount must be more than $0");
  return tx(async (c) => {
    const acct = o.accountId ? await one<any>("SELECT id FROM trading_accounts WHERE id=$1 AND user_id=$2 AND kind='paper'", [o.accountId, userId], c)
      : await one<any>("SELECT id FROM trading_accounts WHERE user_id=$1 AND kind='paper' ORDER BY created_at LIMIT 1", [userId], c);
    const wFrom = o.from.wallet ? await one<any>("SELECT * FROM e_wallets WHERE id=$1 AND user_id=$2 FOR UPDATE", [o.from.wallet, userId], c) : null;
    const wTo = o.to.wallet ? await one<any>("SELECT * FROM e_wallets WHERE id=$1 AND user_id=$2 FOR UPDATE", [o.to.wallet, userId], c) : null;
    if ((o.from.wallet && !wFrom) || (o.to.wallet && !wTo)) throw new HttpError(404, "E-wallet not found");
    if ((o.from.trading || o.to.trading) && !acct) throw new HttpError(400, "No paper trading account");
    if (wFrom && Number(wFrom.balance) < amt) throw new HttpError(400, `${wFrom.name} only has $${Number(wFrom.balance).toFixed(2)}`);
    if (o.from.trading) {
      const av = await available(c, acct.id);
      if (av < amt) throw new HttpError(400, `Only $${av.toFixed(2)} of trading cash is free (the rest is reserved for open orders)`);
    }
    if (wFrom) {
      await c.query("UPDATE e_wallets SET balance=balance-$2 WHERE id=$1", [wFrom.id, amt]);
      await c.query("INSERT INTO e_wallet_entries (user_id, wallet_id, kind, amount, note) VALUES ($1,$2,$3,$4,$5)", [userId, wFrom.id, o.to.trading ? "to_trading" : "transfer_out", -amt, o.to.trading ? "Moved to trading cash" : `Moved to ${wTo?.name}`]);
    }
    if (wTo) {
      await c.query("UPDATE e_wallets SET balance=balance+$2 WHERE id=$1", [wTo.id, amt]);
      await c.query("INSERT INTO e_wallet_entries (user_id, wallet_id, kind, amount, note) VALUES ($1,$2,$3,$4,$5)", [userId, wTo.id, o.from.trading ? "from_trading" : "transfer_in", amt, o.from.trading ? "Moved from trading cash" : `From ${wFrom?.name}`]);
    }
    if (o.from.trading || o.to.trading) {
      const delta = o.to.trading ? amt : -amt;
      await c.query("UPDATE trading_accounts SET cash_balance=cash_balance+$2 WHERE id=$1", [acct.id, delta]);
      await c.query(`INSERT INTO transactions (user_id, account_id, kind, amount, amount_usd, status, reference, receipt) VALUES ($1,$2,'transfer',$3,$3,'confirmed',$4,$5)`,
        [userId, acct.id, delta, (wFrom ?? wTo).id, JSON.stringify({ e_wallet: (wFrom ?? wTo).name, simulated: true })]);
    }
    await audit({ actorType: "user", actorId: userId, userId, action: "e_wallet.move", data: { amount: amt, from: wFrom?.name ?? (o.from.trading ? "trading" : null), to: wTo?.name ?? (o.to.trading ? "trading" : null) } }, c);
    return { amount: amt, from: wFrom?.name ?? "trading cash", to: wTo?.name ?? "trading cash" };
  });
}

/** Worker: channel the configured share of every new winning sell into its e-wallet(s). */
export async function channelProfits() {
  const rules = await q<any>("SELECT r.*, w.name AS wallet FROM e_wallet_rules r JOIN e_wallets w ON w.id=r.wallet_id WHERE r.active");
  if (!rules.length) return 0;
  let moved = 0;
  const byUser = new Map<string, any[]>();
  for (const r of rules) (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push(r);
  for (const [userId, rs] of byUser) {
    const since = rs.reduce((a, r) => (r.created_at < a ? r.created_at : a), rs[0].created_at);
    const sells = await q<any>(
      `SELECT o.id, o.account_id, o.source, o.source_ref, o.is_paper, o.realized_pnl, o.updated_at, a.symbol,
              (SELECT count(*) FROM e_wallet_entries e WHERE e.order_id=o.id AND e.kind='profit')::int AS done
         FROM orders o JOIN assets a ON a.id=o.asset_id
        WHERE o.user_id=$1 AND o.side='sell' AND o.status='filled' AND o.realized_pnl > 0 AND o.updated_at >= $2
        ORDER BY o.updated_at DESC LIMIT 300`, [userId, since]);
    for (const o of sells) {
      const pnl = Number(o.realized_pnl);
      const matching = rs.filter((r) => new Date(o.updated_at) >= new Date(r.created_at) && (r.scope === "all" || (r.scope === "source" && r.scope_ref === o.source) || ((r.scope === "bot" || r.scope === "agent") && o.source === r.scope && String(o.source_ref) === String(r.scope_ref))));
      if (!matching.length || o.done >= matching.length) continue;
      // Never channel more than the profit itself, however many rules match.
      let left = pnl;
      for (const r of matching) {
        const share = r2(Math.min(left, (pnl * Number(r.percent)) / 100));
        if (share < 0.01) continue;
        try {
          await tx(async (c) => {
            const done = await one("SELECT 1 FROM e_wallet_entries WHERE rule_id=$1 AND order_id=$2", [r.id, o.id], c);
            if (done) return;
            let amt = share, note = `${Number(r.percent)}% of +$${pnl.toFixed(2)} profit on ${o.symbol}`;
            if (o.is_paper) {
              const av = await available(c, o.account_id);
              amt = r2(Math.min(share, Math.max(0, av)));
              if (amt < 0.01) return;
              await c.query("UPDATE trading_accounts SET cash_balance=cash_balance-$2 WHERE id=$1", [o.account_id, amt]);
              await c.query(`INSERT INTO transactions (user_id, account_id, kind, amount, amount_usd, status, reference, receipt) VALUES ($1,$2,'transfer',$3,$3,'confirmed',$4,$5)`,
                [userId, o.account_id, -amt, r.wallet_id, JSON.stringify({ e_wallet: r.wallet, order: o.id, simulated: true })]);
              await c.query("UPDATE e_wallets SET balance=balance+$2 WHERE id=$1", [r.wallet_id, amt]);
            } else {
              note += " (real money: set aside, stays in your broker account)";
              await c.query("UPDATE e_wallets SET earmarked=earmarked+$2 WHERE id=$1", [r.wallet_id, amt]);
            }
            await c.query("INSERT INTO e_wallet_entries (user_id, wallet_id, kind, amount, is_paper, order_id, rule_id, note) VALUES ($1,$2,'profit',$3,$4,$5,$6,$7)",
              [userId, r.wallet_id, amt, o.is_paper, o.id, r.id, note]);
            left = r2(left - amt); moved++;
          });
        } catch (e: any) { console.error("[e-wallets]", e?.message); }
      }
    }
  }
  if (moved) { const { publish } = await import("./realtime"); for (const u of byUser.keys()) await publish(`user:${u}`, "e_wallet", {}).catch(() => {}); }
  return moved;
}
