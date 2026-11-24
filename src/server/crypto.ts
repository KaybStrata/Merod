import "@/lib/server-only-shim";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { env, isProduction, allowDevFallbacks } from "./env";

let devKeyWarned = false;
let cachedKey: { raw: string; key: Buffer } | null = null;
/**
 * The 32-byte encryption key. A 64-char hex or base64 32-byte value is used as-is; any other value (e.g. a long
 * random password) is accepted too and stretched to 32 bytes with SHA-256, so a mis-formatted setting never blocks
 * saving keys. Web and worker must have the same value: both log the same short, non-secret fingerprint.
 */
export function masterKeyInfo() {
  const raw = (env.masterKey ?? "").trim();
  if (!raw) return null;
  if (cachedKey?.raw === raw) return { key: cachedKey.key, derived: !isExact(raw) };
  const exact = isExact(raw);
  const key = exact ? (/^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64")) : createHash("sha256").update(raw, "utf8").digest();
  if (!exact && raw.length < 16) throw new Error("MEROD_MASTER_KEY is too short: use at least 16 random characters (ideally 32 random bytes as hex or base64)");
  cachedKey = { raw, key };
  console.info(`[merod] encryption key loaded (${exact ? "32-byte key" : "derived from passphrase"}), fingerprint ${keyFingerprint(key)}`);
  return { key, derived: !exact };
}
function isExact(raw: string) {
  if (/^[0-9a-f]{64}$/i.test(raw)) return true;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && Buffer.from(raw, "base64").length === 32;
}
/** Short non-secret fingerprint for comparing web vs worker keys. */
export function keyFingerprint(key: Buffer) { return createHash("sha256").update("merod-key-fp").update(key).digest("hex").slice(0, 10); }

function masterKey(): Buffer {
  const info = masterKeyInfo();
  if (info) return info.key;
  if (isProduction || !allowDevFallbacks) throw new Error("MEROD_MASTER_KEY is required on hosted deployments (set it in your hosting provider's environment variables)");
  if (!devKeyWarned) {
    console.warn("[merod] MEROD_MASTER_KEY not set — using an insecure development key. Never do this in production.");
    devKeyWarned = true;
  }
  return createHash("sha256").update("merod-insecure-dev-key").digest();
}

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). AAD binds ciphertext to its slot. */
export function encrypt(plain: string, aad = ""): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", masterKey(), iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64");
}
export function decrypt(blob: string, aad = ""): string {
  const buf = Buffer.from(blob, "base64");
  const d = createDecipheriv("aes-256-gcm", masterKey(), buf.subarray(0, 12));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hmacSha256 = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const got = scryptSync(pw, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, got);
}
export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
