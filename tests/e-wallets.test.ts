import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, assetId } from "./helpers";
import { one, q } from "@/server/db";

test("e-wallets: prompt creates a wallet + 20% profit rule; winning sells channel profit out of paper cash once; moves; P&L not hurt", async () => {
  const u = await newUser();
  const { handlePrompt } = await import("@/server/ai/interpret");
  const { channelProfits } = await import("@/server/ewallets");
  const { investedPaper } = await import("@/server/review/invested");
  const say = async (text: string) => String(((await handlePrompt(u, { text, provider: "merod" } as any)) as any).message.content);

  assert.match(await say("create an e-wallet called Savings with a goal of $5,000"), /E-wallet “Savings” is ready with a goal of \$5,000/);
  assert.match(await say("send 20% of all my profits to Savings"), /20% of all your profits goes to “Savings”/);

  const acct = (await one<any>("SELECT id, cash_balance FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [u]))!;
  const cash0 = Number(acct.cash_balance), inv0 = await investedPaper(u);
  const btc = await assetId("BTC");
  // a winning sell (+$50) and a losing one (-$10): only the winner is channelled
  for (const [pnl, k] of [[50, "w"], [-10, "l"]] as const)
    await q(`INSERT INTO orders (user_id, account_id, asset_id, provider_id, idempotency_key, source, side, order_type, quantity, is_paper, status, filled_quantity, avg_fill_price, realized_pnl)
             VALUES ($1,$2,$3,'paper',$4,'manual','sell','market',1,true,'filled',1,100,$5)`, [u, acct.id, btc, `ew-${u}-${k}`, pnl]);
  await channelProfits();
  await channelProfits(); // runs again: nothing is channelled twice
  const w = (await one<any>("SELECT * FROM e_wallets WHERE user_id=$1", [u]))!;
  assert.equal(Number(w.balance), 10, "20% of $50");
  const cash1 = Number((await one<any>("SELECT cash_balance FROM trading_accounts WHERE id=$1", [acct.id]))!.cash_balance);
  assert.equal(Math.round((cash0 - cash1) * 100) / 100, 10, "the $10 left trading cash");
  assert.equal(Math.round((inv0 - (await investedPaper(u))) * 100) / 100, 10, "counted like a withdrawal, so P&L isn't hurt");

  assert.match(await say("move $4 from Savings to trading"), /Moved \$4 from Savings to trading cash/);
  assert.match(await say("create an e-wallet called Vacation"), /Vacation/);
  assert.match(await say("move $3 from Savings to Vacation"), /Moved \$3 from Savings to Vacation/);
  assert.match(await say("show my e-wallets"), /Savings: \$3 .*goal \$5,000.*20% of all profits[\s\S]*Vacation: \$3/);
  assert.match(await say("stop sending profits to Savings"), /Stopped 1 profit rule for Savings/);
});
