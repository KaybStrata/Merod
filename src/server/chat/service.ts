import "@/lib/server-only-shim";
import { one, q } from "../db";
import { publish } from "../realtime";
import { audit } from "../audit";
import { HttpError } from "../errors";

/**
 * Community chat: a single public room for every signed-in user.
 * Messages are untrusted user text: stored as-is, rendered as plain text (never HTML), never fed to AI.
 * Anything that looks like a private key, seed phrase or API secret is refused so people can't leak them.
 */

const SELECT = `SELECT m.id, m.body, m.reply_to, m.created_at, m.user_id, p.handle, p.display_name, p.avatar_color, u.role,
                       r.body AS reply_body, rp.handle AS reply_handle
                  FROM chat_messages m
                  JOIN user_profiles p ON p.user_id = m.user_id
                  JOIN users u ON u.id = m.user_id
             LEFT JOIN chat_messages r ON r.id = m.reply_to AND r.deleted_at IS NULL
             LEFT JOIN user_profiles rp ON rp.user_id = r.user_id`;

export async function listMessages(opts: { before?: number | null; after?: number | null; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 100);
  if (opts.after) return q(`${SELECT} WHERE m.deleted_at IS NULL AND m.id > $1 ORDER BY m.id ASC LIMIT $2`, [opts.after, limit]);
  const rows = await q(`${SELECT} WHERE m.deleted_at IS NULL AND ($1::bigint IS NULL OR m.id < $1) ORDER BY m.id DESC LIMIT $2`, [opts.before ?? null, limit]);
  return rows.reverse();
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\b(?:0x)?[a-fA-F0-9]{64}\b/, "what looks like a private key"],
  [/\b[1-9A-HJ-NP-Za-km-z]{85,90}\b/, "what looks like a Solana private key"],
  [/\b(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/, "what looks like an API key"],
];
function looksLikeSeedPhrase(text: string) {
  const words = text.toLowerCase().match(/\b[a-z]{3,8}\b/g) ?? [];
  // 12/24 short lowercase words with no punctuation in one message is the classic seed-phrase shape.
  return (words.length === 12 || words.length === 24) && /^[a-z\s]+$/.test(text.trim().toLowerCase());
}

export async function postMessage(user: { id: string; status: string }, body: string, replyTo?: number | null) {
  if (user.status !== "active") throw new HttpError(403, "Your account can't post right now");
  const mute = await one<{ muted_until: string }>("SELECT muted_until FROM chat_mutes WHERE user_id=$1 AND muted_until > now()", [user.id]);
  if (mute) throw new HttpError(403, `You're muted in the community chat until ${new Date(mute.muted_until).toLocaleString()}`);
  const text = body.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new HttpError(400, "Message is empty");
  for (const [re, what] of SECRET_PATTERNS) if (re.test(text)) throw new HttpError(400, `Message blocked: it contains ${what}. Never share keys in chat.`);
  if (looksLikeSeedPhrase(text)) throw new HttpError(400, "Message blocked: it looks like a wallet seed phrase. Never share it with anyone.");
  if (replyTo && !(await one("SELECT 1 FROM chat_messages WHERE id=$1 AND deleted_at IS NULL", [replyTo]))) throw new HttpError(400, "That message no longer exists");
  const ins = await one<{ id: number }>("INSERT INTO chat_messages (user_id, body, reply_to) VALUES ($1,$2,$3) RETURNING id", [user.id, text, replyTo ?? null]);
  const row = (await q(`${SELECT} WHERE m.id=$1`, [ins!.id]))[0];
  await publish("chat", "message", row);
  return row;
}

export async function deleteMessage(actor: { id: string; role: string }, id: number) {
  const m = await one<{ user_id: string }>("SELECT user_id FROM chat_messages WHERE id=$1 AND deleted_at IS NULL", [id]);
  if (!m) throw new HttpError(404, "Message not found");
  const isAdmin = actor.role === "admin" || actor.role === "super_admin";
  if (m.user_id !== actor.id && !isAdmin) throw new HttpError(403, "You can only delete your own messages");
  await q("UPDATE chat_messages SET deleted_at=now(), deleted_by=$2 WHERE id=$1", [id, actor.id]);
  if (m.user_id !== actor.id) await audit({ actorType: "admin", actorId: actor.id, userId: m.user_id, action: "chat.message_removed", target: String(id) });
  await publish("chat", "deleted", { id });
}

export async function reportMessage(reporterId: string, id: number, reason: string | undefined) {
  if (!(await one("SELECT 1 FROM chat_messages WHERE id=$1", [id]))) throw new HttpError(404, "Message not found");
  await q("INSERT INTO chat_reports (message_id, reporter_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [id, reporterId, reason?.slice(0, 300) ?? null]);
  await publish("admin", "chat_report", { messageId: id });
}

export async function muteUser(adminId: string, userId: string, minutes: number, reason?: string) {
  await q(`INSERT INTO chat_mutes (user_id, muted_until, reason, muted_by) VALUES ($1, now() + make_interval(mins => $2), $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET muted_until=EXCLUDED.muted_until, reason=EXCLUDED.reason, muted_by=EXCLUDED.muted_by, created_at=now()`,
    [userId, minutes, reason ?? null, adminId]);
  await audit({ actorType: "admin", actorId: adminId, userId, action: "chat.user_muted", target: userId, data: { minutes, reason } });
}

export async function chatStats() {
  return one<{ members: number; today: number }>(
    "SELECT (SELECT count(*)::int FROM users WHERE status='active') AS members, (SELECT count(*)::int FROM chat_messages WHERE deleted_at IS NULL AND created_at > now() - interval '24 hours') AS today");
}
