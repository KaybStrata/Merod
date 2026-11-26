import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { q } from "@/server/db";

/**
 * Type-ahead for the prompt box: completions built from YOUR real data — coins you hold or your bots trade, top movers,
 * your bot/agent names, your own past prompts — plus templates for everything Merod understands.
 * Returns full-line suggestions and a `ghost` (the rest of the best match) for inline completion.
 */
const TEMPLATES = [
  "buy $100 of {SYM}", "buy $50 of {SYM} with a 5% stop loss", "sell 25% of {SYM}", "sell all my {SYM}", "alert me if {SYM} drops 5%", "alert me when {SYM} goes above {PX}",
  "analyze {SYM}", "why is {SYM} moving?", "how is my {SYM} trade doing?", "why hasn't {SYM} sold yet?",
  "create a bot that buys {SYM} on a 3% dip and sells at 5% profit, rinse and repeat",
  "buy the top 10 Solana meme coins, $10 each, sell at 2% profit, rinse and repeat",
  "buy the top 20 gainers Solana meme coins, $10 each, sell at 2% profit, rinse and repeat",
  "every morning at 2am Los Angeles time, buy the top 10 most profitable Solana meme coins and sell on a 1% loop",
  "every weekday at 9:30am New York time, buy $100 of {SYM}",
  "create a stop loss for all bots/agents at -8%", "set take profit to 5% on all bots", "all bots $20 per trade", "only sell when profitable", "allow selling at a loss again",
  "@{BOT} turn off", "turn on @{BOT}", "how is {BOT} doing?", "set take profit to 5% on {BOT}", "add a 3% stop loss to {BOT}",
  "create a skill: always use a 5% stop loss and only sell in profit", "create a skill: never buy coins with under $100k liquidity", "show my skills", "show my schedules", "cancel schedule 1",
  "create 3 agents that trade Solana meme coins", "mimic the top 10 Solana wallets this week", "mimic the top 50 stock and crypto traders this week",
  "how is my portfolio doing?", "how are my bots doing?", "how are my agents doing?", "what's my P&L today?", "what did I buy today?", "why was my order cancelled?",
  "show my open orders", "pause all bots", "resume all bots", "cancel all open orders", "turn off risk flagging", "stop asking me to approve trades",
];

export const GET = route(async (req) => {
  const u = await requireUser();
  const raw = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 300);
  const qy = raw.toLowerCase();
  if (qy.trim().length < 1) return ok({ suggestions: [], ghost: "" });

  const [held, bots, agents, top, recent] = await Promise.all([
    q<any>("SELECT DISTINCT a.symbol, a.last_price FROM positions p JOIN assets a ON a.id=p.asset_id WHERE p.user_id=$1 AND p.quantity>0 LIMIT 30", [u.id]),
    q<any>("SELECT name, asset_ids FROM trading_bots WHERE user_id=$1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT 40", [u.id]),
    q<any>("SELECT name FROM agents WHERE user_id=$1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT 40", [u.id]).catch(() => [] as any[]),
    q<any>("SELECT symbol, last_price FROM assets WHERE last_price IS NOT NULL AND NOT ('demo_data'=ANY(risk_flags)) ORDER BY volume_24h DESC NULLS LAST LIMIT 40"),
    q<any>(`SELECT content, max(created_at) AS at FROM trading_prompts WHERE user_id=$1 AND role='user' AND length(content) BETWEEN 4 AND 300 AND content NOT LIKE '%📎%'
             GROUP BY content ORDER BY at DESC LIMIT 150`, [u.id]),
  ]);
  const botSyms = bots.length ? await q<any>("SELECT DISTINCT symbol, last_price FROM assets WHERE id = ANY($1::uuid[]) LIMIT 30", [bots.flatMap((b) => b.asset_ids ?? []).slice(0, 300)]) : [];
  const symRows = [...held, ...botSyms, ...top];
  const syms = [...new Set(symRows.map((s) => s.symbol as string))].slice(0, 60);
  const price = new Map(symRows.map((s) => [s.symbol, Number(s.last_price)]));
  const names = [...new Set([...bots.map((b) => b.name as string), ...agents.map((a) => a.name as string)])];

  const words = raw.split(/\s+/);
  const lastWord = words[words.length - 1] ?? "";
  const head = raw.slice(0, raw.length - lastWord.length);
  const out: string[] = [];
  const push = (s: string) => { if (s.toLowerCase() !== qy && !out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s); };

  // "@na…" → bot / agent names.
  if (lastWord.startsWith("@")) {
    const p = lastWord.slice(1).toLowerCase();
    for (const n of names.filter((n) => n.toLowerCase().startsWith(p) || n.toLowerCase().includes(` ${p}`)).slice(0, 6)) push(`${head}@${n} `);
  }
  // Your own past prompts that start the same way.
  for (const r of recent) if (String(r.content).toLowerCase().startsWith(qy)) push(r.content);
  // Templates filled with your real coins and bot names.
  const filled: string[] = [];
  for (const t of TEMPLATES) {
    if (t.includes("{BOT}")) for (const n of names.slice(0, 8)) filled.push(t.replace("{BOT}", n));
    else if (t.includes("{SYM}")) for (const s of syms.slice(0, 24)) filled.push(t.replace("{SYM}", s).replace("{PX}", fmtPx((price.get(s) ?? 0) * 1.1)));
    else filled.push(t);
  }
  for (const f of filled) if (f.toLowerCase().startsWith(qy)) push(f);
  // The word being typed: complete a coin or bot name in place ("buy $100 of bo" → "BONK").
  if (lastWord.length >= 2 && !lastWord.startsWith("@")) {
    const p = lastWord.replace(/^\$/, "").toLowerCase();
    for (const s of syms.filter((s) => s.toLowerCase().startsWith(p) && s.toLowerCase() !== p).slice(0, 3)) push(`${head}${s} `);
    for (const n of names.filter((n) => n.toLowerCase().startsWith(p)).slice(0, 2)) push(`${head}${n} `);
  }
  // Looser matches: templates and past prompts containing what you typed.
  if (out.length < 6 && qy.length >= 3) {
    for (const f of [...recent.map((r) => r.content as string), ...filled]) if (f.toLowerCase().includes(qy)) push(f);
  }
  const suggestions = out.slice(0, 6);
  const best = suggestions.find((s) => s.toLowerCase().startsWith(qy));
  return ok({ suggestions, ghost: best ? best.slice(raw.length) : "" });
});

function fmtPx(n: number) { return !n ? "a price" : n >= 1 ? `$${n.toFixed(n >= 100 ? 0 : 2)}` : `$${n.toPrecision(3)}`; }
