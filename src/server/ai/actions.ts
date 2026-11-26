/**
 * App actions from the prompt box: change settings, turn things on/off, open pages.
 * The server only PROPOSES the change as a card. The change itself is made by the user's own browser when they press
 * Approve, through the normal authenticated settings endpoints. The AI has no code path that writes settings itself.
 */
export type ActionStep =
  | { op: "settings"; section: "risk" | "automation" | "theme"; values: Record<string, unknown>; label: string }
  | { op: "auto"; body: Record<string, unknown>; label: string }
  | { op: "bots_allow_risky"; value: boolean; label: string };
export type AppAction = { title: string; steps: ActionStep[]; link?: { href: string; label: string } } | { title: string; steps: []; link: { href: string; label: string }; navigateOnly: true };

const num = (s: string) => Number(s.replace(/[,$\s]/g, ""));
const money = (t: string, re: RegExp) => { const m = t.match(re); return m ? num(m[1]) : null; };
const OFF = /\b(off|disable|disabled|stop|turn (it )?off|remove|no|none|zero|0|lower|turn down|allow|ignore|skip|bypass|without)\b/;
const ON = /\b(on|enable|enabled|start|turn (it )?on|block|raise|turn up|strict)\b/;

const PAGES: [RegExp, string, string][] = [
  [/\b(home|dashboard)\b/, "/", "Home"], [/\bask merod|chat\b/, "/ai", "Ask Merod"], [/\b(markets?|heat ?map|discover)\b/, "/discover", "Markets"],
  [/\b(trade|terminal|order ticket)\b/, "/trade", "Trade"], [/\b(wallets?|funds?|deposit|withdraw)\b/, "/wallet", "Wallet & Funds"], [/\bmeme ?radar|radar\b/, "/radar", "Meme Radar"],
  [/\bagents?\b/, "/agents", "Agents"], [/\bbots?\b/, "/bots", "Bots"], [/\bstrateg(y|ies)\b/, "/strategies", "Strategies"],
  [/\bmodo activity\b/, "/modo/activity", "Modo activity"], [/\bauto ?trad(e|ing) activity\b/, "/auto/activity", "Auto trade activity"], [/\bauto ?trading\b/, "/auto", "Auto trading"],
  [/\bmimic|copy trad/, "/mimic", "Mimic"], [/\bshortcuts?\b/, "/shortcuts", "Shortcuts"], [/\b(purchase history|sold|profits?|activity|live)\b/, "/live", "Activity"],
  [/\b(analytics|performance|portfolio)\b/, "/analytics", "Portfolio performance"], [/\bresearch|news\b/, "/research", "Research"], [/\b(ai )?learning|teach\b/, "/learning", "AI Learning"],
  [/\bsocial|floor\b/, "/social", "The Floor"], [/\balerts?|notifications?\b/, "/alerts", "Alerts"], [/\b(api )?keys|broker\b/, "/broker-keys", "Broker & AI keys"],
  [/\bsettings|security|2fa\b/, "/settings", "Settings"], [/\btalk mode|talk\b/, "/talk", "Talk mode"],
];

export function parseAppAction(raw: string): AppAction | null {
  const t = raw.toLowerCase().replace(/\s+/g, " ").trim();
  // Navigation first: "open mimic", "go to settings", "show me my purchase history".
  const nav = t.match(/^(?:please\s+)?(?:open|go to|goto|take me to|navigate to|show(?: me)?(?: my| the)?|bring up)\s+(.+)$/);
  if (nav) for (const [re, href, label] of PAGES) if (re.test(nav[1])) return { title: `Open ${label}`, steps: [], link: { href, label }, navigateOnly: true };

  const tradeVerb = /\b(buy|sell|short|purchase|swap)\b/.test(t) && !/\b(risk|limit|setting|flag|reject)\b/.test(t);
  if (tradeVerb) return null;

  const steps: ActionStep[] = [];
  // Risk flagging / rejections / liquidity screening.
  // "confidence" (auto trading / Modo's confidence bar) → force trading ignores the bar.
  if (/\bconfidence\b[^.]{0,40}\b(flag|flags|flagging|check|checks|bar|filter|factor)\b|\b(flag|flagging)\b[^.]{0,20}\bconfidence\b/.test(t) || /\bconfidence\b/.test(t) && /\brisk\b/.test(t)) {
    const off = OFF.test(t) && !/\b(turn (it )?on|enable)\b/.test(t);
    steps.push({ op: "auto", body: { forceTrading: off }, label: off ? "Force trading on: auto trading and Modo ignore the confidence bar" : "Force trading off: auto trading and Modo use the confidence bar again" });
  }
  if (/\b(risk|confidence)\b[^.]{0,40}\b(flag|flags|flagging|factor|screen|screening|check|checks)\b|\b(rejects?|rejections?|rejecting|flagged|risky (coins?|tokens?)|token screening|liquidity (min|minimum|limit|check|filter))\b/.test(t)) {
    const off = OFF.test(t) && !/\b(turn (it )?on|enable|block)\b/.test(t);
    const on = !off && ON.test(t);
    if (off || on) {
      steps.push({ op: "settings", section: "risk", values: { block_risky_tokens: !off, min_liquidity_usd: off ? 0 : 50000 }, label: off ? "Allow flagged coins (new listing, unverified, low liquidity) and remove the minimum liquidity" : "Block flagged coins again and require $50,000 liquidity" });
      steps.push({ op: "bots_allow_risky", value: off, label: off ? "Set every bot to never reject trades" : "Turn risk rejections back on for every bot" });
    }
  }
  // Slippage: "max slippage 3%", "slippage to 250 bps".
  const slip = t.match(/slippage[^0-9]*(\d+(?:\.\d+)?)\s*(%|bps|basis points)?/);
  if (slip) { const bps = Math.round(slip[2] === "%" || !slip[2] ? Number(slip[1]) * (slip[2] === "%" || Number(slip[1]) <= 50 ? 100 : 1) : Number(slip[1])); if (bps >= 1 && bps <= 5000) steps.push({ op: "settings", section: "risk", values: { max_slippage_bps: bps }, label: `Max slippage ${bps / 100}%` }); }
  // Limits: "no limits", "max order $500", "daily spend 1000", "daily loss limit $200".
  if (/\b(no|remove|unlimited|zero|0)\b.*\blimits?\b|\blimits?\b.*\b(off|none|unlimited|to 0|zero)\b/.test(t))
    steps.push({ op: "settings", section: "risk", values: { max_order_usd: 0, max_daily_spend_usd: 0, max_daily_loss_usd: 0 }, label: "No order, daily spend or daily loss limit" });
  const maxOrder = money(t, /max(?:imum)? order(?: size)?(?: to| of| at)?\s*\$?\s*([\d,.]+)/); if (maxOrder != null) steps.push({ op: "settings", section: "risk", values: { max_order_usd: maxOrder }, label: maxOrder ? `Max order $${maxOrder}` : "No max order size" });
  const dSpend = money(t, /daily (?:spend|spending|buy)(?: limit)?(?: to| of| at)?\s*\$?\s*([\d,.]+)/); if (dSpend != null) steps.push({ op: "settings", section: "risk", values: { max_daily_spend_usd: dSpend }, label: dSpend ? `Daily spend $${dSpend}` : "No daily spend limit" });
  const dLoss = money(t, /daily loss(?: limit| stop)?(?: to| of| at)?\s*\$?\s*([\d,.]+)/); if (dLoss != null) steps.push({ op: "settings", section: "risk", values: { max_daily_loss_usd: dLoss }, label: dLoss ? `Daily loss stop $${dLoss}` : "No daily loss stop" });
  // Automation mode.
  if (/\b(manual|ask me|approve every|approval for every)\b/.test(t) && /\b(mode|trades?|orders?|approv)/.test(t)) steps.push({ op: "settings", section: "automation", values: { mode: "manual" }, label: "Every trade needs your approval" });
  else if (/\b(auto(matically)?|without asking|no approval|don.t ask)\b/.test(t) && /\b(approv|execute|place|mode)\b/.test(t)) steps.push({ op: "settings", section: "automation", values: { mode: "auto_within_limits" }, label: "Execute automatically within your limits" });
  // Auto trading / Modo Autopilot / force trading on-off.
  const onOff = (re: RegExp) => (re.test(t) ? (/\b(off|stop|disable|pause|turn (it )?off)\b/.test(t) ? false : /\b(on|start|enable|turn (it )?on|resume)\b/.test(t) ? true : null) : null);
  const auto = onOff(/\bauto ?trad(e|ing)\b/); if (auto != null && !/activity/.test(t)) steps.push({ op: "auto", body: { enabled: auto }, label: auto ? "Turn auto trading on" : "Turn auto trading off" });
  const modo = onOff(/\bmodo( autopilot)?\b/); if (modo != null && !/activity/.test(t)) steps.push({ op: "auto", body: { modoAutopilot: modo }, label: modo ? "Turn Modo Autopilot on" : "Turn Modo Autopilot off" });
  const force = onOff(/\bforce trad(e|ing)\b/); if (force != null) steps.push({ op: "auto", body: { forceTrading: force }, label: force ? "Turn force trading on" : "Turn force trading off" });
  // Risk dial and custom exits for auto trading / Modo: "risk level 80", "per trade $50", "take profit 10%", "stop loss 3%".
  const lvl = t.match(/risk (?:level|dial)(?: to| at)?\s*(\d{1,3})/); if (lvl) { const n = Math.max(1, Math.min(100, Number(lvl[1]))); steps.push({ op: "auto", body: { riskMode: true, riskLevel: n }, label: `Risk dial at ${n}` }); }
  const per = money(t, /(?:per trade|each trade|trade size)(?: to| of| at)?\s*\$?\s*([\d,.]+)/); if (per) steps.push({ op: "auto", body: { customTradeUsd: per }, label: `$${per} per auto trade` });
  const tp = t.match(/take ?profit(?: to| at| of)?\s*(\d+(?:\.\d+)?)\s*%?/); if (tp) steps.push({ op: "auto", body: { customTakeProfitPct: Number(tp[1]) }, label: `Take profit +${tp[1]}% on auto trades` });
  const sl = t.match(/stop ?loss(?: to| at| of)?\s*(\d+(?:\.\d+)?)\s*%?/); if (sl && Number(sl[1]) > 0) steps.push({ op: "auto", body: { customStopLossPct: Number(sl[1]) }, label: `Stop loss −${sl[1]}% on auto trades` });
  // Theme.
  if (/\b(light|dark) (mode|theme)\b/.test(t)) { const th = /\blight\b/.test(t) ? "light" : "dark"; steps.push({ op: "settings", section: "theme", values: { theme: th }, label: `${th === "light" ? "Light" : "Dark"} theme` }); }

  if (!steps.length) return null;
  return { title: steps.length === 1 ? steps[0].label : `${steps.length} changes`, steps };
}
