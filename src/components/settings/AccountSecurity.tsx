"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { User, ShieldCheck, ShieldAlert, KeyRound, Smartphone, Monitor, Check, X, Copy, Eye, EyeOff, Mail, AtSign, Globe2, Palette, LogOut, CheckCircle2, Circle } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Input, Modal, cx, useToast } from "@/components/ui";

/* ───────────────────────── Shared bits ───────────────────────── */
function Section({ icon: Icon, title, desc, children, action }: { icon: any; title: string; desc?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft"><Icon className="size-4.5 text-accent-2" /></span>
          <div><h3 className="font-semibold">{title}</h3>{desc && <p className="text-xs text-muted">{desc}</p>}</div>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** Six large boxes for an authenticator code; pasting a full code fills them all. */
export function CodeInput({ value, onChange, onComplete, autoFocus }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");
  useEffect(() => { if (autoFocus) refs.current[0]?.focus(); }, [autoFocus]);
  function set(i: number, d: string) {
    const clean = d.replace(/\D/g, "");
    if (clean.length > 1) { const v = clean.slice(0, 6); onChange(v); refs.current[Math.min(v.length, 5)]?.focus(); if (v.length === 6) onComplete?.(v); return; }
    const arr = value.padEnd(6, " ").split(""); arr[i] = clean || " ";
    const v = arr.join("").replace(/\s+$/, "").replace(/ /g, "");
    onChange(v);
    if (clean && i < 5) refs.current[i + 1]?.focus();
    if (v.length === 6) onComplete?.(v);
  }
  return (
    <div className="flex gap-2" role="group" aria-label="6-digit code">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={6} value={d.trim()}
          onChange={(e) => set(i, e.target.value)} onKeyDown={(e) => { if (e.key === "Backspace" && !d.trim() && i > 0) refs.current[i - 1]?.focus(); }}
          className="h-12 w-10 rounded-xl border border-line bg-bg-2 text-center font-mono text-xl outline-none focus:border-accent sm:w-11" aria-label={`Digit ${i + 1}`} />
      ))}
    </div>
  );
}

function PasswordInput({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <span className="flex h-10 items-center rounded-xl border border-line bg-bg-2 pr-1 focus-within:border-accent">
        <input type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" />
        <button type="button" onClick={() => setShow(!show)} className="rounded-lg p-1.5 text-faint hover:text-text" aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
      </span>
    </label>
  );
}

function strength(pw: string) {
  let s = 0;
  if (pw.length >= 10) s++; if (pw.length >= 14) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

function deviceName(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  return `${browser} on ${os}`;
}

/* ───────────────────────── Account (personal settings) ───────────────────────── */
const COLORS = ["#38bdf8", "#22c55e", "#a78bfa", "#f472b6", "#f59e0b", "#ef4444", "#14b8a6", "#e5e7eb"];
const COUNTRIES = ["US", "CA", "GB", "IE", "AU", "NZ", "DE", "FR", "ES", "IT", "NL", "BE", "CH", "AT", "SE", "NO", "DK", "FI", "PL", "PT", "CZ", "GR", "TR", "AE", "SA", "IL", "IN", "PK", "BD", "SG", "MY", "TH", "VN", "PH", "ID", "JP", "KR", "CN", "HK", "TW", "BR", "MX", "AR", "CL", "CO", "PE", "ZA", "NG", "KE", "ET", "EG", "MA", "GH"];

export function AccountTab({ data, save, busy, refresh }: { data: any; save: (section: string, v: any, msg?: string) => Promise<boolean>; busy: boolean; refresh: () => void }) {
  const initial = { display_name: data.profile.display_name ?? "", bio: data.profile.bio ?? "", avatar_color: data.profile.avatar_color ?? "#38bdf8", country: data.user.country ?? "" };
  const [v, setV] = useState(initial);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const names = useMemo(() => { try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch { return null; } }, []);
  const list = useMemo(() => COUNTRIES.map((c) => ({ c, n: names?.of(c) ?? c })).sort((a, b) => a.n.localeCompare(b.n)), [names]);
  const initials = (v.display_name || data.profile.handle || "?").split(/\s+/).map((w: string) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="space-y-4">
      {/* Preview */}
      <Card>
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-black" style={{ background: v.avatar_color }}>{initials}</span>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{v.display_name || "Your name"}</div>
            <div className="truncate text-sm text-muted">@{data.profile.handle} · {data.user.email}</div>
            {v.bio && <p className="mt-1 line-clamp-2 text-xs text-muted">{v.bio}</p>}
          </div>
        </div>
        <p className="mt-3 text-[11px] text-faint">This is how others see you on Merod (when your profile is public).</p>
      </Card>

      <Section icon={User} title="Profile" desc="Your name, a short bio and your avatar color.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Display name" value={v.display_name} maxLength={60} onChange={(e) => setV({ ...v, display_name: e.target.value })} placeholder="e.g. Kaleb B." />
          <div>
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted"><Palette className="size-3.5" /> Avatar color</span>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setV({ ...v, avatar_color: c })} aria-label={`Color ${c}`} className={cx("size-8 rounded-full ring-offset-2 ring-offset-bg", v.avatar_color === c && "ring-2 ring-accent")} style={{ background: c }} />
              ))}
              <label className="flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-line text-[10px] text-muted" title="Custom color">
                +<input type="color" value={v.avatar_color} onChange={(e) => setV({ ...v, avatar_color: e.target.value })} className="sr-only" />
              </label>
            </div>
          </div>
          <label className="block sm:col-span-2">
            <span className="mb-1 flex justify-between text-xs font-medium text-muted"><span>Bio</span><span className="text-faint">{v.bio.length}/280</span></span>
            <textarea maxLength={280} rows={3} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} placeholder="A sentence about how you trade (optional)"
              className="w-full rounded-xl border border-line bg-bg-2 p-3 text-sm outline-none focus:border-accent" />
          </label>
        </div>
      </Section>

      <Section icon={Mail} title="Sign-in details" desc="The email and username you use to sign in.">
        <div className="grid gap-4 sm:grid-cols-2">
          <ChangeField kind="email" label="Email" icon={Mail} current={data.user.email} needs2fa={!!data.user.totp_enabled} onDone={refresh} />
          <ChangeField kind="handle" label="Username" icon={AtSign} current={data.profile.handle} needs2fa={false} onDone={refresh} />
        </div>
      </Section>

      <Section icon={Globe2} title="Country" desc="Some features (like real-money trading) depend on where you live.">
        <select value={v.country} onChange={(e) => setV({ ...v, country: e.target.value })} className="h-10 w-full max-w-sm rounded-xl border border-line bg-bg-2 px-3 text-sm outline-none focus:border-accent">
          <option value="">Not set</option>
          {list.map((x) => <option key={x.c} value={x.c}>{x.n}</option>)}
          {v.country && !COUNTRIES.includes(v.country) && <option value={v.country}>{names?.of(v.country) ?? v.country}</option>}
        </select>
      </Section>

      <div className={cx("sticky bottom-24 z-10 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors", dirty ? "border-accent/50 bg-panel shadow-lg" : "border-line bg-panel/60")}>
        <span className="text-sm text-muted">{dirty ? "You have unsaved changes" : "All changes saved"}</span>
        <div className="flex gap-2">
          {dirty && <Button variant="ghost" onClick={() => setV(initial)}>Undo</Button>}
          <Button variant="primary" loading={busy} disabled={!dirty} onClick={() => save("account", v, "Profile saved")}>Save changes</Button>
        </div>
      </div>
    </div>
  );
}

function ChangeField({ kind, label, icon: Icon, current, needs2fa, onDone }: { kind: "email" | "handle"; label: string; icon: any; current: string; needs2fa: boolean; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(""); const [pw, setPw] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const validHandle = /^[A-Za-z0-9_]{3,20}$/.test(val.replace(/^@/, ""));
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
  async function save() {
    setBusy(true);
    try {
      await api("/api/me/account", { method: "PATCH", json: kind === "email" ? { kind, newEmail: val, password: pw, code: code || undefined } : { kind, handle: val.replace(/^@/, "") } });
      toast(kind === "email" ? "Email changed. Other devices were signed out." : "Username changed", "up");
      setOpen(false); setVal(""); setPw(""); setCode(""); onDone();
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl border border-line bg-bg-2/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs text-muted"><Icon className="size-3.5" /> {label}</div>
          <div className="truncate text-sm font-medium">{kind === "handle" ? `@${current}` : current}</div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>Change</Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={kind === "email" ? "Change your email" : "Change your username"}>
        <div className="space-y-3">
          <Input label={kind === "email" ? "New email" : "New username"} value={val} onChange={(e) => setVal(e.target.value)} placeholder={kind === "email" ? "you@example.com" : "new_username"} autoComplete="off" />
          {kind === "handle" && <p className={cx("flex items-center gap-1 text-[11px]", !val || validHandle ? "text-muted" : "text-down")}>{val && validHandle ? <Check className="size-3 text-up" /> : null}3–20 letters, numbers or underscores. Your old profile link will stop working.</p>}
          {kind === "email" && <>
            <PasswordInput label="Your current password (to confirm it's you)" value={pw} onChange={setPw} autoComplete="current-password" />
            {needs2fa && <div><span className="mb-1 block text-xs font-medium text-muted">Code from your authenticator app</span><CodeInput value={code} onChange={setCode} /></div>}
            <p className="text-[11px] text-muted">From now on you'll sign in with the new email. Other devices are signed out.</p>
          </>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={kind === "email" ? !validEmail || !pw || (needs2fa && code.length !== 6) : !validHandle} onClick={save}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ───────────────────────── Security ───────────────────────── */
export function SecurityTab({ data, refresh }: { data: any; refresh: () => void }) {
  const toast = useToast();
  const sessions = useApi<any>("/api/settings/sessions");
  const [allDevices, setAllDevices] = useState(false);
  const on = !!data.user.totp_enabled;
  const devices = sessions.data?.sessions?.length ?? 0;
  const checks = [
    { ok: true, text: "Password set", sub: "Change it any time below" },
    { ok: on, text: on ? "Two-factor authentication is on" : "Two-factor authentication is off", sub: on ? "A code from your phone is needed to sign in and for sensitive actions" : "Recommended: needed for withdrawals and real-money trading" },
    { ok: devices <= 3, text: `${devices || "—"} signed-in device${devices === 1 ? "" : "s"}`, sub: "Sign out any you don't recognise" },
  ];
  const score = checks.filter((c) => c.ok).length;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {score === 3 ? <ShieldCheck className="size-10 text-up" /> : <ShieldAlert className="size-10 text-warn" />}
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">{score === 3 ? "Your account is well protected" : on ? "Almost there" : "Add two-factor authentication"}</div>
            <p className="text-sm text-muted">{score === 3 ? "Nice. Keep your authenticator app safe." : on ? "Review the devices signed in to your account." : "It takes about a minute and keeps your account safe even if your password leaks."}</p>
          </div>
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {checks.map((c, i) => (
            <li key={i} className="flex gap-2 rounded-xl border border-line bg-bg-2/50 p-3 text-xs">
              {c.ok ? <CheckCircle2 className="size-4 shrink-0 text-up" /> : <Circle className="size-4 shrink-0 text-warn" />}
              <span><span className="block font-medium text-text">{c.text}</span><span className="text-muted">{c.sub}</span></span>
            </li>
          ))}
        </ul>
      </Card>

      <TwoFactor on={on} refresh={refresh} />
      <ChangePassword needs2fa={on} />

      <Section icon={Monitor} title="Signed-in devices" desc="Everywhere your account is signed in right now."
        action={devices > 1 ? <Button size="sm" variant="ghost" onClick={async () => { const r = await api("/api/settings/sessions?all=others", { method: "DELETE" }); toast(`Signed out ${r.revoked} other device(s)`, "up"); sessions.refresh(); }}><LogOut className="size-3.5" /> Sign out all others</Button> : undefined}>
        <div className="space-y-2">
          {(sessions.data?.sessions ?? []).slice(0, allDevices ? undefined : 5).map((s: any) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-2/50 px-3 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-3">
                {/iPhone|Android|iPad/.test(s.user_agent ?? "") ? <Smartphone className="size-5 shrink-0 text-muted" /> : <Monitor className="size-5 shrink-0 text-muted" />}
                <span className="min-w-0"><span className="block truncate font-medium">{deviceName(s.user_agent)}</span><span className="text-xs text-muted">Signed in {ago(s.created_at)}{s.ip ? ` · ${s.ip}` : ""}</span></span>
              </span>
              {s.current ? <Badge tone="up">This device</Badge> : <Button size="sm" variant="ghost" onClick={async () => { await api(`/api/settings/sessions?id=${s.id}`, { method: "DELETE" }); toast("Signed out that device", "up"); sessions.refresh(); }}>Sign out</Button>}
            </div>
          ))}
          {devices > 5 && <button onClick={() => setAllDevices(!allDevices)} className="text-xs text-accent-2 hover:underline">{allDevices ? "Show fewer" : `Show all ${devices} devices`}</button>}
        </div>
      </Section>
    </div>
  );
}

function TwoFactor({ on, refresh }: { on: boolean; refresh: () => void }) {
  const toast = useToast();
  const [enroll, setEnroll] = useState<any>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [disabling, setDisabling] = useState(false);
  async function start() { setBusy(true); try { setEnroll(await api("/api/auth/2fa")); setCode(""); } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); } }
  async function confirm(c = code) {
    if (c.length !== 6) return;
    setBusy(true);
    try { await api("/api/auth/2fa", { method: "POST", json: { code: c } }); toast("Two-factor authentication is on", "up"); setEnroll(null); setCode(""); refresh(); }
    catch (e: any) { toast(e.message, "down"); setCode(""); } finally { setBusy(false); }
  }
  async function disable(c = code) {
    if (c.length !== 6) return;
    setBusy(true);
    try { await api("/api/auth/2fa", { method: "DELETE", json: { code: c } }); toast("Two-factor authentication is off"); setDisabling(false); setCode(""); refresh(); }
    catch (e: any) { toast(e.message, "down"); setCode(""); } finally { setBusy(false); }
  }
  const step = (n: number, title: string, body: React.ReactNode, done = false) => (
    <li className="flex gap-3">
      <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold", done ? "bg-up text-black" : "bg-accent-soft text-accent-2")}>{done ? <Check className="size-4" /> : n}</span>
      <div className="min-w-0 flex-1 pb-4"><div className="text-sm font-medium">{title}</div><div className="mt-1 text-xs text-muted">{body}</div></div>
    </li>
  );
  return (
    <Section icon={KeyRound} title="Two-factor authentication (2FA)" desc="A 6-digit code from an app on your phone, on top of your password."
      action={on ? <Badge tone="up">On</Badge> : <Badge tone="warn">Off</Badge>}>
      {on ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-xl bg-up-soft px-3 py-2.5 text-sm text-up"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /> Protected. Merod asks for a code when you sign in, withdraw money, change your email or password, or switch on real-money trading.</p>
          <p className="text-xs text-muted">Lost your phone? You'll need the code to turn this off, so keep your authenticator app backed up (Google Authenticator, Authy and 1Password can all back up codes).</p>
          <Button variant="ghost" className="text-down" onClick={() => { setDisabling(true); setCode(""); }}>Turn off 2FA</Button>
          <Modal open={disabling} onClose={() => setDisabling(false)} title="Turn off two-factor authentication?">
            <div className="space-y-3">
              <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Your account will only be protected by your password. Withdrawals and real-money trading will be blocked until you turn it back on.</p>
              <div><span className="mb-1 block text-xs font-medium text-muted">Enter the current code from your authenticator app</span><CodeInput value={code} onChange={setCode} onComplete={disable} autoFocus /></div>
              <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDisabling(false)}>Keep it on</Button><Button variant="danger" loading={busy} disabled={code.length !== 6} onClick={() => disable()}>Turn off</Button></div>
            </div>
          </Modal>
        </div>
      ) : !enroll ? (
        <div className="space-y-3">
          <ul className="grid gap-2 text-xs text-muted sm:grid-cols-3">
            <li className="rounded-xl border border-line bg-bg-2/50 p-3"><b className="block text-text">Stops account takeovers</b>Even with your password, nobody gets in without your phone.</li>
            <li className="rounded-xl border border-line bg-bg-2/50 p-3"><b className="block text-text">Needed for money moves</b>Required for withdrawals and real-money trading.</li>
            <li className="rounded-xl border border-line bg-bg-2/50 p-3"><b className="block text-text">Takes about a minute</b>You need a free authenticator app on your phone.</li>
          </ul>
          <Button variant="primary" loading={busy} onClick={start}><ShieldCheck className="size-4" /> Set up 2FA</Button>
        </div>
      ) : (
        <ol className="mt-1">
          {step(1, "Get an authenticator app", <>Install a free app on your phone if you don&apos;t have one: <b className="text-text">Google Authenticator</b>, <b className="text-text">Microsoft Authenticator</b>, <b className="text-text">Authy</b> or <b className="text-text">1Password</b> (App Store / Google Play).</>, true)}
          {step(2, "Scan this QR code with the app", (
            <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row">
              {enroll.qr && <img src={enroll.qr} alt="QR code for your authenticator app" width={168} height={168} className="rounded-xl bg-white p-2" />}
              <div className="space-y-2">
                <p>In the app, tap <b className="text-text">+</b> or <b className="text-text">Add account</b>, then <b className="text-text">Scan a QR code</b>.</p>
                <p>Can&apos;t scan? Choose <b className="text-text">Enter a setup key</b> and paste this:</p>
                <div className="flex items-center gap-2">
                  <code className="break-all rounded-lg bg-bg-2 px-2 py-1.5 font-mono text-[11px] text-text">{enroll.secret}</code>
                  <Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(enroll.secret); toast("Key copied", "up"); } catch { toast("Copy failed. Select the key and copy it", "down"); } }}><Copy className="size-3.5" /></Button>
                </div>
              </div>
            </div>
          ))}
          {step(3, "Type the 6-digit code the app shows", (
            <div className="mt-2 space-y-2">
              <CodeInput value={code} onChange={setCode} onComplete={(c) => confirm(c)} autoFocus />
              <p>The code changes every 30 seconds. If it&apos;s rejected, wait for a new one and check your phone&apos;s time is set automatically.</p>
              <div className="flex gap-2">
                <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={() => confirm()}>Turn on 2FA</Button>
                <Button variant="ghost" onClick={() => { setEnroll(null); setCode(""); }}><X className="size-3.5" /> Cancel</Button>
              </div>
            </div>
          ))}
        </ol>
      )}
    </Section>
  );
}

function ChangePassword({ needs2fa }: { needs2fa: boolean }) {
  const toast = useToast();
  const [v, setV] = useState({ current: "", next: "", confirm: "", code: "" });
  const [busy, setBusy] = useState(false);
  const st = strength(v.next);
  const match = v.confirm.length > 0 && v.next === v.confirm;
  const ready = v.current && v.next.length >= 10 && match && (!needs2fa || v.code.length === 6);
  async function save() {
    setBusy(true);
    try {
      await api("/api/me/account", { method: "PATCH", json: { kind: "password", currentPassword: v.current, newPassword: v.next, code: v.code || undefined } });
      toast("Password changed. Other devices were signed out.", "up"); setV({ current: "", next: "", confirm: "", code: "" });
    } catch (e: any) { toast(e.message, "down"); } finally { setBusy(false); }
  }
  return (
    <Section icon={KeyRound} title="Password" desc="Use at least 10 characters. A few random words work well.">
      <div className="grid gap-3 sm:grid-cols-2">
        <PasswordInput label="Current password" value={v.current} onChange={(x) => setV({ ...v, current: x })} autoComplete="current-password" />
        <div className="hidden sm:block" />
        <div>
          <PasswordInput label="New password" value={v.next} onChange={(x) => setV({ ...v, next: x })} autoComplete="new-password" />
          {v.next && <div className="mt-1.5">
            <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <span key={i} className={cx("h-1 flex-1 rounded-full", i < st ? (st <= 1 ? "bg-down" : st === 2 ? "bg-warn" : "bg-up") : "bg-panel-2")} />)}</div>
            <p className="mt-1 text-[11px] text-muted">{v.next.length < 10 ? `${10 - v.next.length} more character${10 - v.next.length === 1 ? "" : "s"} needed` : ["Weak", "Weak", "Okay", "Strong", "Very strong"][st]}</p>
          </div>}
        </div>
        <div>
          <PasswordInput label="Type it again" value={v.confirm} onChange={(x) => setV({ ...v, confirm: x })} autoComplete="new-password" />
          {v.confirm && <p className={cx("mt-1 flex items-center gap-1 text-[11px]", match ? "text-up" : "text-down")}>{match ? <><Check className="size-3" /> Passwords match</> : <><X className="size-3" /> Passwords don&apos;t match</>}</p>}
        </div>
        {needs2fa && <div className="sm:col-span-2"><span className="mb-1 block text-xs font-medium text-muted">Code from your authenticator app</span><CodeInput value={v.code} onChange={(c) => setV({ ...v, code: c })} /></div>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-[11px] text-faint">Changing it signs you out on your other devices.</p>
        <Button variant="primary" loading={busy} disabled={!ready} onClick={save}>Change password</Button>
      </div>
    </Section>
  );
}
