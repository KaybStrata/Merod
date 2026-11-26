import "@/lib/server-only-shim";
import { one, q } from "../db";
import { audit } from "../audit";
import { HttpError } from "../errors";
import { preview, place, resolveAsset, cancelAll, liveAccountFor } from "../engine/engine";
import type { OrderIntent } from "../engine/types";
import { createBot, type BotConfig } from "../bots/service";
import { pauseAllBots, resumeAllBots } from "../bots/runner";
import { parsePrompt, mergeClarification, setCatalog } from "./parser";
import { attachmentContext, trainingNotes } from "../learning/materials";
import { isStatusQuestion, statusAnswer, statusPacket, statusSnapshot } from "./status";
import { parseControl, runControl } from "./control";
import { applyEdits, fmtEdit, parseEdits, parseTargets } from "./bulk-edit";
import { AI_MODELS, aiAvailable, llmInterpret, llmResearch, llmStatus, type AIProvider } from "./llm";
import type { Instruction, TradeLeg } from "./schema";
import { promptDefaults } from "../training/trainer";
import { parseMimicRequest, parseMimicTop, topRoiLeaders } from "../copy/leaders";
import { gatherFacts, factsPacket, factsAnswer, isMarketQuestion, sourcesLine } from "./market-answers";
import { createFollow, type MimicScope } from "../copy/service";
import { splitInstructions, isAgentRequest, isStrategyRequest } from "./multi";
import { parseAppAction, type ActionStep } from "./actions";
import { attachWidgets, type WidgetHint } from "../talk/attach";

/**
 * Prompt-to-trade orchestrator:
 *  1 prompt → 2 interpret (AI structured output, or rule parser) → 3 resolve asset → 4 execution plan
 *  → 5 engine validation → 6 show price/fees/risks → 7 approval when required → 8 route → 9 confirm → 10 portfolio.
 * The AI never calls the engine directly; this module turns a validated instruction into engine intents.
 */
export interface PromptInput { text: string; conversationId?: string; screenAssetId?: string | null; provider?: AIProvider; model?: string; /** "2/5" when this is one instruction of a multi-instruction prompt (server-internal) */ part?: string; /** paper or real money for trades/bots from this prompt */ book?: "paper" | "live"; /** files attached in the prompt box */ attachmentIds?: string[]; /** server-internal: what the AI knows about the attachments */ attached?: { names: string[]; block: string; plain: string } | null }
export type PlanCard =
  | { type: "order"; intent: OrderIntent; plan: any }
  | { type: "bot"; config: BotConfig; strategyName: string; assetLabel: string }
  | { type: "alert"; created: { symbol: string; direction: string; price: number } }
  | { type: "confirm_action"; action: "cancel_all_orders" | "resume_all_bots"; detail: string }
  | { type: "executed"; detail: string; orderId?: string; status?: string }
  | { type: "research"; text: string }
  | { type: "clarify"; question: string; suggestions: string[] }
  | { type: "app_action"; title: string; steps: ActionStep[]; link?: { href: string; label: string } }
  | { type: "mimic"; handle: string; displayName: string; roi: number; pnl: number; invested: number; trades: number; scope: MimicScope; windowLabel: string;
      settings: { percent: number; maxDailyUsd: number }; alternatives: { handle: string; roi: number; trades: number }[] };

/** Give the rule parser the live asset catalog so tickers and company names work in any letter case (refreshed every 5 min). */
let catalogAt = 0;
export async function ensureParserCatalog() {
  if (Date.now() - catalogAt < 300_000) return;
  catalogAt = Date.now();
  try {
    const rows = await q<{ symbol: string; name: string }>("SELECT symbol, name FROM assets WHERE NOT ('demo_data' = ANY(risk_flags)) AND tradability <> 'unsupported' ORDER BY volume_24h DESC NULLS LAST LIMIT 6000");
    setCatalog(rows.map((r) => r.symbol), rows.map((r) => [r.name, r.symbol] as [string, string]));
  } catch { catalogAt = 0; }
}

async function userAI(userId: string, input: PromptInput) {
  const p = await one<{ ai_provider: AIProvider; ai_model: string }>("SELECT ai_provider, ai_model FROM user_profiles WHERE user_id=$1", [userId]);
  const provider = input.provider ?? p?.ai_provider ?? "anthropic";
  // A provider picked for this prompt (e.g. the Talk switch) uses your saved model only if it belongs to that provider.
  const list = ((AI_MODELS as any)[provider] ?? []) as { id: string }[];
  const saved = input.model ?? p?.ai_model;
  const model = saved && (provider === "merod" || list.some((m) => m.id === saved)) ? saved : list[0]?.id ?? saved ?? "claude-opus-5-5";
  return { provider, model };
}

async function interpret(userId: string, input: PromptInput, screenSymbol: string | null) {
  const { provider, model } = await userAI(userId, input);
  let usedProvider: string = "merod", usedModel = "deterministic", fallbackReason: string | null = null;
  let instruction: Instruction;
  // Multi-coin loops ("top 20 gainers … $10 each … sell at 2% … repeat") are parsed exactly by the rule parser.
  const det = parsePrompt(input.text);
  if (det.kind === "swing_loop" && det.swing?.scope) return { instruction: det, usedProvider, usedModel, fallbackReason };
  if (provider !== "merod" && (await aiAvailable(provider, userId))) {
    try {
      const holdings = (await q<{ symbol: string }>("SELECT DISTINCT a.symbol FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.user_id=$1 AND p.quantity>0", [userId])).map((r) => r.symbol);
      instruction = await llmInterpret(provider, model, input.text, { screenAsset: screenSymbol, holdings, notes: await notesWith(userId, input) }, userId);
      usedProvider = provider; usedModel = model;
    } catch (e: any) {
      fallbackReason = `${provider} unavailable (${e.message}); used Merod rule parser`;
      instruction = parsePrompt(input.text);
    }
  } else {
    if (provider !== "merod") fallbackReason = `${provider === "anthropic" ? "Claude" : "OpenAI"} is not connected — add your key under AI Keys; using Merod's rule parser`;
    instruction = parsePrompt(input.text);
  }
  // Modo understands anything: when its rules can't place a request, it asks whichever AI is available
  // (your key or the platform's, Claude first, then OpenAI), moving on if one fails (e.g. out of credits).
  if (instruction.kind === "clarify" && /couldn.t tell/i.test(instruction.clarification_question ?? "") && usedProvider === "merod") {
    const holdings = (await q<{ symbol: string }>("SELECT DISTINCT a.symbol FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.user_id=$1 AND p.quantity>0", [userId])).map((r) => r.symbol);
    for (const b of await brains(userId, provider)) {
      try {
        const ins = await llmInterpret(b.provider, b.model, input.text, { screenAsset: screenSymbol, holdings, notes: await notesWith(userId, input) }, userId);
        instruction = ins; usedProvider = b.provider; usedModel = b.model; fallbackReason = null;
        break;
      } catch (e: any) { fallbackReason = `${b.provider === "anthropic" ? "Claude" : "OpenAI"} unavailable (${e.message})`; }
    }
  }
  return { instruction, usedProvider, usedModel, fallbackReason };
}

/** Study notes plus anything attached to this prompt. */
async function notesWith(userId: string, input: PromptInput) {
  const n = await trainingNotes(userId);
  return [input.attached?.block, n].filter(Boolean).join("\n\n") || null;
}

/** AI models Modo can lean on, in order: the one you picked (if not Modo itself), then Claude, then OpenAI — only those with a usable key. */
async function brains(userId: string, preferred: AIProvider): Promise<{ provider: "anthropic" | "openai"; model: string }[]> {
  const order = [...new Set([preferred, "anthropic", "openai"].filter((p) => p !== "merod"))] as ("anthropic" | "openai")[];
  const out: { provider: "anthropic" | "openai"; model: string }[] = [];
  for (const p of order) if (await aiAvailable(p, userId).catch(() => false)) out.push({ provider: p, model: ((AI_MODELS as any)[p]?.[0]?.id) ?? "" });
  return out;
}

async function legAsset(leg: TradeLeg, screenAssetId: string | null | undefined) {
  if (!leg.symbol && !leg.contract_address) {
    if (!screenAssetId) return { error: "Which asset? Open an asset or name it (e.g. SOL, NVDA)." };
    return { asset: await resolveAsset({ assetId: screenAssetId }) };
  }
  try { return { asset: await resolveAsset({ symbol: leg.symbol ?? undefined, identifier: leg.contract_address ?? undefined, venue: normVenue(leg.network) }) }; }
  catch (e: any) {
    // Try resolving a spelled-out name ("Solana") against the asset table
    if (leg.symbol) {
      const byName = await q<any>("SELECT id FROM assets WHERE lower(name)=lower($1) AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY market_cap DESC NULLS LAST LIMIT 2", [leg.symbol]);
      if (byName.length === 1) return { asset: await resolveAsset({ assetId: byName[0].id }) };
    }
    return { error: e.message as string };
  }
}
const normVenue = (n: string | null) => {
  if (!n) return undefined;
  const m: Record<string, string> = { nasdaq: "XNAS", nyse: "XNYS", "bnb chain": "bsc", bnb: "bsc", eth: "ethereum", sol: "solana" };
  return m[n.toLowerCase()] ?? n.toLowerCase();
};

function legToIntent(leg: TradeLeg, assetId: string, price: number | null): OrderIntent {
  const sizing = leg.amount_type === "usd" ? { notionalUsd: leg.amount! } : leg.amount_type === "percent_position" ? { percentOfPosition: leg.amount! } : { quantity: leg.amount! };
  const tp = leg.take_profit_pct && price ? { takeProfit: +(price * (1 + leg.take_profit_pct / 100)).toPrecision(8) } : {};
  const sl = leg.stop_loss_pct && price ? { stopLoss: +(price * (1 - leg.stop_loss_pct / 100)).toPrecision(8) } : {};
  return {
    asset: { assetId }, side: leg.side, orderType: leg.order_type === "trailing_stop" ? "market" : leg.order_type, timeInForce: "gtc", ...sizing,
    ...(leg.limit_price ? { limitPrice: leg.limit_price } : {}), ...(leg.stop_price ? { stopPrice: leg.stop_price } : {}), ...tp, ...sl,
  } as OrderIntent;
}

const AMOUNT_CHIPS = ["$25", "$50", "$100", "$250"];

export async function handlePrompt(userId: string, input: PromptInput) {
  let text = input.text.trim().slice(0, 2000);
  if (input.attachmentIds?.length && input.attached === undefined) {
    input = { ...input, attached: await attachmentContext(userId, input.attachmentIds) };
    if (!input.attached) throw new HttpError(400, "Those attachments couldn't be found. Attach them again.");
    if (!text) text = "What's in the attached file(s)? Summarize it and tell me what matters for my trading.";
  }
  if (!text) throw new HttpError(400, "Empty prompt");
  // "try now" / "try again" / "retry": run the previous request in this conversation again (e.g. after a limit was removed).
  if (input.conversationId && /^(please\s+)?(try(\s+it)?\s+(again|now)|retry|redo|run it again|do it again|again)[\s.!]*$/i.test(text)) {
    const prev = await one<{ content: string }>(
      `SELECT p.content FROM trading_prompts p JOIN ai_conversations c ON c.id=p.conversation_id
        WHERE p.conversation_id=$1 AND c.user_id=$2 AND p.role='user' AND p.content !~* '^(please\\s+)?(try|retry|redo|run it again|do it again|again)'
        ORDER BY p.created_at DESC LIMIT 1`, [input.conversationId, userId]);
    if (prev?.content) text = prev.content;
  }
  const perms = await one<any>("SELECT * FROM trading_permissions WHERE user_id=$1", [userId]);

  let convId = input.conversationId;
  if (convId) { if (!(await one("SELECT 1 FROM ai_conversations WHERE id=$1 AND user_id=$2", [convId, userId]))) convId = undefined; }
  if (!convId) convId = (await one<{ id: string }>("INSERT INTO ai_conversations (user_id, title) VALUES ($1,$2) RETURNING id", [userId, text.slice(0, 60)]))!.id;

  // Several instructions in one prompt → each runs on its own, in order, in this conversation (one reply per instruction).
  if (!input.part) {
    const parts = splitInstructions(text);
    if (parts.length > 1) {
      const results: any[] = [];
      for (const [i, p] of parts.entries()) {
        const part = `${i + 1}/${parts.length}`;
        try { results.push(await handlePrompt(userId, { ...input, text: p, conversationId: convId, part })); }
        catch (e: any) {
          const row = await one<any>(`INSERT INTO trading_prompts (user_id, conversation_id, role, content, status) VALUES ($1,$2,'assistant',$3,'rejected') RETURNING *`,
            [userId, convId, `${part} · ${p}\nCouldn't do this one: ${e.message}`]);
          results.push({ conversationId: convId, message: row, userMessageId: null, fallbackReason: null, provider: "merod", model: "deterministic" });
        }
      }
      const last = results[results.length - 1];
      return { ...last, messages: results.map((r) => r.message), fallbackReason: results.find((r) => r.fallbackReason)?.fallbackReason ?? null };
    }
  }

  const screen = input.screenAssetId ? await one<any>("SELECT id, symbol FROM assets WHERE id=$1", [input.screenAssetId]) : null;
  const userMsg = await one<{ id: string }>("INSERT INTO trading_prompts (user_id, conversation_id, role, content) VALUES ($1,$2,'user',$3) RETURNING id",
    [userId, convId, input.attached && !input.part?.match(/^[2-9]/) ? `${text}\n📎 ${input.attached.names.join(", ")}` : text]);

  // Clarification follow-up: merge the answer into the pending instruction.
  const last = await one<any>("SELECT * FROM trading_prompts WHERE conversation_id=$1 AND role='assistant' ORDER BY created_at DESC LIMIT 1", [convId]);
  let instruction: Instruction | null = null, usedProvider = "merod", usedModel = "deterministic", fallbackReason: string | null = null;
  let originText = text;
  await ensureParserCatalog();
  // Typed approval ("approve", "yes", "do it", "confirm") approves the latest card waiting for you in this conversation.
  if (/^(please\s+)?(approve|approved|yes|yep|yeah|confirm|confirmed|do it|go ahead|go|apply( it| them)?|ok(ay)?|sure)[\s.!]*$/i.test(text)) {
    const pending = await one<any>("SELECT * FROM trading_prompts WHERE conversation_id=$1 AND user_id=$2 AND role='assistant' AND status='needs_approval' AND plan IS NOT NULL ORDER BY created_at DESC LIMIT 1", [convId, userId]);
    if (pending) {
      const card = pending.plan as PlanCard;
      if (card.type === "app_action") {
        // Settings are applied by your browser: hand the same card back marked to apply right away (you just approved it).
        await q("UPDATE trading_prompts SET status='superseded' WHERE id=$1", [pending.id]);
        return reply(`Applying ${card.steps.length === 1 ? "the change" : `the ${card.steps.length} changes`}:\n${card.steps.map((s) => `• ${s.label}`).join("\n")}`, { ...card, autoApply: true } as any, "needs_approval", null);
      }
      try {
        const result = await approvePlan(userId, pending.id);
        const what = card.type === "order" ? `Order ${result.status}${result.reason ? `: ${result.reason}` : ""}` : card.type === "bot" ? `Bot ${result.status}` : card.type === "mimic" ? `Mimicking @${result.handle}` : "Done";
        return reply(`Approved. ${what}.`, { type: "executed", detail: what, orderId: result.orderId, status: result.status }, "executed", null);
      } catch (e: any) { return reply(`Couldn't approve that: ${e.message}`, null, "rejected", null); }
    }
  }
  // "@SOL Momentum turn off" / "resume ETH Accumulation": control a specific bot or agent by name (even right after a question).
  const ctl = await parseControl(userId, text);
  if (ctl) {
    const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [userId]))?.role;
    const lines = await runControl(userId, ctl.verb, ctl.targets, role === "super_admin");
    const what = `${ctl.verb === "pause" ? "Turned off" : "Turned on"} ${ctl.targets.map((x) => x.name).join(", ")}`;
    return reply(lines.join("\n"), { type: "executed", detail: what }, "executed", null, { agents: ctl.targets.some((x) => x.kind === "agent") });
  }
  // "Create a stop loss for all bots/agents at -8%", "take profit 5% on SOL Momentum", "all bots $20 per trade".
  const edits = !/\b(create|make|build|launch|spin up)\b[^.]{0,30}\b(new|\d+)\s+(bots?|agents?)\b/i.test(text) ? parseEdits(text) : null;
  const editTargets = edits ? await parseTargets(userId, text) : null;
  if (edits && editTargets) {
    const lines = await applyEdits(userId, editTargets, edits);
    const nb = editTargets.filter((x) => x.kind === "bot").length, na = editTargets.length - nb;
    return reply(`Updated ${[nb ? `${nb} bot${nb === 1 ? "" : "s"}` : "", na ? `${na} agent${na === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")}: ${fmtEdit(edits)}.\n${lines.join("\n")}`,
      { type: "executed", detail: `${fmtEdit(edits)} → ${editTargets.length} bot${editTargets.length === 1 ? "" : "s"}/agent${editTargets.length === 1 ? "" : "s"}` }, "executed", null, { agents: na > 0 });
  }
  if (last?.status === "clarify" && last.interpretation) {
    // A full new command ("buy $100 of msft") replaces the pending question; it inherits the asset if it didn't name one.
    const fresh = parsePrompt(text);
    if (fresh.kind !== "clarify") {
      const pl = last.interpretation.trades?.[0], fl = fresh.trades?.[0];
      if (fl && pl && !fl.symbol && !fl.contract_address) { fl.symbol = pl.symbol; fl.contract_address = pl.contract_address; fl.network = pl.network; }
      instruction = fresh;
    } else instruction = mergeClarification(last.interpretation, text);
    if (instruction) {
      // Record the user's original instruction (not just the clarification answer) on anything we create.
      const orig = await one<{ content: string }>("SELECT content FROM trading_prompts WHERE conversation_id=$1 AND role='user' AND created_at < $2 ORDER BY created_at DESC LIMIT 1", [convId, last.created_at]);
      if (orig) originText = `${orig.content} → ${text}`;
    }
  }
  // Questions about your own activity — bots, agents, orders, positions, P&L, Auto/Modo, Mimic — are answered from a live
  // snapshot of your account (by Modo with whichever AI is available, else directly from the data).
  if (!instruction && isStatusQuestion(text)) {
    const snap = await statusSnapshot(userId);
    const packet = statusPacket(snap);
    const { provider } = await userAI(userId, input);
    for (const b of await brains(userId, provider)) {
      try {
        const t = (await llmStatus(b.provider, b.model, text, input.attached ? `${packet}\n\n${input.attached.block}` : packet, userId)).trim();
        if (!t) continue;
        usedProvider = b.provider; usedModel = b.model; fallbackReason = null;
        return reply(t, { type: "research", text: t }, "info", { kind: "portfolio_question", summary: "Activity status" } as any, { portfolio: true, agents: /agent|fleet/i.test(text) });
      } catch (e: any) { fallbackReason = `${b.provider === "anthropic" ? "Claude" : "OpenAI"} unavailable (${String(e.message).slice(0, 120)}); answered from your live data`; }
    }
    const t = statusAnswer(text, snap);
    return reply(t, { type: "research", text: t }, "info", { kind: "portfolio_question", summary: "Activity status" } as any, { portfolio: true, agents: /agent|fleet/i.test(text) });
  }
  // App actions: settings, on/off switches, opening pages. Proposed as a card; your browser applies it when you press Approve.
  if (!instruction) {
    const act = parseAppAction(text);
    if (act && "navigateOnly" in act) return reply(`Opening ${act.link.label}.`, { type: "app_action", title: act.title, steps: [], link: act.link }, "info", null);
    if (act) return reply(`${act.steps.length === 1 ? "Here's the change" : `Here are the ${act.steps.length} changes`}. Press Approve to apply ${act.steps.length === 1 ? "it" : "them"}:\n${act.steps.map((s) => `• ${s.label}`).join("\n")}`,
      { type: "app_action", title: act.title, steps: act.steps }, "needs_approval", null);
  }
  // "Create 5 agents that trade Solana meme coins" → a fleet of paper agents, waiting for your approval in Agents.
  if (!instruction && isAgentRequest(text)) {
    try {
      const { planFleet, createFleet, fleetAction } = await import("../agents/fleets");
      const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [userId]))?.role;
      const draft = await planFleet(text);
      // With automation set to run on its own: Supervised (level 4) trading agents execute automatically (level 5), and the fleet starts right away.
      const auto = perms?.mode !== "manual";
      if (auto) for (const ag of draft.agents) if (ag.autonomy === 4) ag.autonomy = 5;
      const fleet: any = await createFleet(userId, draft as any, { isOwner: role === "super_admin" });
      const id = fleet?.fleet?.id ?? fleet?.id;
      let started = false;
      if (auto && id) { try { await fleetAction(userId, id, "approve", { isOwner: role === "super_admin" }); started = true; } catch { /* stays waiting for approval */ } }
      const names = `${draft.agents.slice(0, 6).map((a) => a.name).join(", ")}${draft.agents.length > 6 ? ", …" : ""}`;
      return reply(`Created fleet "${draft.name}" with ${draft.agents.length} agent${draft.agents.length === 1 ? "" : "s"} (${names}). Agents trade on paper. ${started ? "It's running now, no approval needed." : `Approve the fleet in Agents${id ? ` → /agents/fleets/${id}` : ""} to start it.`}`, null, "executed", null, { agents: true });
    } catch (e: any) { return reply(`Couldn't create those agents: ${e.message}`, null, "rejected", null); }
  }
  // "Create a strategy that buys SOL on a 4% dip and takes 6% profit" → a saved, versioned strategy (never an order).
  if (!instruction && isStrategyRequest(text)) {
    try {
      const { compile, createStrategy } = await import("../lab/strategies");
      const c = await compile({ text });
      if (!c.ok || !c.draft) return reply(`I need a bit more to build that strategy: ${[...c.missing, ...c.errors].join("; ") || "add an entry rule and a size"}.`,
        { type: "clarify", question: "What should the strategy do?", suggestions: ["Create a strategy that buys SOL on a 4% dip, takes 6% profit, $50 per trade"] }, "clarify", null);
      const s = await createStrategy(userId, c.draft, text);
      return reply(`Saved strategy "${c.draft.name}" (v${s.version?.version ?? 1}): ${c.summary} Open Strategies to backtest or deploy it.${c.warnings.length ? `\nNote: ${c.warnings.join("; ")}` : ""}`, null, "executed", null);
    } catch (e: any) { return reply(`Couldn't create that strategy: ${e.message}`, null, "rejected", null); }
  }
  // "Mimic the top 50 stock and crypto traders this week" → mimic many traders at once, immediately (owner only).
  const bulk = !instruction ? parseMimicTop(text) : null;
  if (bulk) {
    const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [userId]))?.role;
    if (role !== "super_admin") return reply("Mimic trading is only available on the platform owner's account.", null, "info", null);
    try {
      const { mimicTop } = await import("../copy/directory");
      const r = await mimicTop(userId, bulk);
      const lines: string[] = [];
      if (r.crypto) lines.push(`Crypto wallets: ${r.crypto.done} now mimicked${r.crypto.window ? ` (top ${bulk.count} by ${r.crypto.kind === "pnl" ? "PnL" : "net flow"}, ${r.crypto.window})` : ""}${r.crypto.note ? `. ${r.crypto.note}` : ""}`);
      if (r.merodCrypto?.done) lines.push(`Merod crypto traders: ${r.merodCrypto.done}`);
      if (r.stocks) lines.push(`Stock traders: ${r.stocks.done} now mimicked${r.stocks.note ? `. ${r.stocks.note}` : ""}`);
      const skipped = [r.crypto?.skipped, r.merodCrypto?.skipped, r.stocks?.skipped].flat().filter(Boolean);
      const acct = r.crypto?.account ?? r.stocks?.account ?? (bulk.live ? "real money" : "paper");
      return reply(`Done. ${lines.join(". ")}.\nAccount: ${acct}. Sizing: ${bulk.perTradeUsd ? `$${bulk.perTradeUsd} per trade` : "same size as each trader"}, ${bulk.maxDailyUsd ? `$${bulk.maxDailyUsd}/day cap each` : "no spending cap"}.${skipped.length ? `\nSkipped ${skipped.length} (e.g. ${skipped[0]}).` : ""}\nOnly public Solana wallets and Merod traders who allow copying can be mimicked: trades at outside brokers and exchanges aren't public. Pause any of them in Mimic trading.`, null, "info", null);
    } catch (e: any) { return reply(`Couldn't start the mimics: ${e.message}`, null, "info", null); }
  }
  // "Mimic the top ROI earner for Solana meme coins this week" → find the trader, propose a mimic bot (owner only).
  const mimicReq = !instruction ? parseMimicRequest(text) : null;
  if (mimicReq) {
    const role = (await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [userId]))?.role;
    if (role !== "super_admin") return reply("Mimic trading is only available on the platform owner's account.", null, "info", null);
    const ranked = await topRoiLeaders(userId, mimicReq, 4);
    if (!ranked.length) return reply(`I couldn't find a trader to mimic for ${mimicReq.scope.label} ${mimicReq.windowLabel}. Only Merod traders who allow copying are ranked, and they need at least one closed trade in that window. Try a longer window, e.g. "this month".`,
      { type: "clarify", question: "Try a different window or market?", suggestions: [`Mimic the top ROI earner for ${mimicReq.scope.label} this month`, "Mimic the top ROI trader this week"] }, "clarify", null);
    const [top, ...rest] = ranked;
    const card: PlanCard = { type: "mimic", handle: top.handle, displayName: top.displayName, roi: top.roi, pnl: top.pnl, invested: top.invested, trades: top.trades,
      scope: mimicReq.scope, windowLabel: mimicReq.windowLabel, settings: { percent: 100, maxDailyUsd: 0 },
      alternatives: rest.map((l) => ({ handle: l.handle, roi: l.roi, trades: l.trades })) };
    return reply(`Top ROI for ${mimicReq.scope.label} ${mimicReq.windowLabel}: @${top.handle}, ${(top.roi * 100).toFixed(1)}% on ${top.trades} trade${top.trades === 1 ? "" : "s"}. Approve to start a mimic bot that repeats their ${mimicReq.scope.label === "all markets" ? "" : mimicReq.scope.label + " "}trades at the same size.`, card, "needs_approval", null);
  }
  // Questions about a stock/coin ("what was NVDA in 2020?", "btc price", "should I buy SOL?") go to research with live +
  // historical data, unless they're a complete instruction (an alert, or a trade with an amount).
  if (!instruction && isMarketQuestion(text)) {
    const pre = parsePrompt(text);
    const tradeWithoutAmount = pre.kind === "trade" && !pre.trades?.some((l) => l.amount);
    if (pre.kind === "clarify" || pre.kind === "research" || tradeWithoutAmount)
      instruction = { ...pre, kind: "research", summary: "Market question", clarification_question: null, trades: [], research_query: text };
  }
  if (!instruction) ({ instruction, usedProvider, usedModel, fallbackReason } = await interpret(userId, { ...input, text }, screen?.symbol ?? null));
  if (input.attached && instruction.kind === "clarify") instruction = { ...instruction, kind: "research", research_query: text } as Instruction;
  if (!perms?.allow_ai_prompts && !["research", "portfolio_question", "clarify", "pause_all_bots"].includes(instruction.kind))
    return reply("AI prompt trading is disabled in your automation permissions (Settings → Automation).", { type: "clarify", question: "Enable AI prompt trading in Settings to continue.", suggestions: [] }, "info");

  async function reply(message: string, card: PlanCard | null, status: string, interp: Instruction | null = instruction, hint?: WidgetHint) {
    // Every new bot asks: risk flagging on or off? Default follows your Risk setting; the card has the switch.
    if (card?.type === "bot" && status === "needs_approval" && card.config.allowRisky === undefined) {
      const off = (await one<{ b: boolean }>("SELECT block_risky_tokens AS b FROM risk_settings WHERE user_id=$1", [userId]))?.b === false;
      card = { ...card, config: { ...card.config, allowRisky: off } };
      message += off
        ? `\n\nRisk flagging is OFF for this bot (it won't reject new, unverified or low-liquidity coins). Want it on? Flip "Risk flagging" on the card before you activate.`
        : `\n\nRisk flagging is ON for this bot: it rejects buys of new, unverified or low-liquidity coins. Want it off? Flip "Risk flagging" on the card before you activate, or say "turn off risk flagging".`;
    }
    let row = await one<any>(
      `INSERT INTO trading_prompts (user_id, conversation_id, role, content, ai_provider, ai_model, interpretation, plan, status) VALUES ($1,$2,'assistant',$3,$4,$5,$6,$7,$8) RETURNING *`,
      [userId, convId, input.part ? `${input.part} · ${text}\n${message}` : message, usedProvider, usedModel, interp ? JSON.stringify(interp) : null, card ? JSON.stringify(card) : null, status]);
    await audit({ actorType: "ai", actorId: usedProvider, userId, action: "ai.prompt", target: row.id, data: { kind: interp?.kind, status, fallback: !!fallbackReason } });
    // Talk mode: typed, data-only widgets under plan.widgets (never markup; never changes the plan itself). Best effort.
    const kind = hint?.agents && !hint.portfolio ? "agents" : interp?.kind ?? (card?.type === "research" ? "research" : "info");
    if (hint || status === "needs_approval") row = (await attachWidgets(userId, row, kind, hint ?? {}).catch(() => null)) ?? row;
    return { conversationId: convId!, message: row, userMessageId: userMsg!.id, fallbackReason, provider: usedProvider, model: usedModel };
  }

  // Anything the rules don't recognise goes to the connected AI (Claude or OpenAI) as an open question instead of "I couldn't tell".
  let ins = instruction;
  if (ins.kind === "clarify" && /couldn.t tell/i.test(ins.clarification_question ?? "")) {
    if ((await brains(userId, (await userAI(userId, input)).provider)).length) ins = { ...ins, kind: "research", summary: "Question", clarification_question: null, research_query: text };

  }
  const leg = ins.trades[0];
  switch (ins.kind) {
    case "clarify":
      {
        const q0 = ins.clarification_question ?? "";
        const sym = ins.trades[0]?.symbol;
        const suggestions = /how much/i.test(q0) ? AMOUNT_CHIPS
          : /^What would you like to do with/.test(q0) && sym ? [`Buy $100 of ${sym}`, `Sell 25% of ${sym}`, `Alert me when ${sym} drops 5%`, `Analyze ${sym}`]
          : /couldn't tell/.test(q0) ? ["Buy $100 of BTC", "Turn off risk flags for my bots", "Open purchase history", "Create 3 agents that trade Solana meme coins", "Mimic the top 20 crypto traders this week"] : [];
        const help = /couldn't tell/.test(q0) ? "I couldn't match that to something I can do on my own. I can trade, change settings (\"turn off risk flags\", \"max slippage 3%\", \"turn Modo on\"), open pages (\"open purchase history\"), create bots, agents and strategies, mimic traders, set alerts, and answer market questions. For open-ended requests, connect Claude or OpenAI under Broker & AI keys." : q0;
        return reply(help || "Could you clarify?", { type: "clarify", question: help, suggestions }, "clarify");
      }

    case "trade": {
      if (!leg) return reply("I couldn't find a trade in that request.", null, "info");
      if (!leg.amount || !leg.amount_type) return reply(`How much should I ${leg.side}?`, { type: "clarify", question: `How much should I ${leg.side}?`, suggestions: leg.side === "buy" ? AMOUNT_CHIPS : ["25%", "50%", "100%"] }, "clarify");
      const r = await legAsset(leg, input.screenAssetId);
      if (!r.asset) return reply(r.error!, { type: "clarify", question: r.error!, suggestions: [] }, "clarify");
      const intent = legToIntent(leg, r.asset.id, r.asset.last_price);
      // Real money chosen in the composer: route to your real account for this asset (the engine still requires the Real money switch + 2FA).
      if (input.book === "live") {
        try { intent.accountId = (await liveAccountFor(userId, r.asset.id)).id; }
        catch (e: any) { return reply(`Real money is selected, but ${e.message.replace(/^./, (c: string) => c.toLowerCase())}`, { type: "clarify", question: "Switch to Paper, or connect a real account?", suggestions: [] }, "rejected"); }
      }
      // Auto-training: apply learned protective defaults (risk-reducing only).
      const learned = await promptDefaults(userId);
      const trainingNotes: string[] = [];
      if (learned?.default_stop_loss_pct && intent.side === "buy" && !intent.stopLoss && r.asset.last_price) {
        intent.stopLoss = +(r.asset.last_price * (1 - Number(learned.default_stop_loss_pct) / 100)).toPrecision(8);
        trainingNotes.push(`Auto-training added a ${learned.default_stop_loss_pct}% stop-loss`);
      }
      const ctx = { userId, source: "prompt" as const, sourceRef: userMsg!.id, idempotencyKey: `prompt:${userMsg!.id}`, actor: { type: "ai" as const, id: usedProvider } };
      const plan = await preview(intent, ctx);
      if (plan.decision === "execute" && learned?.max_prompt_order_usd && plan.notionalUsd > Number(learned.max_prompt_order_usd)) {
        plan.decision = "pending_approval";
        plan.decisionReason = `Auto-training: prompt orders above $${learned.max_prompt_order_usd} need your approval`;
      }
      if (trainingNotes.length) plan.risks = [...trainingNotes, ...plan.risks];
      if (plan.decision === "execute") {
        const { order } = await place(intent, ctx);
        return reply(`${ins.summary} — ${order.status === "filled" ? "executed" : order.status}. ${plan.decisionReason}.`, { type: "executed", detail: plan.decisionReason, orderId: order.id, status: order.status }, "executed");
      }
      return reply(plan.decision === "rejected" ? `I can't place this: ${plan.decisionReason}` : `${ins.summary}. Review and approve below.`, { type: "order", intent, plan }, plan.decision === "rejected" ? "rejected" : "needs_approval", instruction,
        plan.decision === "rejected" ? { chartAssetId: r.asset.id, clarify: { question: `Blocked: ${plan.decisionReason}`, options: [{ label: "Try a smaller amount", reply: `${leg.side} $25 of ${r.asset.symbol}` }, { label: "Show my risk limits", reply: "What are my risk limits?" }] } } : undefined);
    }

    case "swing_loop":
    case "recurring_buy":
    case "conditional_trade": {
      if (!leg) return reply("Which asset should this apply to?", { type: "clarify", question: "Which asset?", suggestions: [] }, "clarify");
      if (ins.kind !== "conditional_trade" && (!leg.amount || leg.amount_type === "percent_position")) {
        if (ins.kind === "swing_loop" && ins.swing?.scope) { const qn = "How much should the bot spend on each coin it buys?"; return reply(qn, { type: "clarify", question: qn, suggestions: AMOUNT_CHIPS }, "clarify"); }
        const qn = ins.kind === "swing_loop" ? "How much should each buy cycle spend?" : "How much should each recurring purchase be?";
        return reply(qn, { type: "clarify", question: qn, suggestions: AMOUNT_CHIPS }, "clarify");
      }
      if (ins.kind === "conditional_trade" && !leg.amount) return reply(`How much should I ${leg.side}?`, { type: "clarify", question: `How much should I ${leg.side}?`, suggestions: leg.side === "sell" ? ["25%", "50%", "100%"] : AMOUNT_CHIPS }, "clarify");
      // A bot over many coins ("every Solana meme coin", "the top 20 gainers"): matching coins with live prices, one buy → sell → repeat cycle per coin.
      if (ins.kind === "swing_loop" && ins.swing?.scope) {
        const sc = ins.swing.scope;
        const gainers = sc.rank === "gainers";
        const limit = Math.min(1000, Math.max(1, sc.top ?? (gainers ? 20 : 50)));
        const coins = await q<any>(
          `SELECT id, symbol, change_24h FROM assets WHERE asset_class='crypto' AND NOT ('demo_data'=ANY(risk_flags)) AND tradability IN ('paper_tradable','live_tradable')
             AND last_price IS NOT NULL AND price_source IS NOT NULL AND price_source <> 'simulated' AND price_updated_at > now() - interval '30 minutes'
             AND ($1::text IS NULL OR venue=$1) AND (NOT $2 OR EXISTS (SELECT 1 FROM unnest(categories) c WHERE c ILIKE '%meme%'))
             AND upper(symbol) NOT IN ('USDC','USDT','DAI','PYUSD','USDE','USDS','FDUSD','TUSD','USDP','EURC')
             AND (NOT $3 OR change_24h > 0)
           ORDER BY ${gainers ? "change_24h DESC NULLS LAST" : "volume_24h DESC NULLS LAST"} LIMIT $4`, [sc.venue ?? null, !!sc.meme, gainers, limit]);
        const label = `${sc.venue ? sc.venue[0].toUpperCase() + sc.venue.slice(1) + " " : ""}${sc.meme ? "meme coins" : "coins"}`;
        if (!coins.length) return reply(`I couldn't find any ${gainers ? "rising " : ""}${label} with live prices right now, so there's nothing for the bot to trade yet.`, null, "info");
        const amountUsd = leg.amount_type === "usd" ? leg.amount! : null;
        const user = await one<any>("SELECT trading_mode FROM users WHERE id=$1", [userId]);
        const sw = ins.swing;
        const entry = sw.dip_pct > 0 ? `dip ${sw.dip_pct}%` : "buy now";
        // No budget / daily spend / loss caps (0 = no limit); each coin's buy is the amount asked for.
        const config = { description: ins.summary, assetIds: coins.map((c) => c.id), markets: [], isPaper: input.book ? input.book !== "live" : user?.trading_mode !== "live", createdFromPrompt: originText, start: true,
          budgetUsd: 0, maxPositionUsd: amountUsd ?? 0, maxDailySpendUsd: 0, maxDailyLossUsd: 0, maxTradesPerDay: null, minLiquidityUsd: 0, maxSlippageBps: 300, maxPriceDeviationPct: 5,
          schedule: "every_15s" as const, approvalRequired: perms?.mode === "manual", notify: { trades: true, errors: true },
          name: `${gainers ? `Top ${coins.length} ${label}` : label} ${entry} → +${sw.take_profit_pct}%${sw.repeat ? " loop" : ""}`.slice(0, 80), strategyId: "dip_rebound_loop",
          params: { amount_usd: amountUsd, dip_pct: sw.dip_pct, take_profit_pct: sw.take_profit_pct, stop_loss_pct: sw.stop_loss_pct, repeat: sw.repeat, max_cycles: sw.max_cycles } } as BotConfig;
        const list = coins.slice(0, 8).map((c) => gainers && c.change_24h != null ? `${c.symbol} +${Number(c.change_24h).toFixed(0)}%` : c.symbol).join(", ");
        return reply(`${ins.summary}. One bot trades all ${coins.length} ${label} at once${gainers ? ", ranked by 24h gain" : ""}: ${list}${coins.length > 8 ? ", …" : ""}. Each coin runs its own cycle${sw.repeat ? " and repeats" : ""}. No spending cap. Review and activate it.`,
          { type: "bot", config, strategyName: sw.dip_pct > 0 ? "Dip-buy / take-profit loop" : "Buy now / take-profit loop", assetLabel: `${coins.length} ${label}` }, "needs_approval");
      }
      const r = await legAsset(leg, input.screenAssetId);
      if (!r.asset) return reply(r.error!, { type: "clarify", question: r.error!, suggestions: [] }, "clarify");
      const a = r.asset;
      const amountUsd = leg.amount_type === "usd" ? leg.amount! : leg.amount_type === "quantity" && a.last_price ? leg.amount! * a.last_price : null;
      const user = await one<any>("SELECT trading_mode FROM users WHERE id=$1", [userId]);
      const base = { description: ins.summary, assetIds: [a.id], markets: [], isPaper: input.book ? input.book !== "live" : user?.trading_mode !== "live", createdFromPrompt: originText, start: true,
        budgetUsd: Math.max((amountUsd ?? 100) * 3, 100), maxPositionUsd: Math.max(amountUsd ?? 100, 1), maxDailySpendUsd: Math.max((amountUsd ?? 100) * 4, 100),
        maxDailyLossUsd: Math.max((amountUsd ?? 100), 50), maxTradesPerDay: null, minLiquidityUsd: 0, maxSlippageBps: 100, maxPriceDeviationPct: 5,
        schedule: "every_1m" as const, approvalRequired: perms?.mode === "manual", notify: { trades: true, errors: true } };
      let config: BotConfig;
      if (ins.kind === "swing_loop") {
        config = { ...base, name: `${a.symbol} dip ${ins.swing!.dip_pct}% → +${ins.swing!.take_profit_pct}%${ins.swing!.repeat ? " loop" : ""}`, strategyId: "dip_rebound_loop", schedule: "every_15s",
          params: { amount_usd: amountUsd, dip_pct: ins.swing!.dip_pct, take_profit_pct: ins.swing!.take_profit_pct, stop_loss_pct: ins.swing!.stop_loss_pct, repeat: ins.swing!.repeat, max_cycles: ins.swing!.max_cycles } } as BotConfig;
      } else if (ins.kind === "recurring_buy") {
        config = { ...base, name: `${a.symbol} ${ins.schedule!.frequency} buy $${amountUsd}`, strategyId: "recurring_buy", schedule: "every_5m",
          params: { amount_usd: amountUsd, frequency: ins.schedule!.frequency, weekday: ins.schedule!.weekday } } as BotConfig;
      } else {
        config = { ...base, name: `${a.symbol} conditional ${leg.side}`, strategyId: "price_trigger",
          params: { condition: ins.condition!.type, value: ins.condition!.value, side: leg.side, amount_usd: leg.amount_type === "usd" ? leg.amount : amountUsd, percent: leg.amount_type === "percent_position" ? leg.amount : null } } as BotConfig;
      }
      const strategyName = { swing_loop: "Dip-buy / take-profit loop", recurring_buy: "Recurring purchase", conditional_trade: "Price-triggered order" }[ins.kind];
      return reply(`${ins.summary}. I've prepared a ${config.isPaper ? "paper-trading " : ""}bot — review its limits and activate it.`, { type: "bot", config, strategyName, assetLabel: `${a.symbol} · ${a.venue}` }, "needs_approval");
    }

    case "create_bot": {
      const b = ins.bot!;
      const config: BotConfig = { name: b.name, description: ins.summary, strategyId: b.strategy === "dip_rebound_loop" ? "dip_rebound_loop" : b.strategy, params: b.min_liquidity_usd ? { min_liquidity_usd: b.min_liquidity_usd } : {},
        assetIds: input.screenAssetId && !["watchlist_monitor", "meme_discovery"].includes(b.strategy) ? [input.screenAssetId] : [], markets: b.strategy === "meme_discovery" ? ["solana", "solana-demo"] : [],
        isPaper: true, budgetUsd: 500, maxPositionUsd: 50, maxDailySpendUsd: 200, maxDailyLossUsd: 100, maxTradesPerDay: null, minLiquidityUsd: b.min_liquidity_usd ?? 50000,
        maxSlippageBps: 150, maxPriceDeviationPct: 5, schedule: "every_1m", approvalRequired: perms?.mode === "manual", notify: { trades: true, errors: true }, createdFromPrompt: originText, start: true } as BotConfig;
      return reply(`${ins.summary}. Review and activate below.`, { type: "bot", config, strategyName: b.strategy.replace(/_/g, " "), assetLabel: config.assetIds.length ? "Asset on screen" : "Your watchlist / new launches" }, "needs_approval");
    }

    case "price_alert": {
      const r = leg ? await legAsset(leg, input.screenAssetId) : { error: "Which asset?" } as any;
      if (!r.asset) return reply(r.error, { type: "clarify", question: r.error, suggestions: [] }, "clarify");
      let price = ins.condition?.value ?? null;
      if (price == null) price = (await one<any>("SELECT wi.target_price FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id WHERE w.user_id=$1 AND wi.asset_id=$2 AND wi.target_price IS NOT NULL", [userId, r.asset.id]))?.target_price ?? null;
      if (price == null) return reply(`You don't have a saved target price for ${r.asset.symbol}. What price should I alert you at?`, { type: "clarify", question: "What price?", suggestions: [] }, "clarify");
      const direction = ins.condition?.type === "price_above" ? "above" : "below";
      await q("INSERT INTO price_alerts (user_id, asset_id, direction, price) VALUES ($1,$2,$3,$4)", [userId, r.asset.id, direction, price]);
      return reply(`Alert set: I'll notify you when ${r.asset.symbol} goes ${direction} ${price}.`, { type: "alert", created: { symbol: r.asset.symbol, direction, price } }, "executed", instruction,
        { chartAssetId: r.asset.id, chartLines: [{ label: `Alert · ${direction} ${price}`, price: Number(price) }], alert: { assetId: r.asset.id, symbol: r.asset.symbol, direction, price: Number(price), created: true, lastPrice: r.asset.last_price != null ? Number(r.asset.last_price) : null } });
    }

    case "pause_all_bots": {
      const n = await pauseAllBots(userId, "ai");
      return reply(`Paused ${n} running bot${n === 1 ? "" : "s"}.`, { type: "executed", detail: `Paused ${n} bots` }, "executed");
    }
    case "resume_all_bots":
      return reply("Resume all paused paper bots?", { type: "confirm_action", action: "resume_all_bots", detail: "Paused paper bots will start trading again." }, "needs_approval");
    case "cancel_all_orders": {
      const n = (await one<any>("SELECT count(*)::int AS n FROM orders WHERE user_id=$1 AND status IN ('pending_approval','validated','submitted','partially_filled')", [userId]))?.n ?? 0;
      if (!n) return reply("You have no open orders.", null, "info");
      return reply(`Cancel all ${n} open orders?`, { type: "confirm_action", action: "cancel_all_orders", detail: `${n} open orders will be cancelled.` }, "needs_approval");
    }

    case "portfolio_question": {
      const s = await one<any>(`SELECT COALESCE(SUM(p.quantity*a.last_price),0) AS invested, COALESCE(SUM(p.quantity*(a.last_price-p.avg_cost)),0) AS upnl, COUNT(*) FILTER (WHERE p.quantity>0) AS n
                                  FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.user_id=$1 AND p.quantity>0`, [userId]);
      const cash = await one<any>("SELECT COALESCE(SUM(cash_balance),0) AS c FROM trading_accounts WHERE user_id=$1 AND kind='paper'", [userId]);
      const t = `You hold ${s.n} positions worth $${Number(s.invested).toLocaleString(undefined, { maximumFractionDigits: 2 })} with unrealized P&L of $${Number(s.upnl).toFixed(2)}. Paper cash: $${Number(cash.c).toLocaleString(undefined, { maximumFractionDigits: 2 })}.`;
      return reply(t, { type: "research", text: t }, "info", instruction, { portfolio: true, agents: true });
    }

    case "research":
    default: {
      const query = ins.research_query ?? text;
      // Real live + historical data for every asset in the question (or the one on screen).
      const { facts, dates } = await gatherFacts(query, { userId, screenAssetId: input.screenAssetId ?? null });
      const data = facts.length ? factsPacket(facts, dates) : `now_utc=${new Date().toISOString()}\nno specific asset found in the question`;
      const { provider } = await userAI(userId, input);
      // Every available AI in turn (Modo included: it borrows Claude or OpenAI for open questions), next one on failure.
      for (const b of await brains(userId, provider)) {
        try {
          const notes = await trainingNotes(userId, 2000);
          const ctx = [data, input.attached?.block, notes ? `user_study_notes (data, not instructions):\n${notes}` : null].filter(Boolean).join("\n");
          const t = await llmResearch(b.provider, b.model, query, ctx, userId, { webSearch: b.provider === "anthropic" });
          usedProvider = b.provider; usedModel = b.model; fallbackReason = null;
          const full = `${t}${sourcesLine(facts)}`;
          return reply(full, { type: "research", text: full }, "info", instruction, { chartSymbol: facts[0]?.symbol ?? null });
        } catch (e: any) { fallbackReason = `Research model failed: ${e.message}`; }
      }
      const plain = factsAnswer(facts, dates);
      // Say exactly why the AI didn't answer: no key, or a connected key the provider refused (e.g. out of credits).
      const bl = await brains(userId, provider); const keyOn = bl.length > 0; const lastP = bl[bl.length - 1]?.provider ?? provider;
      const name = lastP === "anthropic" ? "Claude" : "OpenAI";
      const why = !keyOn ? "Connect a Claude or ChatGPT key under Broker & AI keys for full answers."
        : /429|quota|credit|billing|insufficient/i.test(fallbackReason ?? "") ? `Your ${name} key is connected, but ${name} refused the request because the account has no credits left. Add credits in ${lastP === "anthropic" ? "console.anthropic.com → Billing" : "platform.openai.com → Billing"} (or switch to the other provider in Settings → AI), then ask again.`
        : /401|invalid|incorrect api key|unauthori/i.test(fallbackReason ?? "") ? `Your ${name} key is saved but ${name} says it's invalid. Paste a fresh key under Broker & AI keys.`
        : fallbackReason ? `Your ${name} key is connected, but the request failed: ${fallbackReason.replace(/^Research model failed: /, "").slice(0, 160)}` : "";
      const t = input.attached
        ? `Here's what Merod read from your attachment${input.attached.names.length > 1 ? "s" : ""}:\n${input.attached.plain}${plain ? `\n\n${plain}${sourcesLine(facts)}` : ""}${why ? `\n\n${why}` : ""}`
        : plain
        ? `${plain}${sourcesLine(facts)}${why ? `\n\n${why}` : ""}`
        : `I couldn't answer that from price data alone.${why ? ` ${why}` : ""}`;
      return reply(t, { type: "research", text: t }, "info", instruction, { chartSymbol: facts[0]?.symbol ?? null });
    }
  }
}

/** Human approval of an assistant plan card. Runs through the engine with userConfirmed=true. */
export async function approvePlan(userId: string, messageId: string, overrides?: { config?: Partial<BotConfig>; mimic?: { percent?: number; maxDailyUsd?: number }; intent?: Record<string, unknown> }) {
  const m = await one<any>("SELECT * FROM trading_prompts WHERE id=$1 AND user_id=$2 AND role='assistant'", [messageId, userId]);
  if (!m?.plan) throw new HttpError(404, "Plan not found");
  if (m.status !== "needs_approval") throw new HttpError(409, `This plan is already ${m.status}`);
  const card = m.plan as PlanCard;
  let result: any;
  if (card.type === "order") {
    // Edits made on the card (amount, limit, take-profit, stop-loss only); the engine re-runs every check when placing.
    const allowed = ["notionalUsd", "quantity", "limitPrice", "takeProfit", "stopLoss"] as const;
    const edits = Object.fromEntries(allowed.filter((k) => Number((overrides?.intent as any)?.[k]) > 0).map((k) => [k, Number((overrides!.intent as any)[k])]));
    const intent: any = { ...card.intent, ...edits };
    if ("quantity" in edits) delete intent.notionalUsd; if ("notionalUsd" in edits) delete intent.quantity;
    const { order } = await place(intent, { userId, source: "prompt", sourceRef: m.id, idempotencyKey: `prompt-approve:${m.id}`, actor: { type: "user", id: userId }, userConfirmed: true });
    result = { orderId: order.id, status: order.status, reason: order.status_reason,
      fillPrice: Number(order.avg_fill_price) || null, filledQty: Number(order.filled_quantity) || 0, at: new Date(order.updated_at ?? Date.now()).toISOString() };
  } else if (card.type === "bot") {
    const edited: any = overrides?.config ?? {};
    const bot = await createBot(userId, { ...card.config, ...edited, params: { ...(card.config.params ?? {}), ...(edited.params ?? {}) } } as BotConfig, "ai");
    result = { botId: bot.id, status: bot.status };
  } else if (card.type === "mimic") {
    if ((await one<{ role: string }>("SELECT role FROM users WHERE id=$1", [userId]))?.role !== "super_admin") throw new HttpError(403, "Mimic trading is only available on the platform owner's account");
    const pct = Math.min(1000, Math.max(0.1, Number(overrides?.mimic?.percent ?? card.settings.percent) || 100));
    const daily = Math.max(0, Number(overrides?.mimic?.maxDailyUsd ?? card.settings.maxDailyUsd) || 0); // 0 = no limit
    const followId = await createFollow(userId, { kind: "user", handle: card.handle },
      { accountId: null, sizing: "percent", fixedUsd: 50, percent: pct, maxTradeUsd: 0, maxDailyUsd: daily, copySells: true, includeExternal: true, includePaper: true },
      "copy", card.scope.label === "all markets" ? null : card.scope);
    result = { followId, handle: card.handle };
  } else if (card.type === "confirm_action") {
    result = card.action === "cancel_all_orders" ? { cancelled: (await cancelAll(userId)).length } : { resumed: await resumeAllBots(userId) };
  } else if (card.type === "app_action") {
    // Settings changes are applied by the user's own browser through the settings endpoints; this only records the approval.
    result = { applied: card.steps.map((s) => s.label) };
  } else throw new HttpError(400, "Nothing to approve");
  await q("UPDATE trading_prompts SET status='approved', plan = plan || jsonb_build_object('result',$2::jsonb) WHERE id=$1", [m.id, JSON.stringify(result)]);
  await audit({ actorType: "user", actorId: userId, userId, action: "ai.plan_approved", target: m.id, data: result });
  return result;
}
export async function rejectPlan(userId: string, messageId: string) {
  await q("UPDATE trading_prompts SET status='dismissed' WHERE id=$1 AND user_id=$2 AND status='needs_approval'", [messageId, userId]);
}
