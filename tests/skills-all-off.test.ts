import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { one } from "@/server/db";
import { createSkill, skillCommand } from "@/server/skills";

test("'turn off all skills' switches off every skill AND point (nothing deleted); 'turn on all skills' brings them back", async () => {
  const u = await newUser();
  await createSkill(u, "Careful", "prefer coins with rising volume", "skill");
  await createSkill(u, "", "focus on Solana meme coins today", "point");
  await createSkill(u, "", "no new buys until Friday", "point");
  const off = await skillCommand(u, "turn off all skills");
  assert.match(off!, /Turned off 1 skill and 2 points/);
  assert.equal((await one<any>("SELECT count(*)::int AS n FROM skills WHERE user_id=$1 AND active", [u]))!.n, 0);
  assert.equal((await one<any>("SELECT count(*)::int AS n FROM skills WHERE user_id=$1", [u]))!.n, 3, "nothing deleted");
  assert.match((await skillCommand(u, "turn on all skills"))!, /Turned on 1 skill and 2 points/);
});

test("skills: edit re-reads the rules; a turned-off skill enforces nothing; deleted is gone", async () => {
  const { createSkill, updateSkill, setSkillActive, activeRules, deleteSkill } = await import("@/server/skills");
  const { newUser } = await import("./helpers");
  const { one } = await import("@/server/db");
  const u = await newUser();
  const { skill } = await createSkill(u, "No doge", "never buy DOGE");
  assert.deepEqual((await activeRules(u)).neverBuy, ["DOGE"]);
  await updateSkill(u, skill.id, { instructions: "never buy PEPE" });
  assert.deepEqual((await activeRules(u)).neverBuy, ["PEPE"]);
  await setSkillActive(u, skill.id, false);
  assert.equal((await activeRules(u)).neverBuy, undefined);
  await deleteSkill(u, skill.id);
  assert.equal(await one("SELECT 1 FROM skills WHERE id=$1", [skill.id]), null);
});
