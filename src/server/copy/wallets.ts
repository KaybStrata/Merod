import "@/lib/server-only-shim";
import { q, one } from "../db";
import { getCredential } from "../providers/credentials";
import { contextFor } from "../providers/integrations";
import { readJson } from "../providers/http";

/**
 * Any wallet address, any number of them, from the prompt box or the Mimic page:
 *  - "mimic <addr> <addr> …" / "copy trade these wallets: …" / "stop mimicking <addr>"
 *  - "stats on <addr>", "how is this wallet doing <addr>", or just paste addresses → stats for every one.
 * Solana wallets: mimic (Helius swaps) + stats (Helius swaps + Birdeye holdings). EVM (0x…): stats via Alchemy when connected.
 */
const SOL_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EVM_RE = /\b0x[a-fA-F0-9]{40}\b/g;

export async function extractWallets(text: string) {
  const sol = [...new Set(text.match(SOL_RE) ?? [])].filter((s) => /\d/.test(s) || /[A-Z]/.test(s) && /[a-z]/.test(s)); // real base58, not words
  const evm = [...new Set((text.match(EVM_RE) ?? []).map((s) => s.toLowerCase()))];
  // Token mint addresses aren't wallets: drop anything that's a coin in Merod's catalog.
  const mints = sol.length ? new Set((await q<{ identifier: string }>("SELECT identifier FROM assets WHERE identifier = ANY($1::text[])", [sol])).map((r) => r.identifier)) : new Set<string>();
  return { sol: sol.filter((s) => !mints.has(s)), evm, mints: [...mints] };
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
const ago = (d: Date) => { const s = (Date.now() - d.getTime()) / 1000; return s < 3600 ? `${Math.round(s / 60)} min ago` : s < 172_800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`; };

export type WalletStats = { address: string; chain: "solana" | "evm"; ok: boolean; note?: string; swaps?: number; buys?: number; sells?: number; tokens?: { symbol: string; trades: number }[];
  lastActive?: string; firstInSample?: string; netWorthUsd?: number; holdings?: { symbol: string; usd: number }[]; balanceNative?: number; transfers?: number; mimicking?: boolean };

/** Stats for one wallet from public on-chain data (nothing private). */
export async function walletStats(userId: string, address: string): Promise<WalletStats> {
  const mimicking = !!(await one("SELECT 1 FROM copy_follows WHERE follower_id=$1 AND kind='wallet' AND wallet_address=$2 AND status='active'", [userId, address]));
  if (address.startsWith("0x")) {
    const key = await getCredential("alchemy", "production", "ALCHEMY_API_KEY", userId).catch(() => undefined);
    if (!key) return { address, chain: "evm", ok: false, mimicking, note: "Ethereum/Base wallets need an Alchemy key (Broker & AI keys). Mimicking 0x wallets isn't supported yet; Solana wallets are." };
    try {
      const ctx = contextFor("alchemy", "production", { userId });
      const rpc = async (method: string, params: any[]) => (await readJson(await ctx.fetch(`https://eth-mainnet.g.alchemy.com/v2/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), "alchemy"))?.result;
      const bal = Number(BigInt((await rpc("eth_getBalance", [address, "latest"])) ?? "0x0")) / 1e18;
      const tr = await rpc("alchemy_getAssetTransfers", [{ fromAddress: address, category: ["external", "erc20"], maxCount: "0x64", order: "desc", withMetadata: true }]);
      const list = tr?.transfers ?? [];
      return { address, chain: "evm", ok: true, mimicking, balanceNative: bal, transfers: list.length, lastActive: list[0]?.metadata?.blockTimestamp,
        tokens: Object.entries(list.reduce((m: Record<string, number>, t: any) => { const s = t.asset ?? "?"; m[s] = (m[s] ?? 0) + 1; return m; }, {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5).map(([symbol, trades]) => ({ symbol, trades: trades as number })),
        note: "Ethereum mainnet. Mimicking 0x wallets isn't supported yet; Solana wallets are." };
    } catch (e: any) { return { address, chain: "evm", ok: false, mimicking, note: `Alchemy: ${String(e.message).slice(0, 120)}` }; }
  }
  const out: WalletStats = { address, chain: "solana", ok: false, mimicking };
  const notes: string[] = [];
  // Swaps (Helius Enhanced Transactions: the most recent 100 swaps).
  const hkey = await getCredential("helius", "production", "HELIUS_API_KEY", userId).catch(() => undefined);
  if (hkey) {
    try {
      const ctx = contextFor("helius", "production", { userId });
      const txs: any[] = (await readJson(await ctx.fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${hkey}&type=SWAP&limit=100`), "helius")) ?? [];
      const QUOTES = new Set(["So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);
      let buys = 0, sells = 0; const byMint = new Map<string, number>();
      for (const tx of txs) for (const t of tx.tokenTransfers ?? []) {
        if (QUOTES.has(t.mint)) continue;
        if (t.toUserAccount === address) { buys++; byMint.set(t.mint, (byMint.get(t.mint) ?? 0) + 1); }
        else if (t.fromUserAccount === address) { sells++; byMint.set(t.mint, (byMint.get(t.mint) ?? 0) + 1); }
      }
      const mints = [...byMint.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      const names = new Map((mints.length ? await q<any>("SELECT identifier, upper(symbol) AS symbol FROM assets WHERE identifier = ANY($1::text[])", [mints.map((m) => m[0])]) : []).map((r) => [r.identifier, r.symbol]));
      Object.assign(out, { ok: true, swaps: txs.length, buys, sells, tokens: mints.map(([m, n]) => ({ symbol: names.get(m) ?? short(m), trades: n })),
        lastActive: txs[0] ? new Date(Number(txs[0].timestamp) * 1000).toISOString() : undefined, firstInSample: txs.at(-1) ? new Date(Number(txs.at(-1).timestamp) * 1000).toISOString() : undefined });
    } catch (e: any) { notes.push(`Helius: ${String(e.message).slice(0, 100)}`); }
  } else notes.push("Swap history needs a Helius key (Broker & AI keys)");
  // Holdings and net worth (Birdeye wallet portfolio).
  const bkey = await getCredential("birdeye", "production", "BIRDEYE_API_KEY", userId).catch(() => undefined);
  if (bkey) {
    try {
      const ctx = contextFor("birdeye", "production", { userId });
      const j = await readJson(await ctx.fetch(`https://public-api.birdeye.so/v1/wallet/token_list?wallet=${address}`, { headers: { "X-API-KEY": bkey, "x-chain": "solana", accept: "application/json" } }), "birdeye");
      const items: any[] = j?.data?.items ?? [];
      out.ok = true;
      out.netWorthUsd = Number(j?.data?.totalUsd ?? items.reduce((s, i) => s + Number(i.valueUsd ?? 0), 0));
      out.holdings = items.filter((i) => Number(i.valueUsd) > 0).sort((a, b) => Number(b.valueUsd) - Number(a.valueUsd)).slice(0, 5).map((i) => ({ symbol: String(i.symbol ?? short(i.address ?? "?")).toUpperCase(), usd: Number(i.valueUsd) }));
    } catch (e: any) { notes.push(`Birdeye: ${String(e.message).slice(0, 100)}`); }
  } else notes.push("holdings need a Birdeye key");
  if (notes.length) out.note = notes.join("; ");
  return out;
}

export function statsLine(s: WalletStats, compact = false) {
  const head = `${s.chain === "evm" ? "0x" : "Solana"} ${short(s.address)}${s.mimicking ? " (mimicking)" : ""}`;
  if (!s.ok) return `• ${head}: ${s.note ?? "no data"}`;
  const parts: string[] = [];
  if (s.netWorthUsd != null) parts.push(`worth ${usd(s.netWorthUsd)}`);
  if (s.balanceNative != null) parts.push(`${s.balanceNative.toFixed(4)} ETH`);
  if (s.swaps != null) parts.push(`${s.swaps} recent swaps (${s.buys} buys / ${s.sells} sells)`);
  if (s.transfers != null) parts.push(`${s.transfers} recent transfers`);
  if (s.lastActive) parts.push(`last active ${ago(new Date(s.lastActive))}`);
  if (!compact && s.tokens?.length) parts.push(`trades most: ${s.tokens.map((t) => `${t.symbol} (${t.trades})`).join(", ")}`);
  if (!compact && s.holdings?.length) parts.push(`top holdings: ${s.holdings.map((h) => `${h.symbol} ${usd(h.usd)}`).join(", ")}`);
  return `• ${head}: ${parts.join(" · ")}${!compact && s.note ? ` (${s.note})` : ""}`;
}

/** Stats for any number of wallets, a few at a time. */
export async function walletsStats(userId: string, addresses: string[]) {
  const out: WalletStats[] = [];
  for (let i = 0; i < addresses.length; i += 5) out.push(...(await Promise.all(addresses.slice(i, i + 5).map((a) => walletStats(userId, a)))));
  return out;
}

/** Prompt-box handler. Returns the reply text, or null when the prompt isn't about wallet addresses. */
export async function walletCommand(userId: string, text: string, opts: { isOwner: boolean }): Promise<string | null> {
  const { sol, evm, mints } = await extractWallets(text);
  const all = [...sol, ...evm];
  if (!all.length) return null;
  const t = text.toLowerCase();
  const stop = /\b(stop|pause|unmimic|un-mimic|unfollow|remove|cancel|turn off)\b[^.]{0,30}\b(mimic|mimicking|copy|copying|following|follow|track|tracking|watch)/.test(t) || /\b(stop|unmimic|unfollow)\b/.test(t) && /\bmimic|copy|follow/.test(t);
  const mimic = !stop && /\b(mimic|copy|copy[- ]?trade|mirror|follow|track|watch)\b/.test(t) && !/\b(stats?|info|analy[sz]e|look ?up|details?|how (is|are|did)|pnl|p&l|holdings?|worth)\b/.test(t);
  if (stop || mimic) {
    if (!opts.isOwner) return "Mimic trading is only available on the platform owner's account.";
    const { mimicMany, mimicSettings } = await import("./directory");
    const per = t.match(/\$\s*([\d,.]+)\s*(?:per|each|a)\s*(?:trade|buy|copy)/);
    const live = /\breal money\b|\blive\b/.test(t);
    const watch = /\b(watch|track)\b/.test(t) && !/\b(mimic|copy|mirror)\b/.test(t);
    const lines: string[] = [];
    if (sol.length) {
      if (stop) {
        const r = await q("UPDATE copy_follows SET status='paused' WHERE follower_id=$1 AND kind='wallet' AND wallet_address = ANY($2::text[]) AND status='active' RETURNING id", [userId, sol]);
        lines.push(`Stopped mimicking ${r.length} of ${sol.length} wallet${sol.length === 1 ? "" : "s"}.`);
      } else {
        const { settings, note } = await mimicSettings(userId, "crypto", { live, perTradeUsd: per ? Number(per[1].replace(/,/g, "")) : undefined } as any);
        if (watch) {
          const { createFollow } = await import("./service");
          let n = 0; for (const a of sol) { try { await createFollow(userId, { kind: "wallet", network: "solana", address: a }, settings, "watch"); n++; } catch { /* skip */ } }
          lines.push(`Watching ${n} wallet${n === 1 ? "" : "s"}: you'll be notified of every swap, nothing is copied.`);
        } else {
          const r: any = await mimicMany(userId, "wallets", true, sol, null, settings);
          lines.push(`Now mimicking ${r.done} wallet${r.done === 1 ? "" : "s"}${r.skipped?.length ? ` (skipped ${r.skipped.length}: ${r.skipped.slice(0, 3).join(", ")})` : ""}. Account: ${note}. Sizing: ${per ? `$${per[1]} per trade` : "same size as each wallet"}.`);
          lines.push("Every swap they make is copied (needs a Helius key) and shows up in Activity → Mimic and on the Mimic page.");
        }
      }
    }
    if (evm.length) lines.push(`${evm.length} Ethereum-style (0x…) address${evm.length === 1 ? "" : "es"} can't be mimicked yet; only Solana wallets can. Ask for their stats instead.`);
    if (mints.length) lines.push(`${mints.length} address${mints.length === 1 ? " is a token" : "es are tokens"}, not wallets, so ${mints.length === 1 ? "it was" : "they were"} skipped.`);
    return lines.join("\n");
  }
  // Stats / info for every address.
  const stats = await walletsStats(userId, all);
  const compact = stats.length > 10;
  const ok = stats.filter((s) => s.ok);
  const head = `Wallet stats for ${stats.length} address${stats.length === 1 ? "" : "es"} (public on-chain data, most recent activity):`;
  const total = ok.reduce((s, x) => s + (x.netWorthUsd ?? 0), 0);
  const most = [...ok].sort((a, b) => (b.swaps ?? 0) - (a.swaps ?? 0))[0];
  const summary = stats.length > 1 && ok.length ? `\nTogether: ${total ? `${usd(total)} in holdings, ` : ""}most active ${most ? short(most.address) : "—"} (${most?.swaps ?? 0} recent swaps).` : "";
  return `${head}\n${stats.map((s) => statsLine(s, compact)).join("\n")}${summary}${mints.length ? `\n(${mints.length} token address${mints.length === 1 ? "" : "es"} skipped.)` : ""}\nSay “mimic ${stats.length === 1 ? "this wallet" : "these wallets"}” with the address${stats.length === 1 ? "" : "es"} to copy ${stats.length === 1 ? "it" : "them"}.`;
}
