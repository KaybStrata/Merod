import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { one, q } from "@/server/db";
import { saveSettings } from "@/server/auto/engine";
import { workspace, planFromText, setAsset, saveTask, runScheduledTasks, createStrategy } from "@/server/auto/workspace";

test("workspace: strategies from text, hand-picked assets, scheduled tasks and real-data panels", async () => {
  const me = await newUser();
  await freshPrices();
  await q("UPDATE users SET role='super_admin' WHERE id=$1", [me]);

  const st = await planFromText(me, "trade ETH and BTC with momentum");
  assert.equal(st.kind, "momentum");
  assert.equal(st.asset_ids.length, 2);
  await assert.rejects(planFromText(me, "do something clever"), /Name the stocks or coins/);

  const sol = (await one<any>("SELECT id FROM assets WHERE symbol='SOL' ORDER BY market_cap DESC NULLS LAST LIMIT 1"))!;
  await setAsset(me, sol.id, true);
  await createStrategy(me, { kind: "ai_swing", assetIds: [sol.id] });

  const task = await saveTask(me, { kind: "take_profit_sweep", atTime: "00:00", days: "daily", name: "Sweep" });
  await assert.rejects(saveTask(me, { kind: "run", atTime: "25:99" }), /HH:MM/);

  const w = await workspace(me);
  assert.equal(w.strategies.length, 2);
  assert.equal(w.strategies[0].label, "Momentum Pro");
  assert.ok(w.settings.asset_ids.includes(sol.id));
  assert.equal(w.risk.assetsTrading, 3);
  assert.ok(w.bots.some((b: any) => b.name === "Momentum Pro"));
  assert.equal(w.tasks[0].name, "Sweep");
  // Simulated test prices are never shown as live.
  assert.ok(w.tiles.every((t: any) => t.live === false));

  // A due task runs once a day; with auto trading off it records that it was skipped.
  await runScheduledTasks();
  const t1 = await one<any>("SELECT * FROM auto_tasks WHERE id=$1", [task.id]);
  assert.match(t1.last_result, /switched off/);
  await saveSettings(me, { enabled: true });
  await runScheduledTasks();
  const t2 = await one<any>("SELECT * FROM auto_tasks WHERE id=$1", [task.id]);
  assert.match(t2.last_result, /switched off/, "already ran today, so not run again");

  await setAsset(me, sol.id, false);
  assert.ok(!(await workspace(me)).settings.asset_ids.includes(sol.id));
});
