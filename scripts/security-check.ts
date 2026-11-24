/**
 * Pre-deploy security checks:
 *  1. No secrets committed: scans git-tracked (or all project) files for credential patterns.
 *  2. .env files are git-ignored.
 *  3. No secret-looking variables exposed via NEXT_PUBLIC_.
 *  4. Client components never import server modules.
 *  5. (if DB reachable) real-money flags OFF, paper ON, audit chain intact, no plaintext secrets.
 *  6. Production config sanity (master key length, realtime secret).
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

function listFiles(): string[] {
  try {
    const out = execSync("git ls-files --cached --others --exclude-standard", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").filter(Boolean);
  } catch {
    const acc: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { if (["node_modules", ".next", ".git"].includes(f)) continue; const p = join(d, f); statSync(p).isDirectory() ? walk(p) : acc.push(relative(root, p)); } };
    walk(root); return acc;
  }
}
const files = listFiles().filter((f) => !/\.(png|jpe?g|gif|ico|woff2?|lock)$/.test(f) && f !== "package-lock.json");

// 1. secret patterns
const PATTERNS: [string, RegExp][] = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{20,}/], ["OpenAI key", /sk-(proj-)?[A-Za-z0-9]{32,}/], ["AWS key", /AKIA[0-9A-Z]{16}/],
  ["Private key block", /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/], ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["Alpaca key id", /\b(PK|AK)[A-Z0-9]{18}\b/], ["Solana secret key array", /\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^:\s"']+:(?!merod@|password@|\$\{)[^@\s"']{6,}@(?!localhost)/],
];
const hits: string[] = [];
for (const f of files) {
  if (f.startsWith("tests/") || f === "scripts/security-check.ts") continue;
  let txt = ""; try { txt = readFileSync(join(root, f), "utf8"); } catch { continue; }
  for (const [name, re] of PATTERNS) if (re.test(txt)) hits.push(`${f}: ${name}`);
}
check("no committed secrets", hits.length === 0, hits.length ? hits.join("; ") : `${files.length} files scanned`);

// 2. env files ignored
const tracked = files.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"));
check(".env files not tracked", tracked.length === 0, tracked.length ? tracked.join(", ") : ".env* ignored (except .env.example)");
const gi = existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "";
check(".gitignore covers secrets & wallets", [".env", "*.pem", "*keypair*.json", "id.json"].every((p) => gi.includes(p)), "env, keys, wallet keypairs ignored");

// 3. NEXT_PUBLIC_ exposure
const example = existsSync(join(root, ".env.example")) ? readFileSync(join(root, ".env.example"), "utf8") : "";
const pub = [...example.matchAll(/^(NEXT_PUBLIC_[A-Z0-9_]+)=/gm)].map((m) => m[1]);
const badPub = pub.filter((v) => /SECRET|KEY|TOKEN|PASSWORD|PRIVATE/.test(v));
const codePub = new Set<string>();
for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f))) for (const m of readFileSync(join(root, f), "utf8").matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) codePub.add(m[0]);
check("no secrets in NEXT_PUBLIC_ vars", badPub.length === 0 && [...codePub].every((v) => !/SECRET|KEY|TOKEN|PASSWORD|PRIVATE/.test(v)), `public vars: ${[...new Set([...pub, ...codePub])].join(", ") || "none"}`);

// 4. client components must not import server code
const leaks: string[] = [];
for (const f of files.filter((f) => /\.(tsx|ts)$/.test(f) && f.startsWith("src/"))) {
  const t = readFileSync(join(root, f), "utf8");
  if (/^["']use client["']/m.test(t) && /from ["']@\/server\//.test(t)) leaks.push(f);
}
check("client components don't import server modules", leaks.length === 0, leaks.join(", ") || "ok");

// 5. database checks
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  try {
    const { q, pool } = await import("@/server/db");
    const flags = await q<{ key: string; enabled: boolean }>("SELECT key, enabled FROM feature_flags");
    const money = ["live_crypto_trading", "live_brokerage_trading", "automated_real_money", "copy_trading", "funding", "withdrawals"];
    const on = flags.filter((f) => money.includes(f.key) && f.enabled).map((f) => f.key);
    check("real-money trading disabled", on.length === 0, on.length ? `ENABLED: ${on.join(", ")}` : "all real-money flags off");
    check("paper trading enabled", flags.some((f) => f.key === "paper_trading" && f.enabled), "paper_trading flag");
    const { verifyAuditChain } = await import("./audit-chain");
    const v = await verifyAuditChain();
    check("audit hash chain intact", v.ok, v.message);
    const plain = await q<{ n: number }>("SELECT count(*)::int AS n FROM provider_secrets WHERE ciphertext ~ '^(sk-|pk_|AKIA)'");
    check("provider secrets encrypted at rest", plain[0].n === 0, "no plaintext-looking ciphertext");
    await pool.end();
  } catch (e: any) { check("database checks", false, e.message); }
} else check("database checks", true, "skipped (DATABASE_URL not set)");

// 6. production config
if (process.env.MEROD_ENV === "production") {
  const mk = process.env.MEROD_MASTER_KEY ?? "";
  const len = /^[0-9a-f]{64}$/i.test(mk) ? 32 : Buffer.from(mk, "base64").length;
  check("MEROD_MASTER_KEY is 32 bytes", len === 32, len ? `${len} bytes` : "missing");
  check("REALTIME_SECRET set", (process.env.REALTIME_SECRET ?? "").length >= 32, "length >= 32");
  check("demo data off in production", process.env.MEROD_DEMO_DATA !== "true", `MEROD_DEMO_DATA=${process.env.MEROD_DEMO_DATA ?? "unset"}`);
  check("live flags not unlocked", process.env.MEROD_ALLOW_LIVE_FLAGS !== "true", `MEROD_ALLOW_LIVE_FLAGS=${process.env.MEROD_ALLOW_LIVE_FLAGS ?? "unset"}`);
}

for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name} — ${r.detail}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} security check(s) FAILED` : "\nAll security checks passed");
process.exit(failed.length ? 1 : 0);
