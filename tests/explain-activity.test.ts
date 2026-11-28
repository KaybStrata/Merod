import { test } from "node:test";
import assert from "node:assert/strict";
import { explainActivity } from "@/lib/explainActivity";

test("activity hover: rejections, fills and P&L get a plain-language explanation", () => {
  const r = explainActivity({ source: "bot", kind: "warning", actor: "Paper · bot", title: "Buy ADA $100.00: rejected", body: "Asset is view only" });
  assert.match(r.headline, /tried to buy \$100 of ADA, but the order was rejected/);
  assert.match(r.lines.join(" "), /no exchange connected/);
  const f = explainActivity({ source: "bot", kind: "execution", actor: "Paper · bot", title: "Sold 2 SOL @ $150", body: "Simulated fill", pnl: 12.5, pnlPct: 4.3 });
  assert.match(f.headline, /sold 2 SOL at \$150 each — about \$300 in total/);
  assert.match(f.lines.join(" "), /Profit on this sale: \+\$12\.5 \(\+4\.30%\)/);
  assert.match(f.lines.join(" "), /paper money/);
});
