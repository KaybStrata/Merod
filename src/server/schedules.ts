import "@/lib/server-only-shim";
import { q, one } from "./db";

/**
 * Prompt schedules: "every morning at 2 am Los Angeles time, buy the top 10 most profitable Solana meme coins and sell on a 1% loop".
 * The time part becomes a schedule; the rest is the prompt that runs on its own (worker loop, each minute) as if you typed it.
 */
export type Spec = { kind: "daily" | "weekly" | "interval"; hour?: number; minute?: number; weekdays?: number[]; everyMin?: number; tz: string };

const TZ: [RegExp, string][] = [
  [/\b(los ang[a-z]*s|los angel[a-z]*|la|l\.a\.|pacific|pst|pdt|pt|san francisco|sf|seattle|california)\b/, "America/Los_Angeles"],
  [/\b(new yo?rk|nyc|ny|eastern|est|edt|et|miami|boston|toronto)\b/, "America/New_York"],
  [/\b(chicago|central|cst|cdt|ct|dallas|houston)\b/, "America/Chicago"],
  [/\b(denver|mountain|mst|mdt|mt|phoenix)\b/, "America/Denver"],
  [/\b(london|uk|gmt|bst)\b/, "Europe/London"], [/\b(paris|berlin|cet|cest|europe)\b/, "Europe/Paris"],
  [/\b(tokyo|japan|jst)\b/, "Asia/Tokyo"], [/\b(dubai)\b/, "Asia/Dubai"], [/\b(singapore|sgt|hong kong|hkt)\b/, "Asia/Singapore"],
  [/\b(sydney|aest)\b/, "Australia/Sydney"], [/\b(utc|zulu)\b/, "UTC"],
];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Split a prompt into its schedule and the instruction to run. Null when it isn't a recurring request. */
export function parseSchedule(raw: string, defaultTz = "UTC"): { spec: Spec; prompt: string; label: string } | null {
  const t = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (!/\bevery\b|\bdaily\b|\beach (day|morning|night|evening|week|hour|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bweekdays\b|\bon weekends\b/.test(t)) return null;
  let tz = defaultTz;
  for (const [re, z] of TZ) if (re.test(t)) { tz = z; break; }

  // Interval: "every 15 minutes", "every 2 hours", "every hour".
  const iv = t.match(/\bevery (\d+)?\s*(min|mins|minutes?|hours?|hrs?)\b/);
  let spec: Spec | null = null;
  if (iv) {
    const n = Math.max(1, Number(iv[1] ?? 1));
    const everyMin = /^h/.test(iv[2]) ? n * 60 : Math.max(5, n);
    spec = { kind: "interval", everyMin, tz };
  } else {
    // Clock time: "at 2 am", "at 2:30pm", "at 14:00", "at noon", "at midnight"; "every morning" defaults to 9am.
    let hour: number | null = null, minute = 0;
    // "at 2%" / "at $5" are prices, not times; a bare "at 2" only counts next to a day word ("every day at 2").
    const dayWord = /\b(every|each) (day|morning|night|evening|afternoon|week|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\bdaily\b|\bweekdays\b/.test(t);
    let tm = t.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/) ?? t.match(/\bat (\d{1,2}):(\d{2})(?![\d%])()/) ?? t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/);
    if (!tm && dayWord) tm = t.match(/\bat (\d{1,2})(?![\d%.$,]|\s*(%|percent|dollars?|usd))()()/);
    if (tm) {
      hour = Number(tm[1]); minute = Number(tm[2] ?? 0);
      const ap = tm[3]?.replace(/\./g, "");
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
      if (!ap && /\b(evening|night|afternoon)\b/.test(t) && hour < 12) hour += 12;
    } else if (/\bnoon\b/.test(t)) hour = 12;
    else if (/\bmidnight\b/.test(t)) hour = 0;
    else if (/\bmorning\b/.test(t)) hour = 9;
    else if (/\bevening\b/.test(t)) hour = 18;
    else if (/\bnight\b/.test(t)) hour = 21;
    else if (/\b(every|each) day\b|\bdaily\b/.test(t)) hour = 9;
    if (hour === null || hour > 23 || minute > 59) return null;
    const named = DAYS.map((d, i) => (new RegExp(`\\b${d}s?\\b`).test(t) ? i : -1)).filter((i) => i >= 0);
    const weekdays = /\bweekdays?\b/.test(t) ? [1, 2, 3, 4, 5] : /\bweekends?\b/.test(t) ? [0, 6] : named;
    spec = weekdays.length ? { kind: "weekly", hour, minute, weekdays, tz } : { kind: "daily", hour, minute, tz };
  }
  // The instruction: what's left once the timing words are removed.
  const prompt = raw
    .replace(/\b(every|each)\s+(\d+\s*)?(minutes?|mins?|hours?|hrs?|day|morning|night|evening|afternoon|week|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi, " ")
    .replace(/\b(daily|weekdays|on weekends)\b/gi, " ")
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/gi, " ").replace(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi, " ")
    .replace(/\b(at )?(noon|midnight)\b/gi, " ")
    .replace(/\b(los ang[a-z]*|new yo?rk|chicago|denver|london|paris|berlin|tokyo|dubai|singapore|sydney|pacific|eastern|central|mountain|utc|gmt|pst|pdt|est|edt|cst|cdt|mst|mdt|pt|et|ct|mt)\s*(time|timezone|time zone)?\b/gi, " ")
    .replace(/\b(time|timezone)\b/gi, " ")
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").replace(/\s{2,}/g, " ").replace(/^(then|and|,)\s+/i, "").trim();
  if (prompt.split(/\s+/).length < 2) return null;
  return { spec, prompt, label: describe(spec) };
}

/** "Every day at 2:00 AM (Los Angeles time)". */
export function describe(s: Spec) {
  const city = s.tz.split("/").pop()!.replace(/_/g, " ");
  if (s.kind === "interval") return `Every ${s.everyMin! % 60 === 0 ? `${s.everyMin! / 60 === 1 ? "" : `${s.everyMin! / 60} `}hour${s.everyMin! / 60 === 1 ? "" : "s"}` : `${s.everyMin} minutes`}`;
  const h = s.hour!, m = s.minute ?? 0;
  const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  const days = s.kind === "weekly" ? (s.weekdays!.join() === "1,2,3,4,5" ? "Weekdays" : s.weekdays!.join() === "0,6" ? "Weekends" : `Every ${s.weekdays!.map((d) => DAYS[d][0].toUpperCase() + DAYS[d].slice(1)).join(", ")}`) : "Every day";
  return `${days} at ${clock} (${city} time)`;
}

/** Wall-clock parts of an instant in a time zone. */
function partsIn(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
/** The UTC instant for a wall-clock time in a zone (handles daylight saving). */
function zoned(y: number, mo: number, d: number, h: number, mi: number, tz: string) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz);
    const diff = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Date.UTC(y, mo - 1, d, h, mi);
    guess -= diff;
  }
  return new Date(guess);
}

/** Next time the schedule fires after `from`. */
export function nextRun(s: Spec, from = new Date()): Date {
  if (s.kind === "interval") return new Date(from.getTime() + s.everyMin! * 60_000);
  for (let i = 0; i < 9; i++) {
    const day = partsIn(new Date(from.getTime() + i * 86_400_000), s.tz);
    const at = zoned(day.y, day.mo, day.d, s.hour!, s.minute ?? 0, s.tz);
    if (at.getTime() <= from.getTime() + 1000) continue;
    if (s.kind === "weekly" && !s.weekdays!.includes(partsIn(at, s.tz).wd)) continue;
    return at;
  }
  return new Date(from.getTime() + 86_400_000);
}

export async function createSchedule(userId: string, prompt: string, spec: Spec) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: spec.tz }); } catch { spec = { ...spec, tz: "UTC" }; }
  const next = nextRun(spec);
  return one<any>("INSERT INTO prompt_schedules (user_id, prompt, label, spec, next_run_at) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [userId, prompt.slice(0, 1000), describe(spec), JSON.stringify(spec), next]);
}
export const listSchedules = (userId: string) => q<any>("SELECT * FROM prompt_schedules WHERE user_id=$1 ORDER BY active DESC, next_run_at", [userId]);

/** "show my schedules", "cancel schedule 2", "delete all schedules", "pause schedule 1". */
export async function scheduleCommand(userId: string, raw: string): Promise<string | null> {
  const t = raw.toLowerCase().trim();
  if (!/\bschedules?\b/.test(t)) return null;
  const rows = await listSchedules(userId);
  const line = (r: any, i: number) => `${i + 1}. ${r.label}: “${r.prompt}”${r.active ? ` · next ${new Date(r.next_run_at).toLocaleString("en-US", { timeZone: r.spec?.tz ?? "UTC", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : " · paused"}${r.runs ? ` · ran ${r.runs}×` : ""}`;
  if (/\b(show|list|what|my|see|view)\b/.test(t) && !/\b(cancel|delete|remove|stop|pause|resume)\b/.test(t))
    return rows.length ? `Your schedules:\n${rows.map(line).join("\n")}\n\nSay “cancel schedule 1” or “pause schedule 1” to change one.` : "You have no schedules. Try “every morning at 2am Los Angeles time, buy the top 10 Solana meme coins and sell on a 1% loop”.";
  const act = /\b(cancel|delete|remove)\b/.test(t) ? "delete" : /\b(pause|stop)\b/.test(t) ? "pause" : /\b(resume|restart|turn on)\b/.test(t) ? "resume" : null;
  if (!act) return null;
  const n = t.match(/\bschedules?\s*#?(\d+)/)?.[1];
  const pick = /\ball\b/.test(t) ? rows : n ? rows.filter((_, i) => i === Number(n) - 1) : [];
  if (!pick.length) return rows.length ? `Which one? ${rows.map(line).join("\n")}` : "You have no schedules.";
  for (const r of pick) {
    if (act === "delete") await q("DELETE FROM prompt_schedules WHERE id=$1 AND user_id=$2", [r.id, userId]);
    else await q("UPDATE prompt_schedules SET active=$3, next_run_at=CASE WHEN $3 THEN $4 ELSE next_run_at END WHERE id=$1 AND user_id=$2", [r.id, userId, act === "resume", nextRun(r.spec)]);
  }
  return `${act === "delete" ? "Deleted" : act === "pause" ? "Paused" : "Resumed"} ${pick.length} schedule${pick.length === 1 ? "" : "s"}: ${pick.map((r) => `“${r.prompt}”`).join(", ")}.`;
}

/** Worker loop: run every due schedule's prompt as its owner, then move it to its next time. */
export async function runDueSchedules() {
  const due = await q<any>(
    `UPDATE prompt_schedules s SET last_run_at=now(), runs=runs+1, next_run_at = now() + interval '10 minutes'
      WHERE id IN (SELECT id FROM prompt_schedules WHERE active AND next_run_at <= now() ORDER BY next_run_at LIMIT 20 FOR UPDATE SKIP LOCKED)
      RETURNING *`);
  const { handlePrompt } = await import("./ai/interpret");
  for (const s of due) {
    let result = "";
    try {
      const r: any = await handlePrompt(s.user_id, { text: s.prompt, conversationId: s.spec?.conversationId ?? undefined });
      const msgs = Array.isArray(r.messages) && r.messages.length ? r.messages : [r.message];
      result = msgs.map((m: any) => m?.content ?? "").join(" · ").slice(0, 500);
    } catch (e: any) { result = `Failed: ${String(e.message).slice(0, 300)}`; }
    await q("UPDATE prompt_schedules SET next_run_at=$2, last_result=$3 WHERE id=$1", [s.id, nextRun(s.spec), result]);
    const { notify } = await import("./engine/engine");
    await notify(s.user_id, "bot", `Schedule ran: ${s.label}`, `${s.prompt} → ${result}`.slice(0, 400), "/talk").catch(() => {});
  }
  return due.length;
}
