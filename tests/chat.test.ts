import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser } from "./helpers";
import { q } from "@/server/db";
import { deleteMessage, listMessages, muteUser, postMessage } from "@/server/chat/service";

test("community chat: everyone sees messages; keys and seed phrases are blocked", async () => {
  const a = await newUser(), b = await newUser();
  const m = await postMessage({ id: a, status: "active" }, "  gm everyone, watching $SOL today  ");
  assert.equal(m.body, "gm everyone, watching $SOL today");
  const seen = await listMessages({ after: m.id - 1 });
  assert.ok(seen.some((x: any) => x.id === m.id && x.handle));
  await assert.rejects(postMessage({ id: b, status: "active" }, "my key 0x" + "ab".repeat(32)), /private key/);
  await assert.rejects(postMessage({ id: b, status: "active" }, "abandon ability able about above absent absorb abstract absurd abuse access accident"), /seed phrase/);
  await assert.rejects(postMessage({ id: b, status: "active" }, "use sk-ant-" + "x".repeat(30)), /API key/);
});

test("community chat: only the author or an admin can delete; muted users can't post", async () => {
  const a = await newUser(), b = await newUser(), admin = await newUser();
  const m = await postMessage({ id: a, status: "active" }, "hello");
  await assert.rejects(deleteMessage({ id: b, role: "user" }, m.id), /only delete your own/);
  await deleteMessage({ id: admin, role: "admin" }, m.id);
  const gone = await q("SELECT deleted_at FROM chat_messages WHERE id=$1", [m.id]);
  assert.ok(gone[0].deleted_at);
  await muteUser(admin, b, 60, "spam");
  await assert.rejects(postMessage({ id: b, status: "active" }, "spam spam"), /muted/);
});
