import "@/lib/server-only-shim";
import { one, q } from "../db";

/** The master "Bot trading" switch (all bots, AI bots, Auton and auto switches). Each bot keeps its own on/off. */
export async function botTradingOn(userId: string) {
  return (await one<any>("SELECT bot_trading FROM risk_settings WHERE user_id=$1", [userId]).catch(() => null))?.bot_trading !== false;
}
export async function setBotTrading(userId: string, on: boolean) {
  await q("UPDATE risk_settings SET bot_trading=$2, updated_at=now() WHERE user_id=$1", [userId, on]);
  const { audit } = await import("../audit");
  await audit({ actorType: "user", actorId: userId, userId, action: on ? "bots.trading_on" : "bots.trading_off" }).catch(() => {});
  const running = await one<{ n: number }>("SELECT count(*)::int AS n FROM trading_bots WHERE user_id=$1 AND status='running'", [userId]);
  return { on, running: running?.n ?? 0 };
}

/** "turn off bot trading", "stop all bot trading", "bot trading on", "enable bot trading" → the master switch. */
export async function botTradingCommand(userId: string, text: string): Promise<string | null> {
  const t = text.toLowerCase();
  if (!/\bbots?[- ]trading\b|\ball bot activity\b/.test(t)) return null;
  const off = /\b(off|stop|disable|pause|halt|kill|deactivate|no more)\b/.test(t);
  const on = /\b(on|start|enable|resume|activate|allow)\b/.test(t);
  if (!off && !on) {
    const live = await botTradingOn(userId);
    return `Bot trading is ${live ? "ON" : "OFF"}. Say “turn bot trading off” or “turn bot trading on”.`;
  }
  const r = await setBotTrading(userId, !off);
  return off
    ? `Bot trading is OFF: no bot, AI bot, Auton or auto switch will trade until you turn it back on. Each bot keeps its own on/off setting (${r.running} set to on), and prompts and your own orders still work.`
    : `Bot trading is ON: the ${r.running} bot${r.running === 1 ? "" : "s"} you have switched on trade again${r.running ? "" : " (turn one on with “turn on <bot name>” or “turn on bots”)"}.`;
}
