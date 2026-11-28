import "./helpers";
import { test } from "node:test";
import assert from "node:assert/strict";
import { newUser, freshPrices } from "./helpers";
import { closestCommands } from "@/server/ai/best-effort";

test("closest commands match the words used", () => {
  assert.ok(closestCommands("make my bots stop losing so much money").some((c) => /stop loss|bots/.test(c)));
  assert.ok(closestCommands("how's the portfolio").some((c) => /portfolio/.test(c)));
});

test("Modo never says it needs another AI: unknown requests get a data answer + runnable commands; a buy without amount uses the default", async () => {
  await freshPrices();
  const u = await newUser();
  const { handlePrompt } = await import("@/server/ai/interpret");
  const r: any = await handlePrompt(u, { text: "flibber the jabberwock gently", provider: "merod" } as any);
  const c = String(r.message.content);
  assert.doesNotMatch(c, /Claude|ChatGPT|OpenAI|another AI|couldn't match|confus/i, c);
  assert.match(c, /closest things I can run/);
  const b: any = await handlePrompt(u, { text: "buy BTC", provider: "merod" } as any);
  assert.match(String(b.message.content), /No amount given, so I used \$100/, b.message.content);
});
