
/**
 * One prompt, many instructions: "buy $50 of SOL and $20 of BONK, mimic the top 20 wallets, then make a bot that …".
 * Splits into separate instructions that each run on their own. Never splits a single instruction that
 * happens to contain "and" ("buy at a 3% dip and sell at +5%", "create 5 agents that buy … and sell …").
 */
const VERBS = "buy|sell|short|mimic|copy|create|make|build|start|set|alert|notify|tell|deploy|launch|spin up|cancel|pause|resume|stop|research|analy[sz]e|show|trade|dca|rebalance|close|watch|send|swap|withdraw";
const verbStart = new RegExp(`^(please\\s+)?(${VERBS})\\b`, "i");

export const isAgentRequest = (t: string) =>
  /\b(create|make|build|spin up|launch|set up|deploy|start|add)\b[^.]*\bagents?\b|\bfleet\b/i.test(t) && !/^(pause|resume|stop)\b/i.test(t.trim());
export const isStrategyRequest = (t: string) => /\b(create|make|build|save|write|design|draft)\b[^.]*\bstrateg(y|ies)\b/i.test(t);


/** "buy $10 of SOL, $20 of BONK and $30 of WIF" → three buys. */
function expandAmountList(t: string): string[] {
  const m = t.match(/^(please\s+)?(buy|sell)\b\s*/i);
  if (!m) return [t];
  const rest = t.slice(m[0].length);
  const items = rest.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)\s*/i).map((s) => s.trim()).filter(Boolean);
  const amountItem = /^(\$\s?\d[\d,.]*|\d[\d,.]*\s?\$|\d[\d,.]*\s*(usd|dollars|%))\s*(of|worth of|in)?\s*\S+/i;
  if (items.length < 2 || !items.every((i) => amountItem.test(i))) return [t];
  return items.map((i) => `${m[2]} ${i}`);
}

export function splitInstructions(text: string): string[] {
  const t = text.trim();
  if (t.length < 12) return [t];
  // 1) Hard separators: new lines, ";", list bullets ("1.", "2)", "-", "•").
  let parts = t.split(/\n+|;\s*|\s+(?=\d{1,2}[.)]\s+[a-z])/i).map((s) => s.replace(/^\s*(\d{1,2}[.)]|[-•*])\s+/, "").trim()).filter(Boolean);
  // 2) Sentences.
  parts = parts.flatMap((p) => p.split(/(?<=[.!?])\s+(?=[a-z])/i).map((s) => s.replace(/[.!]+$/, "").trim()).filter(Boolean));
  // 3) Connectors inside a sentence, unless the sentence is one compound instruction.
  parts = parts.flatMap((p) => {
    const pieces = p.split(new RegExp(`\\s*,?\\s*\\b(?:and then|then|and also|also|plus|after that|as well as)\\b\\s+|\\s*,?\\s+and\\s+(?=(?:please\\s+)?(?:${VERBS})\\b)|,\\s+(?=(?:${VERBS})\\b)`, "i"))
      .map((s) => s.trim()).filter(Boolean);
    if (pieces.length < 2) return [p];
    // Re-attach pieces that only make sense with the previous one:
    // "… and sell (it) at +5%", "… rinse and repeat", "pick the top 20 coins and buy $10 each", "buy at a 3% dip and sell at 5%".
    const out: string[] = [];
    for (const piece of pieces) {
      const prev = out[out.length - 1];
      const refersBack = /^(please\s+)?(sell|take|exit)\b/i.test(piece) && /%/.test(piece) && (/\b(it|them|those|that|each)\b/i.test(piece) || !/\b[A-Z]{2,6}\b/.test(piece.replace(/^(please\s+)?sell/i, "")));
      const continues = !verbStart.test(piece) || /\beach( one)?\b/i.test(piece) && !/\$\s?\d|\d\s?\$/.test(prev ?? "") || (prev != null && /^(please\s+)?(pick|choose|find|select|grab|get|take)\b/i.test(prev));
      if (prev != null && (refersBack || continues)) out[out.length - 1] = `${prev} and ${piece}`;
      else out.push(piece);
    }
    return out;
  });
  // 4) Amount lists under one verb.
  parts = parts.flatMap(expandAmountList);
  return parts.length ? parts : [t];
}
