/** Generates docs/INTEGRATION_READINESS.md from the live provider catalog (single source of truth). */
import { writeFileSync, mkdirSync } from "node:fs";
import { PROVIDERS, APPROVAL_GATED } from "@/server/providers/catalog";

const phaseName: Record<number, string> = { 2: "Phase 2 — Market data, blockchain infra & wallets", 3: "Phase 3 — Crypto execution", 4: "Phase 4 — AI", 5: "Phase 5 — Stock brokerage" };
let md = `# Merod — Integration Readiness Report

_Generated from \`src/server/providers/catalog.ts\` by \`npx tsx scripts/readiness-report.ts\`._

**Current state:** no provider credentials are configured. Merod runs fully in **paper-trading mode** on a clearly labeled
simulated price feed. Every provider below has a working adapter and a real connection probe. Its status stays
\`not_configured\` → \`credentials_configured\` until an admin clicks **Test connection** and the provider answers correctly.

**How to connect any provider:** \`/admin/integrations\` → paste keys (encrypted at rest) → *Test connection* → *Enable*.
For production use of execution and wallet providers: record the compliance approval → enable the matching feature flag
(requires 2FA + an approval reference, and \`MEROD_ALLOW_LIVE_FLAGS=true\` on the server — deliberately unset today).
Alternatively, set the listed environment variables on **both** Vercel and Railway.

| Status | Meaning |
|---|---|
| Not configured | Required credentials missing |
| Credentials configured | Keys saved, not yet tested |
| Testing | Probe running |
| Sandbox connected | Probe passed against the sandbox environment |
| Awaiting approval | Production probe passed; compliance approval not recorded |
| Production connected | Probe passed + approval recorded (data/AI providers need no approval) |
| Restricted | Approval denied |
| Connection error | Probe failed (message shown on the card) |
| Disabled | Turned off by an admin |

`;
for (const phase of [2, 3, 4, 5]) {
  md += `\n## ${phaseName[phase]}\n`;
  for (const p of PROVIDERS.filter((x) => x.phase === phase)) {
    md += `\n### ${p.name}${p.optional ? " _(optional)_" : ""}\n\n${p.description}\n\n`;
    md += `- **Docs:** ${p.docsUrl}\n- **Register:** ${p.signupUrl}\n`;
    md += `- **Environment variables:** ${p.credentials.length ? p.credentials.map((c) => `\`${c.name}\`${c.required ? "" : " (optional)"}`).join(", ") : "none — public API"}\n`;
    if (p.settings.length) md += `- **Settings (non-secret):** ${p.settings.map((s) => `${s.label}${Object.keys(s.defaults).length ? ` — default ${Object.entries(s.defaults).map(([e, v]) => `${e}: \`${v}\``).join(", ")}` : ""}`).join("; ")}\n`;
    md += `- **SDK:** ${p.sdk ? `\`${p.sdk.install}\`${p.sdk.notes ? ` — ${p.sdk.notes}` : ""}` : "none required (REST)"}\n`;
    md += `- **Environments:** ${p.environments.join(", ")} · **Auth:** ${p.authMethod} · **Users can paste their own keys:** ${p.userKeys ? (p.userKeys === "personal_account" ? "yes (own account only)" : "yes") : "no (platform-level)"}\n`;
    md += `- **Coverage:** ${[...p.assetClasses, ...p.networks.slice(0, 8)].join(", ") || "n/a"} · **Capabilities:** ${p.capabilities.join(", ")}\n`;
    md += `- **Production requirements:** ${p.commercialRequirements}${APPROVAL_GATED.has(p.category) ? " _(approval-gated in Merod)_" : ""}\n`;
    md += `- **Connection test:** real API probe implemented in the catalog.\n`;
  }
}
md += `
## Custom APIs
Any other REST provider can be added without a code change: \`/admin/integrations\` → **Add custom API** (base URL, auth style, header/param name,
test path). Custom providers support credential storage, connection tests and usage monitoring. Execution through a custom provider needs a reviewed adapter.

## Required commercial approvals before real money
1. **Alpaca Broker API** agreement + KYC/AML program + go-live approval (embedded customer brokerage). The Trading API keys must never execute other customers' orders.
2. **SnapTrade** production keys with trading permissions.
3. **Interactive Brokers** third-party / introducing-broker approval and OAuth onboarding.
4. **Tradier** partner approval for multi-user use (optional).
5. **Market data redistribution licenses** for real-time equities display (Massive/Alpaca SIP/exchange agreements) and paid crypto data plans for commercial use (CoinGecko, Birdeye).
6. **Wallet security review** of Privy signing policies, spending limits and key quorum before delegated signing.
7. **Legal review** per jurisdiction for brokerage, crypto, copy trading, funding and withdrawals (feature flags + \`jurisdiction_rules\`).

## Remaining development before production activation
- Client-side wallet signing UI (Solana / EVM wallet adapters) to sign the unsigned transactions Jupiter and 0x adapters already return (\`POST /api/orders/:id { action: "signed" }\` is implemented).
- Pump.fun bonding-curve instruction building (install \`@pump-fun/pump-sdk\`; lifecycle detection and quotes are implemented).
- SwapKit cross-chain deposit flow, Cetus/Panora transaction signing (quotes implemented).
- IBKR OAuth (third-party) session management; Client Portal Gateway probe is implemented for development.
- Licensed news data provider for the news-monitor bot.
- Penetration test and third-party security review.
`;
mkdirSync("docs", { recursive: true });
writeFileSync("docs/INTEGRATION_READINESS.md", md);
console.log("wrote docs/INTEGRATION_READINESS.md");
