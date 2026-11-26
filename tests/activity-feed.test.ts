import { test } from "node:test";
import assert from "node:assert/strict";
import { capFeed } from "@/lib/feed";

test("activity feed: a flood of bot status lines never pushes trades out of the list", () => {
  const t0 = Date.parse("2026-11-26T10:00:00Z");
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  const trades = [
    { id: "sell-loss", at: at(0), side: "sell", pnl: -2.5 },
    { id: "buy", at: at(1), side: "buy" },
    { id: "sell-win", at: at(2), side: "sell", pnl: 3.21 },
  ];
  const chatter = Array.from({ length: 500 }, (_, i) => ({ id: `bot${i}`, at: at(100 + i) })); // all newer than the trades
  const out = capFeed([...chatter, ...trades], 300);
  assert.equal(out.length, 300);
  for (const t of trades) assert.ok(out.some((i) => i.id === t.id), `${t.id} kept`);
  assert.deepEqual(out.map((i) => i.at), [...out.map((i) => i.at)].sort().reverse(), "newest first");
  assert.equal(capFeed(chatter, 300).length, 300, "with no trades, status lines fill the whole list");
});
