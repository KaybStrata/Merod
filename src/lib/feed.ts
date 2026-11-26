/**
 * Keep a live activity list bounded without losing trades: up to half the slots go to trade events
 * (anything with a buy/sell side or a P&L), the rest to status lines, newest first.
 * Without this, a bot that logs every few seconds pushes every buy and sell off the end of the list.
 */
export function capFeed<T extends { at: string; side?: string; pnl?: number }>(list: T[], max: number): T[] {
  const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at));
  const isTrade = (i: T) => i.side !== undefined || i.pnl !== undefined;
  const trades = sorted.filter(isTrade).slice(0, Math.ceil(max / 2));
  const rest = sorted.filter((i) => !isTrade(i)).slice(0, max - trades.length);
  return [...trades, ...rest].sort((a, b) => b.at.localeCompare(a.at));
}
