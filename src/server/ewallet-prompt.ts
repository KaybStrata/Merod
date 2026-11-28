import "@/lib/server-only-shim";
import { q } from "./db";
import { listWallets, findWallet, createWallet, addRule, moveMoney } from "./ewallets";

/**
 * Prompt box for e-wallets:
 *   "create an e-wallet called Savings (goal $5,000)"
 *   "send 20% of all my profits to Savings" · "put 50% of SOL Momentum's profits into Vacation" · "10% of Mimic profits to Tax"
 *   "stop sending profits to Savings" · "move $200 from Savings to trading" · "move $100 from trading to Savings"
 *   "move $50 from Savings to Vacation" · "show my e-wallets" · "how much is in Savings?"
 */
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`;
const amt = (t: string) => { const m = t.match(/\$\s*([\d,]+(?:\.\d+)?k?)|([\d,]+(?:\.\d+)?k?)\s*(?:\$|usd|dollars?)/i); if (!m) return null; const r = (m[1] ?? m[2]).replace(/,/g, ""); return r.endsWith("k") ? Number(r.slice(0, -1)) * 1000 : Number(r); };
const TRADING = /\b(trading|my account|paper account|trading cash|cash|portfolio|buying power)\b/i;

export async function ewalletCommand(userId: string, raw: string): Promise<string | null> {
  const t = raw.trim();
  const wallets = await q<any>("SELECT id, name FROM e_wallets WHERE user_id=$1", [userId]);
  const nameIn = (s: string) => wallets.filter((w) => new RegExp(`\\b${w.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s)).sort((a, b) => b.name.length - a.name.length)[0];
  const mentionsEw = /\be-?wallets?\b|\be wallets?\b/i.test(t);
  const mentionsKnown = !!nameIn(t);
  if (!mentionsEw && !(mentionsKnown && /\b(profits?|move|transfer|send|put|channel|route|how much|balance|stop)\b/i.test(t))) return null;

  // Show / balance
  if (/^(show|list|what are|view|see)\b|\bhow much\b|\bbalances?\b/i.test(t) && !/\b(move|transfer|send|put|channel|route)\b/i.test(t)) {
    const all = await listWallets(userId);
    const pick = nameIn(t);
    const list = pick ? all.filter((w) => w.id === pick.id) : all;
    if (!list.length) return "You don't have any e-wallets yet. Say “create an e-wallet called Savings”, then “send 20% of all my profits to Savings”.";
    return list.map((w) => {
      const rules = w.rules.filter((r: any) => r.active).map((r: any) => `${r.percent}% of ${r.scope === "all" ? "all profits" : `${r.scope_label ?? r.scope} profits`}`);
      return `${w.name}: ${money(w.balance)}${w.earmarked ? ` (+ ${money(w.earmarked)} of real-money profit set aside at your broker)` : ""}${w.goal_usd ? ` · goal ${money(w.goal_usd)} (${Math.min(100, Math.round(((w.balance + w.earmarked) / w.goal_usd) * 100))}%)` : ""}${rules.length ? ` · receives ${rules.join(", ")}` : " · no profit rules yet"}`;
    }).join("\n");
  }

  // Create
  let m = t.match(/\b(?:create|make|add|open|set up|new)\b\s+(?:an?\s+|a new\s+)?e-?\s?wallet\s*(?:called|named|for)?\s*["“']?([^"”',.(]+?)["”']?(?:\s*\(?\s*(?:with\s+)?(?:a\s+)?goal(?:\s+of)?\s*\$?\s*([\d,]+(?:\.\d+)?k?))?\s*\)?\s*$/i)
    ?? t.match(/\b(?:create|make|add|open|set up|new)\b\s+["“']?([^"”',.]+?)["”']?\s+e-?\s?wallet\b(?:.*goal(?:\s+of)?\s*\$?\s*([\d,]+(?:\.\d+)?k?))?/i);
  if (m && !/\b\d+(?:\.\d+)?\s*%/.test(t)) {
    const goal = m[2] ? (m[2].toLowerCase().endsWith("k") ? Number(m[2].slice(0, -1).replace(/,/g, "")) * 1000 : Number(m[2].replace(/,/g, ""))) : null;
    const w = await createWallet(userId, m[1], goal);
    return `E-wallet “${w.name}” is ready${w.goal_usd ? ` with a goal of ${money(Number(w.goal_usd))}` : ""}. Send profits to it with “send 20% of all my profits to ${w.name}”, or move money in with “move $100 from trading to ${w.name}”.`;
  }

  // Stop rules
  if (/\b(stop|pause|turn off|cancel|no more)\b/i.test(t) && /\bprofits?\b/i.test(t)) {
    const w = nameIn(t);
    const r = await q<any>(`UPDATE e_wallet_rules SET active=false WHERE user_id=$1 AND active ${w ? "AND wallet_id=$2" : ""} RETURNING id`, w ? [userId, w.id] : [userId]);
    return r.length ? `Stopped ${r.length} profit rule${r.length === 1 ? "" : "s"}${w ? ` for ${w.name}` : ""}. Money already in your e-wallets stays there.` : "There were no active profit rules to stop.";
  }

  // Profit rule: "send 20% of (all) (my) (SOL Momentum's|bot X|mimic) profits to Savings"
  const pct = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct && /\bprofits?|gains?|winnings?\b/i.test(t)) {
    const toName = t.match(/\b(?:to|into|in)\s+(?:my\s+|the\s+)?["“']?([^"”',.]+?)["”']?(?:\s+e-?\s?wallet)?\s*$/i)?.[1]?.trim();
    let w = nameIn(t) ?? (toName ? await findWallet(userId, toName) : null);
    if (!w && toName) w = await createWallet(userId, toName.replace(/\s+e-?\s?wallet$/i, ""));
    if (!w) return "Which e-wallet should get the profits? e.g. “send 20% of all my profits to Savings”.";
    const p = Number(pct[1]);
    // Scope: a named bot/agent, a kind of trading (Mimic, Auto, manual…), or all.
    const bots = await q<any>("SELECT id, name, 'bot' AS kind FROM trading_bots WHERE user_id=$1 UNION ALL SELECT id, name, 'agent' FROM agents WHERE user_id=$1", [userId]);
    const named = bots.filter((b) => b.name.length > 2 && t.toLowerCase().includes(b.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
    const SRC: [RegExp, string, string][] = [[/\b(mimic|copy)\b/i, "copy", "Mimic"], [/\bauto\b/i, "auto", "Auto trading"], [/\b(manual|my own)\b/i, "manual", "manual trades"], [/\bprompts?\b/i, "prompt", "prompt trades"], [/\bsignal\b/i, "signal", "signal bots"]];
    const src = SRC.find(([re]) => re.test(t));
    const rule = named ? await addRule(userId, w.id, { percent: p, scope: named.kind, scopeRef: named.id, scopeLabel: named.name })
      : src ? await addRule(userId, w.id, { percent: p, scope: "source", scopeRef: src[1], scopeLabel: src[2] })
      : await addRule(userId, w.id, { percent: p, scope: "all" });
    const what = named ? `${named.name}'s profits` : src ? `${src[2]} profits` : "all your profits";
    return `Done: from now on, ${p}% of ${what} goes to “${w.name}” after every winning sell (${rule.scope === "all" ? "every bot, agent and trade" : "only that source"}). Paper profits move out of trading cash into the e-wallet; real-money profits are set aside there and stay in your broker account.`;
  }

  // Move money
  const a = amt(t);
  if (a && /\b(move|transfer|send|put|take|withdraw)\b/i.test(t)) {
    const fm = t.match(/\bfrom\s+(?:my\s+|the\s+)?(.+?)\s+(?:to|into)\s+(?:my\s+|the\s+)?(.+?)\s*$/i);
    let fromS = fm?.[1] ?? "", toS = fm?.[2] ?? "";
    if (!fm) { const tm = t.match(/\b(?:to|into)\s+(?:my\s+|the\s+)?(.+?)\s*$/i); toS = tm?.[1] ?? ""; fromS = "trading"; }
    const wf = nameIn(fromS), wt = nameIn(toS);
    const from = wf ? { wallet: wf.id } : TRADING.test(fromS) ? { trading: true } : null;
    const to = wt ? { wallet: wt.id } : TRADING.test(toS) ? { trading: true } : null;
    if (!from || !to) return "Say where from and to, e.g. “move $200 from Savings to trading”, “move $100 from trading to Savings” or “move $50 from Savings to Vacation”.";
    const r = await moveMoney(userId, { from, to, amount: a });
    return `Moved ${money(r.amount)} from ${r.from} to ${r.to}.`;
  }
  return mentionsEw ? "E-wallets hold money set aside from your profits. Try “create an e-wallet called Savings”, “send 20% of all my profits to Savings”, “move $100 from Savings to trading” or “show my e-wallets”." : null;
}
