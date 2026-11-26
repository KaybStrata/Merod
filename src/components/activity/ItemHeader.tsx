import { cx } from "@/components/ui";

export type FeedCoin = { symbol: string; price?: number; move?: number | null; basis?: string };
const px = (n: number) => n >= 1 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : `$${n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "")}`;

/**
 * Header of an Activity line. A bot line about one coin headlines that coin — symbol, live price and its move
 * (▲/▼ since the bot bought it, or over 24h) — with the bot's name small after it, so a bot trading many coins
 * shows each coin's own movement instead of repeating the bot's name.
 */
export function ItemHeader({ actor, coin, className }: { actor: string; coin?: FeedCoin | null; className?: string }) {
  if (!coin) return <span className={cx("truncate font-semibold text-text", className)}>{actor}</span>;
  const m = coin.move;
  const has = m !== null && m !== undefined && Number.isFinite(m);
  return (
    <span className={cx("flex min-w-0 items-center gap-1.5", className)}>
      <span className="shrink-0 font-semibold text-text">{coin.symbol}</span>
      {coin.price !== undefined && Number.isFinite(coin.price) && <span className="num shrink-0 text-muted">{px(coin.price)}</span>}
      {has && (
        <span title={coin.basis === "since buy" ? "Change since the bot bought it" : "24-hour change"}
          className={cx("num shrink-0 rounded px-1 text-[10px] font-semibold", m! > 0 ? "bg-up/15 text-up" : m! < 0 ? "bg-down/15 text-down" : "bg-panel-2 text-muted")}>
          {m! > 0 ? "▲" : m! < 0 ? "▼" : "•"} {Math.abs(m!).toFixed(2)}%{coin.basis === "since buy" ? " since buy" : " 24h"}
        </span>
      )}
      <span className="min-w-0 truncate font-normal text-faint">· {actor}</span>
    </span>
  );
}
